# VRB WORKFLOWS

## Abstract

VRB Workflows is a durable, fault-tolerant execution engine for distributed
systems. It provides a functional approach to managing long-running, multi-step
operations that must survive process failures, network partitions, and service
restarts. Built on Workflow DevKit protocol, VRB workflows combine three core
patterns—durable execution, saga-based transaction management, and circuit
breakers—to deliver reliable orchestration for complex business processes.

## Introduction

Modern distributed applications face three fundamental challenges:

1. **Process resilience**: Operations must survive worker crashes, restarts, and
   network failures
2. **Data consistency**: Multi-service transactions require compensation when
   steps fail
3. **Resource protection**: Infinite loops, cascading failures, and external
   service outages must be contained

VRB Workflows addresses these challenges through a unified execution model that
persists state at every step, automatically retries failed operations, provides
saga-based rollback capabilities, and includes built-in circuit breakers to
prevent runaway workflows.

### Workflow Styles

VRB Workflows supports two approaches:

- **Functional style (Preferred)**: Uses `workflow()` and `step()` functions to
  define workflows declaratively
- **Decorator style (Alternative)**: Uses `@Workflow` and `@Step` decorators for
  class-based workflows

This whitepaper uses the functional approach. Both styles are equivalent; choose
based on your preference.

## Durable Execution

### Concept

Durable execution ensures that workflow progress is preserved across failures.
Each step's completion is recorded atomically with its output, allowing
execution to resume from the exact point of interruption. The system maintains
an append-only event log that provides both auditability and replay
capabilities.

### Core Principles

**Idempotency by Default**: Every step can be safely re-executed. The workflow
engine tracks completed steps and skips them during replay, preventing duplicate
side effects.

**State Reconstruction**: When a worker crashes or restarts, workflow state is
rebuilt from the event log. Suspended workflows automatically resume execution
from where they left off.

**Explicit Checkpoints**: Operations pause at three types of checkpoints:

- Step completion (output persisted)
- Sleep durations (wake scheduled)
- Signal waits (external callback registered)

### Implementation

```typescript
import {
  RocketBaseClient,
  step,
  type StepOptions,
  workflow,
  type WorkflowContext,
  type WorkflowOptions,
} from "@vski/sdk";

const client = new RocketBaseClient("http://localhost:3000");
client.setDb("order_db");

const options: WorkflowOptions = {
  maxEvents: 1000,
  executionTimeout: 60000,
};

const validateOrder = step("validate-order", async (orderData: any) => {
  if (orderData.items.length === 0) {
    throw new Error("Order cannot be empty");
  }
  return { valid: true, total: calculateTotal(orderData) };
});

const reserveInventory = step("reserve-inventory", async (orderData: any) => {
  // Use your database or external service APIs here
  // const result = await inventoryService.reserve(orderData.items);
  const collection = client.collection("inventory");
  const reservation = await collection.create({
    items: orderData.items,
    status: "reserved",
  });
  return { reservationId: reservation.id, items: orderData.items };
}, { retries: 3 });

const processPayment = step("process-payment", async (input: any) => {
  // const result = await paymentGateway.charge(input.total);
  return { transactionId: "TXN-456", paid: true };
}, { retries: 2 });

const confirmOrder = step("confirm-order", async (input: any) => {
  // await notificationService.send({ ... });
  return { confirmed: true };
});

workflow("order-processing", options).run(
  async function (ctx: WorkflowContext, orderData: any) {
    await validateOrder(orderData);
    const reserved = await reserveInventory(orderData);
    const paid = await processPayment({ ...reserved, ...orderData });
    await confirmOrder({ ...paid, orderId: orderData.id });

    return { status: "completed", orderId: orderData.id };
  },
);

function calculateTotal(orderData: any): number {
  return orderData.items.reduce(
    (sum: number, item: any) => sum + item.price,
    0,
  );
}
```

### Worker Setup

