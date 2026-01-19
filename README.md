# RocketBase SDK

The RocketBase (RB) SDK is a runtime-agnostic client for interacting with the
RocketBase platform. It supports standard database operations, realtime
subscriptions, and provides a powerful engine for durable workflows.

## Installation

### Node.js / Bun (via GitHub)

This package can be installed directly from the GitHub repository.

**Note:** Ensure you are installing from a repository where this package is at
the root, or use a tool that supports subdirectory installation.

```bash
# npm
npm install github:vski-ai/sdk

# bun
bun add github:vski-ai/sdk
```

### Deno (via GitHub)

For Deno, you can import the `exports.ts` file directly via raw GitHub URL:

```typescript
// Import from raw GitHub content
import { RocketBaseClient } from "https://raw.githubusercontent.com/vski-ai/sdk/main/exports.ts";
```

Or configure it in your `deno.json` imports:

```json
{
  "imports": {
    "@vski/sdk": "https://raw.githubusercontent.com/vski-ai/sdk/main/exports.ts"
  }
}
```

## Quick Start

```typescript
import { RocketBaseClient } from "@rocketbase/client";

const client = new RocketBaseClient("http://localhost:3001");

// Authenticate as Admin
await client.admins.authWithPassword("admin@example.com", "password123");

// Or as a regular user
await client.collection("users").authWithPassword(
  "user@example.com",
  "password123",
);
```

## Database Operations

### Collections & Records

```typescript
const posts = client.collection("posts");

// Create a record
const record = await posts.create({
  title: "Hello World",
  content: "This is my first post",
  status: "draft",
});

// List records
const { items, totalItems } = await posts.getList(1, 30, {
  filter: 'status = "published"',
  expand: "author",
});

// Update
await posts.update(record.id, { status: "published" });

// Delete
await posts.delete(record.id);

// Bulk operations
await posts.bulkUpdate(["id1", "id2"], { status: "archived" });
await posts.bulkDelete(["id1", "id2"]);
```

### Realtime Subscriptions

```typescript
const unsubscribe = client.collection("messages").subscribe((event) => {
  console.log(event.action); // "create", "update", or "delete"
  console.log(event.record);
}, {/* optional: lastId, group */});

// Later
unsubscribe();
```

## Durable Workflows

RocketBase supports "Code as Infrastructure" durable workflows. They survive
restarts, handle retries automatically, and can wait for days for external
signals.

### 1. Functional Style (Recommended)

```typescript
import { step, workflow } from "@rocketbase/client";

// Define reusable steps
const notifyUser = step("notify", async (email: string) => {
  // This logic is durable and retried on failure
  return await sendEmail(email, "Welcome!");
});

// Define the workflow
workflow("welcome-flow").run(async (ctx, email: string) => {
  await ctx.sleep("1h"); // Durable sleep
  await notifyUser(email);

  // Wait for an external signal (e.g. user clicking a link)
  const confirmation = await ctx.waitForSignal("user-confirm");
  return { confirmed: confirmation.success };
});
```

### 2. Class-Based Style (Decorators)

```typescript
import { Step, Workflow, WorkflowBase } from "@rocketbase/client";

@Workflow("order-process")
class OrderWorkflow extends WorkflowBase {
  @Step("payment", { retries: 3 })
  async processPayment(amount: number) {
    return await stripe.charge(amount);
  }

  async run(orderId: string, amount: number) {
    await this.processPayment(amount);
    await this.sleep("1d");
    // ...
  }
}
```

### 3. Running a Worker

Workers connect to RocketBase via WebSockets and execute the workflow logic.

```typescript
import { WorkflowWorker } from "@rocketbase/client";

const worker = new WorkflowWorker(client);
await worker.start("welcome-flow");
```

### 4. Triggering a Workflow

```typescript
const run = await client.workflow.trigger("welcome-flow", ["user@example.com"]);
console.log(run.runId);

// Send a signal later
await client.workflow.sendSignal(run.runId, "user-confirm", { success: true });
```

## API Reference

### RocketBaseClient

- `auth`: General user authentication methods.
- `admins`: Admin-specific authentication and management.
- `collection(name)`: CRUD and Realtime for a specific collection.
- `workflow`: Trigger, signal, and monitor durable workflows.
- `settings`: Manage databases and collection schemas.
- `migrations`: Run and track schema migrations.
- `cron`: Manage recurring jobs.

### WorkflowContext (Functional `ctx` or Class `this`)

- `sleep(duration)`: Suspend execution for a duration (e.g., `"1h"`, `"2d"`,
  `5000`).
- `waitForSignal<T>(name)`: Suspend until an external signal is received.
- `parallel(steps[])`: Execute multiple steps concurrently with durability.
- `runId`: The unique ID of the current execution.
- `history`: Map of completed step results.
