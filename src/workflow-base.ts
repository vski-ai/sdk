// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import type { RocketBaseClient } from "./client.ts";
import { WorkflowSuspension } from "./suspension.ts";
import type { StepOptions, WorkflowEvent, WorkflowOptions } from "./types.ts";

/**
 * Base class for all workflow implementations.
 * Provides the core logic for step execution, state management, idempotency, and signal handling.
 * Workflows extending this class (or using the functional wrapper) inherit these capabilities.
 */
export class WorkflowBase {
  /** The RocketBase client instance used for API calls. */
  public client!: RocketBaseClient;
  /** Unique identifier for the current workflow run. */
  public runId: string = "";
  /** Name of the workflow. */
  public workflowName: string = "unknown";
  /** Options used for the workflow execution. */
  public workflowOptions: WorkflowOptions = {};

  /** History of step results, indexed by step correlation ID. */
  public history = new Map<string, unknown>();
  /** Set of successfully completed step IDs. */
  public completedSteps = new Set<string>();
  /** Stack of rollback method names to call if the workflow fails. */
  public rollbackStack: string[] = [];
  /** Map tracking the number of attempts for each step ID. */
  public stepAttempts = new Map<string, number>();

  /** Counter for generating sequential IDs for steps and sleeps. */
  public callCounter: number = 0;
  /** Buffered signal data, indexed by signal name. */
  public signalQueues = new Map<string, any[]>();
  /** Cursors for signal queues to handle multiple waits for the same signal. */
  public signalCursors = new Map<string, number>();
  /** Flag indicating if the workflow is currently suspended. */
  public isSuspended: boolean = false;
  /** Set of step IDs that have been invoked during the current execution. */
  public invokedSteps = new Set<string>();
  /** Set of event IDs that have been emitted to the backend. */
  public emittedEvents = new Set<string>();

  /**
   * Creates a new instance of WorkflowBase.
   * @param client - Optional RocketBase client instance.
   */
  constructor(client?: RocketBaseClient) {
    if (client) this.client = client;
  }

  /**
   * Executes multiple steps in parallel.
   * @param steps - An array of functions returning promises to be executed concurrently.
   * @returns An array of results from the executed steps.
   */
  async parallel<T>(steps: (() => Promise<T>)[]): Promise<T[]> {
    return await Promise.all(steps.map((s) => s()));
  }

  /**
   * Generates a sequential ID for steps or sleeps that don't have a manual ID.
   * NOTE: This is order-dependent. Adding or removing steps will shift these IDs
   * and can break long-running workflows during replay.
   * @param prefix - The prefix for the ID (e.g., "step", "sleep").
   * @returns A generated unique ID.
   */
  public getSequentialId(prefix: string): string {
    const id = `${prefix}-${this.callCounter++}`;
    return id;
  }

  /**
   * Pauses execution for a specified duration.
   * This method supports idempotency and replay.
   * @param duration - The duration to sleep in milliseconds or as a string (e.g., "1s", "5m").
   * @returns A promise that resolves when the sleep is completed.
   * @throws {WorkflowSuspension} When the sleep starts, suspending execution until the duration passes.
   */
  async sleep(duration: number | string): Promise<void> {
    const id = this.getSequentialId("sleep");
    if (this.completedSteps.has(id)) {
      console.log(
        `[Workflow ${this.workflowName}] Sleep ${id} already completed, skipping`,
      );
      return;
    }

    if (!this.runId) {
      throw new Error("Cannot sleep outside of a workflow context.");
    }

    if (this.emittedEvents.has(id)) {
      console.log(
        `[Workflow ${this.workflowName}] Sleep ${id} already emitted, suspending`,
      );
      this.isSuspended = true;
      throw new WorkflowSuspension(`Sleeping for ${id}`);
    }

    let ms = 0;
    if (typeof duration === "string") {
      if (duration.endsWith("s")) {
        ms = parseFloat(duration) * 1000;
      } else if (duration.endsWith("m")) {
        ms = parseFloat(duration) * 60000;
      } else if (duration.endsWith("ms")) {
        ms = parseFloat(duration);
      } else {
        // Default to ms if no suffix, or try parsing
        ms = parseFloat(duration);
        if (isNaN(ms)) throw new Error(`Invalid duration format: ${duration}`);
      }
    } else {
      ms = duration;
    }

    const resumeAt = new Date(Date.now() + ms);

    await this.client.workflow.createEvent(this.runId, {
      eventType: "wait_created",
      correlationId: id,
      payload: { duration: ms, resumeAt: resumeAt.toISOString() },
    });
    this.emittedEvents.add(id);

    this.isSuspended = true;
    throw new WorkflowSuspension(`Sleeping for ${ms}ms`);
  }