```typescript
import { RocketBaseClient, WorkflowWorker } from "@vski/sdk";

const client = new RocketBaseClient("http://localhost:3000");
client.setDb("production_db");

const worker = new WorkflowWorker(client);
const workerPromise = worker.start("order-processing");

const run = await client.workflow.trigger("order-processing", [
  {
    id: "ORD-12345",
    customerEmail: "user@example.com",
    items: [{ sku: "PROD-001", quantity: 2 }],
  },
]);

console.log(`Workflow started: ${run.runId}`);
```

### Failure Recovery

When a worker crashes during step execution:

1. **Job Detection**: The workflow gateway detects missing ACKs after 30 seconds
2. **Automatic Requeue**: Failed jobs are returned to the queue
3. **State Rebuilding**: A new worker reconstructs state from the event log
4. **Idempotent Replay**: Completed steps are skipped; execution resumes at the
   last incomplete step

```typescript
// After worker crash, state is automatically rebuilt
// If crash occurred during reserveInventory:
// - validateOrder output is replayed from history
// - reserveInventory re-executes (with retries)
// - processPayment and confirmOrder have not yet run
```

### External Signals

Workflows can pause indefinitely waiting for external events:

```typescript
import { RocketBaseClient } from "@vski/sdk";

const client = new RocketBaseClient("http://localhost:3000");
client.setDb("approval_db");

const createRequest = step("create-request", async (data: any) => {
  const collection = client.collection("approval_requests");
  const request = await collection.create({
    type: data.type,
    amount: data.amount,
    requester: data.requester,
    status: "pending",
  });
  return { requestId: request.id };
});

const awaitApproval = step("await-approval", async function (this: WorkflowContext, input: any) => {
  const decision = await this.waitForSignal<{
    approved: boolean;
    approver: string;
    comments?: string;
  }>("manager-decision");

  if (!decision.approved) {
    throw new Error("Request rejected");
  }

  return { approved: true, approver: decision.approver };
});

const executeAction = step("execute-action", async (input: any) => {
  // await actionService.execute(input);
  return { completed: true };
});

workflow("approval-workflow").run(async function (ctx: WorkflowContext, requestData: any) {
  const request = await createRequest(requestData);
  const approved = await awaitApproval(request);
  return await executeAction({ ...request, ...approved });
});

// Send signal from external application
await client.workflow.sendSignal(run.runId, "manager-decision", {
  approved: true,
  approver: "manager@example.com",
  comments: "Approved within budget",
});
```

## Saga Pattern

### Concept

The Saga pattern manages distributed transactions through a compensating
mechanism. Instead of blocking locks across multiple services, each step commits
locally and registers a rollback handler. If any step fails, previously
completed steps are undone in reverse order.

### When to Use Sagas

- **Multi-service transactions**: Each step calls a different microservice
- **Long-running operations**: Cannot afford to hold locks for minutes/hours
- **No distributed transaction support**: Services don't support 2PC or XA
- **Business-level compensation**: Can reverse operations through business logic

### Implementation

```typescript
const bookFlight = step("book-flight", async (userId: string) => {
  console.log(`LOGIC: Booking flight for ${userId}`);
  return { flightId: "FL-123" };
}, {
  rollbackFn: async (error: any, accumulator: any) => {
    console.log("LOGIC: Rolling back flight booking");
    return { canceled: true };
  },
});

const bookHotel = step("book-hotel", async (userId: string) => {
  console.log(`LOGIC: Booking hotel for ${userId}`);
  return { hotelId: "HT-456" };
}, {
  rollbackFn: async (error: any, accumulator: any) => {
    console.log("LOGIC: Rolling back hotel booking");
    return { canceled: true };
  },
});

const bookCar = step(
  "book-car",
  async (userId: string) => {
    console.log(`LOGIC: Booking car for ${userId}`);
    return { carId: "CR-789" };
  },
  {
    retries: 2,
    rollbackFn: async (error: any, accumulator: any) => {
      console.log("LOGIC: Rolling back car booking");
      return { canceled: true };
    },
  },
);

workflow("saga-with-rollbacks").run(
  async function (ctx, userId: string, shouldFail: boolean = false) {
    console.log("LOGIC: Starting Saga for", userId);
    await bookFlight(userId);
    await bookHotel(userId);
    await bookCar(userId, shouldFail);
    return { status: "booked", tripId: "TRIP-123" };
  },
);
```

