// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import type { RocketBaseClient } from "./client.ts";
import { WorkflowSuspension } from "./suspension.ts";

export class WorkflowBase {
  public client!: RocketBaseClient;
  public runId: string = "";
  public workflowName: string = "unknown";

  public history = new Map<string, any>();
  public completedSteps = new Set<string>();
  public rollbackStack: string[] = [];
  public stepAttempts = new Map<string, number>();

  public callCounter = 0;
  public signalQueues = new Map<string, any[]>();
  public signalCursors = new Map<string, number>();
  public isSuspended = false;

  constructor(client?: RocketBaseClient) {
    if (client) this.client = client;
  }

  async parallel<T>(steps: (() => Promise<T>)[]): Promise<T[]> {
    return await Promise.all(steps.map((s) => s()));
  }

  public getDeterministicId(prefix: string) {
    return `${prefix}-${this.callCounter++}`;
  }

  async sleep(duration: number | string): Promise<void> {
    const id = this.getDeterministicId("sleep");
    if (this.completedSteps.has(id)) return;

    if (!this.runId) {
      throw new Error("Cannot sleep outside of a workflow context.");
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

    this.isSuspended = true;
    throw new WorkflowSuspension(`Sleeping for ${ms}ms`);
  }

  async waitForSignal<T = any>(name: string): Promise<T> {
    const id = this.getDeterministicId(`signal-${name}`);
    if (this.history.has(id)) {
      const data = this.history.get(id) as T;
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
        this.signalCursors.set(name, cursor + 1);
        return data as T;
      }
    }

    if (!this.runId) {
      throw new Error("Cannot wait for signal outside of a workflow context.");
    }

    await this.client.workflow.createEvent(this.runId, {
      eventType: "signal_waiting",
      correlationId: id,
      payload: { name },
    });
    this.isSuspended = true;
    throw new WorkflowSuspension(`Waiting for signal: ${name}`);
  }

  async runRollback(error: any) {
    const accumulator: Record<string, any> = {};
    const stack = [...this.rollbackStack];
    while (stack.length > 0) {
      const method = stack.pop()!;
      if (typeof (this as any)[method] === "function") {
        try {
          const result = await (this as any)[method](error, accumulator);
          accumulator[method] = result;
        } catch (e: any) {
          if (e.name === "StopRollback") break;
          console.error(`Rollback method ${method} failed:`, e.message);
        }
      }
    }
  }

  rebuildState(events: any[]) {
    this.history.clear();
    this.completedSteps.clear();
    this.rollbackStack = [];
    this.stepAttempts.clear();
    this.signalQueues.clear();
    this.signalCursors.clear();
    this.callCounter = 0;

    for (const event of events) {
      const payload = event.payload || {};
      switch (event.eventType) {
        case "step_completed":
          this.completedSteps.add(event.correlationId);
          this.history.set(event.correlationId, payload.output);
          break;
        case "wait_completed":
          this.completedSteps.add(event.correlationId);
          break;
        case "signal_received":
          this.history.set(event.correlationId, payload.data);
          if (payload.name) {
            if (!this.signalQueues.has(payload.name)) {
              this.signalQueues.set(payload.name, []);
            }
            this.signalQueues.get(payload.name)!.push(payload.data);
          }
          break;
        case "rollback_registered":
          this.rollbackStack.push(payload.method);
          break;
        case "step_retrying":
          this.stepAttempts.set(event.correlationId, payload.attempt);
          break;
      }
    }
  }

  async executeStep(
    id: string,
    fn: (...args: any[]) => Promise<any>,
    args: any[],
    options: { retries?: number; rollback?: string[]; timeout?: string } = {},
  ) {
    if (!this.runId) return fn.apply(this, args);

    if (this.completedSteps.has(id)) return this.history.get(id);

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
        await this.client.workflow.createEvent(this.runId, {
          eventType: "step_started",
          correlationId: id,
          payload: { attempt },
        });
        const result = await fn.apply(this, args);
        await this.client.workflow.createEvent(this.runId, {
          eventType: "step_completed",
          correlationId: id,
          payload: { output: result },
        });
        this.completedSteps.add(id);
        this.history.set(id, result);
        return result;
      } catch (e: any) {
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