  /**
   * Pauses execution until a specific signal is received.
   * This method supports idempotency and replay.
   * @param name - The name of the signal to wait for.
   * @returns The data payload associated with the signal.
   * @throws {WorkflowSuspension} When waiting for the signal, suspending execution until it arrives.
   */
  async waitForSignal<T = unknown>(name: string): Promise<T> {
    const id = this.getSequentialId(`signal-${name}`);
    if (this.history.has(id)) {
      const data = this.history.get(id) as T;
      console.log(
        `[Workflow ${this.workflowName}] Signal ${id} replayed from history`,
      );
      // Sync cursor if this strictly matched signal is also in the queue at current position
      const queue = this.signalQueues.get(name);
      if (queue) {
        const cursor = this.signalCursors.get(name) || 0;
        if (cursor < queue.length && queue[cursor] === data) {
          this.signalCursors.set(name, cursor + 1);
        }
      }
      return data;
    }

    const queue = this.signalQueues.get(name);
    if (queue) {
      const cursor = this.signalCursors.get(name) || 0;
      if (cursor < queue.length) {
        const data = queue[cursor];
        console.log(
          `[Workflow ${this.workflowName}] Signal ${id} pulled from signal queue at cursor ${cursor}`,
        );
        this.signalCursors.set(name, cursor + 1);
        return data as T;
      }
    }

    if (!this.runId) {
      throw new Error("Cannot wait for signal outside of a workflow context.");
    }

    if (this.emittedEvents.has(id)) {
      console.log(
        `[Workflow ${this.workflowName}] Signal ${id} already waiting, suspending`,
      );
      this.isSuspended = true;
      throw new WorkflowSuspension(`Waiting for signal: ${name}`);
    }

    await this.client.workflow.createEvent(this.runId, {
      eventType: "signal_waiting",
      correlationId: id,
      payload: { name },
    });
    this.emittedEvents.add(id);

    this.isSuspended = true;
    throw new WorkflowSuspension(`Waiting for signal: ${name}`);
  }

  /**
   * Executes the rollback stack in reverse order.
   * This is called when a workflow fails and needs to compensate for completed steps.
   * @param error - The error that triggered the rollback.
   * @returns A promise that resolves when the rollback is complete.
   */
  async runRollback(error: unknown): Promise<void> {
    const accumulator: Record<string, unknown> = {};
    const stack = [...this.rollbackStack];
    while (stack.length > 0) {
      const method = stack.pop()!;
      if (typeof (this as Record<string, unknown>)[method] === "function") {
        try {
          const result = await (this as unknown as Record<string, Function>)
            [method](error, accumulator);
          accumulator[method] = result;
        } catch (e) {
          if (e.name === "StopRollback") break;
          console.error(`Rollback method ${method} failed:`, e.message);
        }
      }
    }
  }