### Saga Execution Flow

```mermaid
sequenceDiagram
    participant Workflow
    participant Flight
    participant Hotel
    participant Car
    participant RollbackHotel
    participant RollbackFlight

    Workflow->>Flight: bookFlight()
    Flight-->>Workflow: Success (flightId)

    Workflow->>Hotel: bookHotel()
    Hotel-->>Workflow: Success (hotelId)

    Workflow->>Car: bookCar()
    Car-->>Workflow: Error!

    Workflow->>RollbackHotel: cancelHotel(error, accumulator)
    RollbackHotel-->>Workflow: Success

    Workflow->>RollbackFlight: cancelFlight(error, accumulator)
    RollbackFlight-->>Workflow: Success

    Workflow-->>: Failed with full compensation
```

### Rollback Guarantees

- **Reverse Order**: Rollbacks execute in reverse order of successful steps
- **Best Effort**: Rollbacks continue even if some fail
- **Error Context**: Original error and step outputs passed to rollback handlers
- **Idempotent**: Rollback handlers must be safely re-executable

### Parallel Sagas

For independent steps, execute in parallel with combined rollback:

```typescript
const paymentGateway = new PaymentGate(); // example
const creditsService = new CreditService(); // example

const chargeCard = step("charge-card", async (amount: number) => {
  return await paymentGateway.charge(amount);
}, {
  rollbackFn: async (error: any, acc: any) => {
    await paymentGateway.refund(acc.transactionId);
  },
});

const deductCredits = step("deduct-credits", async (ctx, amount: number) => {
  return await creditsService.deduct(amount);
}, {
  rollbackFn: async (error: any, acc: any) => {
    await creditsService.restore(acc.creditId, acc.amount);
  },
};

workflow("parallel-saga").run(async function (ctx, amount) {
  const [payment, credit] = await ctx.parallel([
    () => chargeCard(amount),
    () => deductCredits(amount),
  ]);

  return { payment, credit };
});
```

## Circuit Breakers

### Concept

Circuit breakers prevent resource exhaustion and runaway workflows. They monitor
execution patterns and automatically halt workflows that exceed safe
limits—protecting against infinite loops, cascading failures, and external
service outages.

### Types of Circuit Breakers

#### 1. Max Events Limit

Prevents workflows from generating excessive events that could overwhelm storage
or processing:

```typescript
import {
  RocketBaseClient,
  step,
  workflow,
  type WorkflowContext,
} from "@vski/sdk";

const client = new RocketBaseClient("http://localhost:3000");
client.setDb("data_db");

const processItem = step("process-item", async (itemId: string) => {
  const collection = client.collection("items");
  await collection.create({ itemId, status: "processed" });
  return { processed: true };
});

workflow("data-processing", { maxEvents: 100 }).run(
  async function (ctx: WorkflowContext, itemIds: string[]) {
    for (const itemId of itemIds) {
      await processItem(itemId);
    }

    return { processedCount: itemIds.length };
  },
);
```

**Use Case**: Processing large datasets with built-in guardrails

#### 2. Execution Timeout

Prevents workflows from running indefinitely:

```typescript
import { step, workflow, type WorkflowContext } from "@vski/sdk";

const fetchData = step("fetch-data", async (url: string) => {
  const response = await fetch(url);
  return await response.json();
});

const processResponse = step("process-response", async (data: any) => {
  return transform(data);
});

const saveResults = step("save-results", async (results: any) => {
  const collection = client.collection("results");
  await collection.create(results);
  return { saved: true };
});

workflow("external-api-calls", { executionTimeout: 30000 }).run(
  async function (ctx: WorkflowContext, urls: string[]) {
    for (const url of urls) {
      const data = await fetchData(url);
      const processed = await processResponse(data);
      await saveResults(processed);
    }
  },
);
```

**Use Case**: External API integrations, file processing, batch operations

### Step-Level Circuit Breakers

Combine with step retries for fine-grained control:

```typescript
import { step, workflow, type WorkflowContext } from "@vski/sdk";

const callExternalAPI = step("call-external-api", async (data: any) => {
  const response = await fetch("https://api.example.com/process", {
    method: "POST",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }

  return await response.json();
}, {
  retries: 3,
  rollbackFn: async (error: any, acc: any) => {
    // Optionally: await externalAPI.cancel(acc.externalId);
  },
});

const localProcessing = step("local-processing", async (data: any) => {
  return transform(data);
});

workflow("resilient-workflow", {
  executionTimeout: 60000,
  maxEvents: 500,
}).run(async function (ctx: WorkflowContext, inputData: any) {
  const external = await callExternalAPI(inputData);
  const processed = await localProcessing(external);
  return { result: processed };
});
```

````
### Circuit Breaker Benefits

| Protection Type   | Prevents                                 |
| ----------------- | ---------------------------------------- |
| Max Events        | Storage overflow, memory exhaustion      |
| Execution Timeout | Infinite loops, hanging operations       |
| Step Retries      | Cascading failures from transient errors |
| Rollbacks         | Inconsistent state from partial failures |

## Use Cases

### 1. Order Processing

**Problem**: Orders require inventory reservation, payment processing, and
shipping—all across different services with potential failures.

**Solution**: Saga-based transaction with compensating actions.

Simplified workflow:

```typescript
import { RocketBaseClient, step, workflow, type WorkflowContext } from "@vski/sdk";

const client = new RocketBaseClient("http://localhost:3000");
client.setDb("ecommerce_db");

const reserveInventory = step("reserve-inventory", async (order: any) => {
  const collection = client.collection("inventory");
  const reservation = await collection.create({
    items: order.items,
    status: "reserved",
  });
  return { reservationId: reservation.id };
}, {
  rollbackFn: async (error: any, acc: any) => {
    const inventoryCollection = client.collection("inventory");
    await inventoryCollection.update(acc.reservationId, { status: "released" });
  },
});

const processPayment = step(
  "process-payment",
  async (order: any, inventory: any) => {
    // const result = await payment.charge({
    //   amount: order.total,
    //   orderId: order.id,
    //   customerId: order.customerId,
    // });
    return { transactionId: "TXN-789" };
  },
  {
    retries: 2,
    rollbackFn: async (error: any, acc: any) => {
      // await payment.refund(acc.transactionId);
    },
  },
);

const createShipment = step(
  "create-shipment",
  async (order: any, payment: any) => {
    // const result = await shipping.create({
    //   orderId: order.id,
    //   address: order.shippingAddress,
    // });
    return { shipmentId: "SHIP-123" };
  },
  {
    rollbackFn: async (error: any, acc: any) => {
      // await shipping.cancel(acc.shipmentId);
    },
  },
);

workflow("ecommerce-order").run(async function (ctx: WorkflowContext, order: any) {
  try {
    const inventory = await reserveInventory(order);
    const payment = await processPayment(order, inventory);
    const shipment = await createShipment(order, payment);
    return { status: "confirmed", shipmentId: shipment.id };
  } catch (error) {
    return { status: "failed", error: error.message };
  }
});
````

### 2. Document Approval Workflow

**Problem**: Documents require multi-level approval with human decision points,
potentially spanning days.

**Solution**: Durable execution with signal-based pauses.

```typescript
import { RocketBaseClient, step, workflow, type WorkflowContext } from "@vski/sdk";

const client = new RocketBaseClient("http://localhost:3000");
client.setDb("documents_db");

const submitDocument = step("submit-document", async (document: any) => {
  const collection = client.collection("documents");
  const record = await collection.create({
    ...document,
    status: "pending_manager_approval",
    submittedAt: new Date(),
  });

  return { documentId: record.id };
});

const managerReview = step("manager-review", async function (this: WorkflowContext, input: any) => {
  const decision = await this.waitForSignal<{
    approved: boolean;
    reviewer: string;
    comments?: string;
  }>("manager-decision");

  if (!decision.approved) {
    const collection = client.collection("documents");
    await collection.update(input.documentId, {
      status: "rejected",
      rejectionReason: decision.comments,
    });
    throw new Error("Rejected by manager");
  }

  const collection = client.collection("documents");
  await collection.update(input.documentId, {
    status: "pending_legal_review",
    managerApproval: {
      approvedBy: decision.reviewer,
      comments: decision.comments,
    },
  });

  return { documentId: input.documentId };
});

