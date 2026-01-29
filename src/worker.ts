// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import type { RocketBaseClient } from "./client.ts";
import { WorkflowRegistry } from "./registry.ts";
import { WorkflowSuspension } from "./suspension.ts";
import type { WorkflowJob, WorkflowRun } from "./types.ts";

/**
 * Worker class responsible for polling and executing workflow jobs.
 * Connects to the RocketBase backend via WebSocket to receive job assignments.
 */
export class WorkflowWorker {
  private active = false;
  private ready = false;
  private workflowNames = new Set<string>();
  private stopCallback: (() => void) | null = null;
  private activeJobs = new Set<Promise<void>>();
  private unsubscribers = new Map<string, () => void>();
  private pendingSubscriptions = new Map<string, Promise<void>>();
  private confirmedSubscriptions = new Set<string>();

  /**
   * Creates a new instance of WorkflowWorker.
   * @param client - The RocketBase client instance.
   */
  constructor(private client: RocketBaseClient) {}

  /**
   * Starts the worker for one or more workflows.
   * @param workflowName - The name of the workflow(s) to process.
   * @param options - Options for concurrency and resuming pending runs.
   * @returns A promise that resolves when the worker is stopped.
   */
  start(
    workflowName: string | string[],
    options: { concurrency?: number; resume?: boolean } = {},
  ): Promise<void> {
    this.active = true;
    this.ready = false;
    const names = Array.isArray(workflowName) ? workflowName : [workflowName];

    console.log(`[Worker] Starting worker for workflows: ${names.join(", ")}`);

    for (const name of names) {
      this.workflowNames.add(name);
      const unsub = this.client.subscribeWorkflow(name, (job) => {
        if (!this.active) {
          console.log(`[Worker] Worker is not active, ignoring job ${job.id}`);
          return;
        }
        if (!this.ready) {
          console.log(
            `[Worker] Worker is not ready yet, ignoring job ${job.id}`,
          );
          return;
        }
        const promise = this.processJob(job);
        this.activeJobs.add(promise);
        promise.finally(() => this.activeJobs.delete(promise));
      });
      this.unsubscribers.set(name, unsub);
    }

    this.client.waitForWorkflowReady().then(() => {
      console.log(
        `[Worker] Worker is now ready and accepting jobs for workflows: ${
          Array.from(this.workflowNames).join(", ")
        }`,
      );
      this.ready = true;
    }).catch((e) => {
      console.error(`[Worker] Failed to reach ready state:`, e);
    });

    this.pollJobsOnStartup(Array.from(this.workflowNames)).catch((e) => {
      console.error("[Worker] Startup polling failed:", e);
    });

    return new Promise((resolve) => {
      this.stopCallback = resolve;
    });
  }