  /**
   * Reconstructs the workflow state from a list of events.
   * Used when resuming a workflow or replaying history.
   * @param events - The list of events from the workflow run.
   */
  rebuildState(events: WorkflowEvent[]): void {
    this.history.clear();
    this.completedSteps.clear();
    this.invokedSteps.clear();
    this.emittedEvents.clear();
    this.rollbackStack = [];
    this.stepAttempts.clear();
    this.signalQueues.clear();
    this.signalCursors.clear();
    this.callCounter = 0;
    this.isSuspended = false;

    for (const event of events) {
      const payload = event.payload || {};
      if (event.correlationId) {
        this.emittedEvents.add(event.correlationId);
      }
      switch (event.eventType) {
        case "step_completed":
          this.completedSteps.add(event.correlationId!);
          this.history.set(event.correlationId!, payload.output);
          break;
        case "wait_completed":
          this.completedSteps.add(event.correlationId!);
          break;
        case "signal_received":
          this.history.set(event.correlationId!, payload.data);
          if (payload.name) {
            const name = payload.name as string;
            if (!this.signalQueues.has(name)) {
              this.signalQueues.set(name, []);
            }
            this.signalQueues.get(name)!.push(payload.data);
          }
          break;
        case "rollback_registered":
          this.rollbackStack.push(payload.method as string);
          break;
        case "step_retrying":
          this.stepAttempts.set(
            event.correlationId!,
            payload.attempt as number,
          );
          break;
      }
    }
  }

  /**
   * Executes a single step within the workflow with idempotency, retries, and rollback support.
   * @param id - The unique identifier for the step.
   * @param fn - The function implementing the step logic.
   * @param args - Arguments to pass to the function.
   * @param options - Options for retries, rollback, and timeout.
   * @returns The result of the step execution.
   */
  async executeStep<T>(
    id: string,
    fn: (...args: any[]) => Promise<T>,
    args: any[],
    options: StepOptions = {},
    name?: string,
  ): Promise<T> {
    if (!this.runId) return fn.apply(this, args);

    if (this.invokedSteps.has(id)) {
      throw new Error(
        `Duplicate step ID detected: "${id}". Each step within a workflow must have a unique ID.`,
      );
    }
    this.invokedSteps.add(id);

    if (this.completedSteps.has(id)) {
      console.log(
        `[Workflow ${this.workflowName}] Step ${id} already completed, replaying from history`,
      );
      return this.history.get(id) as T;
    }

    if (options.rollback) {
      for (const method of options.rollback) {
        const cid = `${id}-rb-${method}`;
        if (!this.history.has(cid)) {
          await this.client.workflow.createEvent(this.runId, {
            eventType: "rollback_registered",
            correlationId: cid,
            payload: { method },
          });
          this.rollbackStack.push(method);
        }
      }
    }

    const maxRetries = options.retries || 0;
    let attempt = 0;

    // Initialize attempts if not present (from history reconstruction)
    if (!this.stepAttempts.has(id)) {
      this.stepAttempts.set(id, 0);
    }
    attempt = this.stepAttempts.get(id)!;

    while (true) {
      try {
        if (!this.emittedEvents.has(id)) {
          console.log(
            `[Workflow ${this.workflowName}] Step ${id} starting (Attempt ${attempt})`,
          );
          await this.client.workflow.createEvent(this.runId, {
            eventType: "step_started",
            correlationId: id,
            payload: { attempt, name: name || id },
          });
          this.emittedEvents.add(id);
        }
        const result = await fn.apply(this, args);
        console.log(`[Workflow ${this.workflowName}] Step ${id} completed`);
        await this.client.workflow.createEvent(this.runId, {
          eventType: "step_completed",
          correlationId: id,
          payload: { output: result },
        });
        this.completedSteps.add(id);
        this.history.set(id, result);
        return result;
      } catch (e) {
        if (attempt < maxRetries) {
          attempt++;
          this.stepAttempts.set(id, attempt);
          await this.client.workflow.createEvent(this.runId, {
            eventType: "step_retrying",
            correlationId: id,
            payload: { error: e.message, attempt },
          });
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        await this.client.workflow.createEvent(this.runId, {
          eventType: "step_failed",
          correlationId: id,
          payload: { error: e.message, attempt },
        });
        throw e;
      }
    }
  }
}