const legalReview = step("legal-review", async function (this: WorkflowContext, input: any) => {
  const decision = await this.waitForSignal<{
    approved: boolean;
    reviewer: string;
    comments?: string;
  }>("legal-decision");

  if (!decision.approved) {
    const collection = client.collection("documents");
    await collection.update(input.documentId, {
      status: "rejected",
      rejectionReason: decision.comments,
    });
    throw new Error("Rejected by legal");
  }

  const collection = client.collection("documents");
  await collection.update(input.documentId, {
    status: "approved",
    legalApproval: {
      approvedBy: decision.reviewer,
      comments: decision.comments,
    },
  });

  return { approved: true };
});

const notifyStakeholders = step("notify-stakeholders", async (input: any) => {
  // await notificationService.send({ ... });
  return { notified: true };
});

workflow("document-approval").run(async function (ctx: WorkflowContext, document: any) {
  const submitted = await submitDocument(document);
  const managerApproved = await managerReview(submitted);
  const legalApproved = await legalReview(managerApproved);
  await notifyStakeholders(legalApproved);

  return { status: "fully_approved", documentId: document.id };
});
```

`````
### 3. Data Pipeline with Circuit Breaker

**Problem**: Processing thousands of records from external APIs that may fail or
hang.

**Solution**: Circuit breakers with automatic limits and step retries.

````typescript
import { step, workflow, type WorkflowContext } from "@vski/sdk";

const fetchBatch = step("fetch-batch", async (offset: number, limit: number) => {
  const response = await fetch(
    `https://api.external.com/data?offset=${offset}&limit=${limit}`
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}, { retries: 2 });

const transformRecord = step("transform-record", async (record: any) => {
  return {
    id: record.externalId,
    name: record.name,
    normalizedScore: calculateScore(record.metrics),
    processedAt: new Date(),
  };
});

const batchInsert = step("batch-insert", async (records: any[]) => {
  const client = new RocketBaseClient("http://localhost:3000");
  const collection = client.collection("processed_data");
  
  const batchSize = 100;
  let insertedCount = 0;
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await collection.createMany(batch);
    insertedCount += batch.length;
  }
  
  return { insertedCount: records.length };
});

workflow("data-pipeline", {
  maxEvents: 2000,
  executionTimeout: 300000,
}).run(async function (ctx: WorkflowContext, config: any) {
  let offset = 0;
  let processedCount = 0;
  const batchSize = config.batchSize || 100;

  while (processedCount < config.maxRecords) {
    const batch = await fetchBatch(offset, batchSize);

    if (batch.length === 0) {
      break;
    }

    const transformed = await Promise.all(
      batch.map((record) => transformRecord(record))
    );

    await batchInsert(transformed);

    processedCount += batch.length;
    offset += batchSize;

    await ctx.sleep(100);
  }

  return { processedCount, status: "completed" };
});

function calculateScore(metrics: any): number {
  return metrics.score || 0;
}
`````

### 4. Payment Orchestration with Timeout

**Problem**: Multiple payment providers with different timeouts and failure
modes.

**Solution**: Fallback chain with circuit breakers and saga rollbacks.

```typescript
import { step, workflow, type WorkflowContext } from "@vski/sdk";

const tryPrimaryProvider = step(
  "try-primary-provider",
  async (payment: any) => {
    try {
      // const result = await providers.primary.charge({
      //   amount: payment.amount,
      //   currency: payment.currency,
      //   customerId: payment.customerId
      // });
      return { provider: "primary", transactionId: "TXN-001" };
    } catch (error) {
      if (isTransientError(error)) {
        throw error;
      }
      return { provider: "primary", failed: true, error: error.message };
    }
  },
  {
    retries: 2,
  },
);