  /**
   * Resumes pending and running runs for a workflow.
   * @param workflowName - The name of the workflow.
   */
  private async resumePending(workflowName: string): Promise<void> {
    console.log(
      `[Worker ${workflowName}] Polling for pending and running runs...`,
    );

    try {
      const pending = await this.client.workflow.listRuns({
        workflowName,
        status: "pending",
      });
      const running = await this.client.workflow.listRuns({
        workflowName,
        status: "running",
      });

      const all: WorkflowRun[] = [
        ...(pending.items ||
          (pending as unknown as { data: WorkflowRun[] }).data || []),
        ...(running.items ||
          (running as unknown as { data: WorkflowRun[] }).data || []),
      ];

      console.log(
        `[Worker ${workflowName}] Found ${all.length} runs to resume`,
      );

      let resumedCount = 0;
      for (const run of all) {
        try {
          await this.client.workflow.resume(run.runId);
          resumedCount++;
          console.log(
            `[Worker ${workflowName}] Resumed run ${run.runId} (status: ${run.status})`,
          );
        } catch (e: unknown) {
          console.error(
            `[Worker ${workflowName}] Failed to resume run ${run.runId}:`,
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      console.log(
        `[Worker ${workflowName}] Successfully resumed ${resumedCount}/${all.length} runs`,
      );
    } catch (e: unknown) {
      console.error(
        `[Worker ${workflowName}] Error polling for pending runs:`,
        e instanceof Error ? e.message : String(e),
      );
      throw e;
    }
  }

  /**
   * Polls for jobs during startup to ensure no jobs are missed during connection window.
   * @param workflowNames - List of workflow names to poll for.
   */
  private async pollJobsOnStartup(workflowNames: string[]): Promise<void> {
    console.log(
      `[Worker] Polling for jobs on startup for workflows: ${
        workflowNames.join(", ")
      }`,
    );

    for (const name of workflowNames) {
      try {
        await this.resumePending(name);
      } catch (e) {
        console.error(
          `[Worker] Startup polling failed for workflow ${name}:`,
          e,
        );
      }
    }

    console.log(`[Worker] Startup polling completed`);
  }

  /**
   * Stops the worker, closing the connection and waiting for active jobs to complete.
   * @returns A promise that resolves when the worker is fully stopped.
   */
  async stop(): Promise<void> {
    console.log("[Worker] Stopping worker...");
    this.active = false;
    this.ready = false;
    for (const unsub of this.unsubscribers.values()) {
      unsub();
    }
    this.unsubscribers.clear();
    this.confirmedSubscriptions.clear();
    this.pendingSubscriptions.clear();

    if (this.activeJobs.size > 0) {
      console.log(
        `[Worker] Waiting for ${this.activeJobs.size} jobs to complete...`,
      );
      await Promise.allSettled(this.activeJobs);
    }

    console.log("[Worker] Worker stopped");
    if (this.stopCallback) {
      this.stopCallback();
      this.stopCallback = null;
    }
  }

  /**
   * Processes a single job assignment.
   * Reconstructs the workflow state and attempts to execute it.
   * @param job - The job data received from the server.
   * @returns A promise that resolves when the job processing is complete.
   */
  async processJob(job: WorkflowJob): Promise<void> {
    const workflowName = job.data.workflowName || "unknown";
    console.log(`[Worker ${workflowName}] Processing job ${job.id}`);
    const { runId, input } = job.data;

    const heartbeatInterval = setInterval(async () => {
      try {
        await this.client.workflow.touch(job.id);
      } catch (_e) {
        console.warn(
          `[Worker ${workflowName}] Heartbeat failed for job ${job.id}`,
        );
      }
    }, 5000);

    if (
      job.data.workflowName && !this.workflowNames.has(job.data.workflowName)
    ) {
      console.warn(
        `[Worker] Received job for ${job.data.workflowName}, but not registered to handle it. Ignoring.`,
      );
      clearInterval(heartbeatInterval);
      await this.client.workflow.nack(job.id);
      return;
    }

    try {
      const [run, events] = await Promise.all([
        this.client.workflow.getRun(runId),
        this.client.workflow.listEvents(runId),
      ]);

      const Class = WorkflowRegistry.get(workflowName);
      if (!Class) {
        console.error(
          `[Worker ${workflowName}] Workflow class not found in registry. Registered:`,
          Array.from(WorkflowRegistry.keys()),
        );
        clearInterval(heartbeatInterval);
        await this.client.workflow.nack(job.id);
        return;
      }

      const instance = new Class(this.client);
      instance.runId = runId;
      instance.rebuildState(events);

      const timeout = run.executionTimeout || 31536000000;
      let timeoutId: NodeJS.Timeout | number | undefined;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("CircuitBreaker: Execution timeout")),
          timeout,
        );
      });

      try {
        await Promise.race([
          instance.run(...(input || [])),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId as number);
      }

      if (!instance.isSuspended) {
        console.log(
          `[Worker ${workflowName}] Job ${job.id} completed, updating run status`,
        );
        await this.client.workflow.updateRun(runId, {
          status: "completed",
        });
      }

      clearInterval(heartbeatInterval);
      await this.client.workflow.ack(job.id);

      if (instance.isSuspended) {
        console.log(`[Worker ${workflowName}] Job ${job.id} suspended`);
      } else {
        console.log(`[Worker ${workflowName}] Job ${job.id} completed`);
      }
    } catch (e: unknown) {
      clearInterval(heartbeatInterval);

      if (e instanceof WorkflowSuspension) {
        await this.client.workflow.ack(job.id);
        console.log(`[Worker ${workflowName}] Job ${job.id} suspended`);
        return;
      }

      const message = e instanceof Error ? e.message : String(e);
      console.error(
        `[Worker ${workflowName}] Job ${job.id} failed:`,
        message,
      );

      if (message === "CircuitBreaker: Execution timeout") {
        try {
          await this.client.workflow.updateRun(runId, {
            status: "failed",
            error: { message: message },
          });
        } catch (err) {
          console.error(
            `[Worker ${workflowName}] Failed to update run status`,
            err,
          );
        }
      }

      await this.client.workflow.ack(job.id);
    }
  }
}