const tryFallbackProvider = step(
  "try-fallback-provider",
  async (payment: any, primaryResult: any) => {
    if (!primaryResult.failed) {
      return primaryResult;
    }

    // const result = await providers.fallback.charge({
    //   amount: payment.amount,
    //   currency: payment.currency,
    //   customerId: payment.customerId
    // });
    return { provider: "fallback", transactionId: "TXN-002" };
  },
);

const recordTransaction = step(
  "record-transaction",
  async (payment: any, result: any, client: RocketBaseClient) => {
    const collection = client.collection("transactions");
    await collection.create({
      orderId: payment.orderId,
      amount: payment.amount,
      provider: result.provider,
      transactionId: result.transactionId,
      status: "completed",
    });

    return { recorded: true };
  },
);

function isTransientError(error: any): boolean {
  const transientCodes = [503, 504, 429];
  return transientCodes.includes(error?.status);
}

workflow("payment-orchestration", { executionTimeout: 45000 }).run(
  async function (ctx: WorkflowContext, payment: any) {
    const primary = await tryPrimaryProvider(payment);
    const final = await tryFallbackProvider(payment, primary);
    const recordTxn = await recordTransaction(payment, final, ctx.client);
    return {
      success: true,
      provider: final.provider,
      transactionId: final.transactionId,
    };
  },
);
```

### 2. Use Descriptive Step Names

```typescript
// BAD: Generic names
const step1 = step("step-1", async () => { ... })
const step2 = step("step-2", async () => { ... })

// GOOD: Descriptive names
const validateInput = step("validate-user-input", async () => { ... })
const reserveInventory = step("reserve-inventory", async () => { ... })
const processPayment = step("process-payment", async () => { ... })
```

### 3. Set Appropriate Timeouts

```typescript
workflow("api-integration", { executionTimeout: 60000 }).run(
  async function (ctx, datasetId) {
    const fetchDataset = step("fetch-large-dataset", async (id: string) => {
      return await externalAPI.dataset(id);
    }, { timeout: "30s" });

    const quickValidation = step("quick-validation", async (data: any) => {
      return validate(data);
    }, { timeout: "5s" });

    await fetchDataset(datasetId);
    await quickValidation(data);

    return { processed: true };
  },
);
```

### 4. Implement Rollbacks

Rollbacks use the new `rollbackFn` option for clean functional-style
registration:

```typescript
const bookFlight = step("book-flight", async (userId: string) => {
  const flight = await airlineService.book({
    userId,
    departure: tripDetails.departureAirport,
    arrival: tripDetails.arrivalAirport,
    date: tripDetails.travelDate,
  });

  return {
    flightId: flight.id,
    flightNumber: flight.number,
    confirmationCode: flight.confirmationCode,
  };
}, {
  rollbackFn: async (error: any, accumulator: any) => {
    console.log("Rolling back: Canceling flight booking");

    await airlineService.cancel({
      flightId: accumulator.flightId,
      confirmationCode: accumulator.confirmationCode,
      reason: error.message,
    });

    return { canceled: true };
  },
});

const bookHotel = step("book-hotel", async (userId: string) => {
  const hotel = await hotelService.book({
    userId,
    hotelId: tripDetails.hotelId,
    checkIn: tripDetails.checkIn,
    checkOut: tripDetails.checkOut,
    guests: tripDetails.guests,
  });

  return {
    hotelId: hotel.id,
    hotelName: hotel.name,
    bookingReference: hotel.reference,
  };
}, {
  rollbackFn: async (error: any, accumulator: any) => {
    console.log("Rolling back: Canceling hotel booking");

    await hotelService.cancel({
      bookingReference: accumulator.bookingReference,
      reason: error.message,
    });

    return { canceled: true };
  },
});

const bookCar = step(
  "book-car",
  async (userId: string, shouldFail: boolean = true) => {
    console.log("LOGIC: Booking car for", userId);
    if (shouldFail) {
      throw new Error("Car rental service unavailable!");
    }

    return {
      carId: car.id,
      rentalCompany: car.company,
    };
  },
);

workflow("saga-with-fn-rollback").run(
  async function (ctx, userId, tripDetails) {
    await bookFlight(userId, tripDetails);
    await bookHotel(userId, tripDetails);
    await bookCar(userId, tripDetails);

    return { status: "booked", tripId: "TRIP-123" };
  },
);
```

- Rollback functions are defined inline with steps
- Works with both parallel and sequential steps
- Type-safe rollback function signatures

### 5. Monitor Workflow Health

```typescript
const stats = await client.workflowStats.get();
console.log(`Total runs: ${stats.totalRuns}`);
console.log(`Success rate: ${stats.successRate}%`);
console.log(`Avg duration: ${stats.avgDurationMs}ms`);

const recentRuns = await client.workflow.listRuns({
  workflowName: "order-processing",
  status: "failed",
  limit: 10,
});

for (const run of recentRuns.items) {
  console.error(`Failed run ${run.runId}: ${run.error.message}`);
}
```

## Sending Signals

The workflows execution context provides methods for controlling execution. The
execution context is provided trough `this` in steps, and `ctx` in the main
workflow function.

```typescript
// Example: waiting for a signal in step
async function myStep(...args: any[]) {
  const approval = await this.waitForSignal<{
    approved: boolean;
    comments?: string;
  }>("manager-approval");
  // logic
}

async function myWorkflow(ctx, ...args: []) {
  await myStep();
  const otherSig = await ctx.waitForSignal<{
    ok: boolean;
  }>("other-sig");
  // logic
}

// register workflow
workflow("my-workflow").run(myWorkflow);

// trigger workflow
const run = await client.workflow.trigger("my-workflow", [{
  message: "hello",
  shouldFail: false,
}]);

// BEST PRACTICE:
// Track forklow state transitions in external data sources from within workfow
// For example, pass record id when triggering workflow
async function myMainWorkflow(ctx, data: { todoId: string }) {
  await myRepo.todos.update(data.todoId, {
    runId: ctx.runId,
  });
  await myStep();
  const otherSig = await ctx.waitForSignal<{
    ok: boolean;
  }>("other-sig");
  // logic
}
```

```typescript
// From external application
const todo = await myRepo.todos.get("mytodoId");

await client.workflow.sendSignal(todo.runId, "manager-approval", {
  approved: true,
  comments: "Approved for team budget",
});

// Or reject
await client.workflow.sendSignal(todo.runId, "manager-approval", {
  approved: false,
  comments: "Budget exceeded",
});

await client.workflow.sendSignal(todo.runId, "other-sig", {
  ok: true,
});
```

#### Signal Behavior

- **Blocking wait** - Execution pauses until signal arrives
- **Timeout safe** - Can signal from any time (even days later)
- **Worker restart safe** - Signal waits survive worker restarts
- **Type-safe** - Signal payloads are strongly typed
- **Multiple signals** - Can wait for different signals in sequence

### Basic Worker Setup

```typescript
import { RocketBaseClient, WorkflowWorker } from "@vski/sdk";

// Initialize client
const client = new RocketBaseClient("http://localhost:3000");
client.setDb("my_database");

// Create and start worker
const worker = new WorkflowWorker(client);
const workerPromise = worker.start("expense-approval");

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down worker...");
  worker.stop();
  await workerPromise;
  process.exit(0);
});

// Run indefinitely
await workerPromise;
```

### Worker for Multiple Workflows

```typescript
import { RocketBaseClient, WorkflowWorker } from "@vski/sdk";

const client = new RocketBaseClient("http://localhost:3000");
client.setDb("my_database");

const worker = new WorkflowWorker(client);

// Process multiple workflow types
const workerPromise = Promise.all([
  worker.start("expense-approval"),
  worker.start("order-processing"),
  worker.start("trip-booking"),
]);

await workerPromise;
```

### Worker Configuration

```typescript
const worker = new WorkflowWorker(client, {
  pollInterval: 1000, // Poll every 1 second
  maxConcurrency: 5, // Process up to 5 runs concurrently
  heartbeatInterval: 30000, // Send heartbeat every 30 seconds
  retryDelay: 5000, // Wait 5 seconds before retrying failed runs
});
```

### Worker Health Checks
