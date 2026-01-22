// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import type { RocketBaseClient } from "./client.ts";
import { WorkflowRegistry } from "./registry.ts";
import { WorkflowSuspension } from "./suspension.ts";
import type { WorkflowJob } from "./types.ts";

/**
 * Worker class responsible for polling and executing workflow jobs.
 * Connects to the RocketBase backend via WebSocket to receive job assignments.
 */
export class WorkflowWorker {
  private socket: WebSocket | null = null;
  private active = false;
  private workflowName: string = "";
  private stopCallback: (() => void) | null = null;
  private activeJobs = new Set<Promise<void>>();

  /**
   * Creates a new instance of WorkflowWorker.
   * @param client - The RocketBase client instance.
   */
  constructor(private client: RocketBaseClient) {}

  /**
   * Starts the worker for a specific workflow.
   * @param workflowName - The name of the workflow to process.
   * @param options - Options for concurrency and resuming pending runs.
   * @returns A promise that resolves when the worker is stopped.
   */
  async start(
    workflowName: string,
    options: { concurrency?: number; resume?: boolean } = {},
  ): Promise<void> {
    this.active = true;
    this.workflowName = workflowName;
    this.connect(workflowName);

    if (options.resume) {
      this.resumePending(workflowName).catch((e) =>
        console.error(`[Worker ${workflowName}] Resume failed:`, e)
      );
    }

    return new Promise((resolve) => {
      this.stopCallback = resolve;
    });
  }

  /**
   * Resumes pending and running runs for the workflow.
   * @param workflowName - The name of the workflow.
   */
  private async resumePending(workflowName: string): Promise<void> {
    // Fetch runs that are not completed/failed
    const pending = await this.client.workflow.listRuns({
      workflowName,
      status: "pending",
    });
    const running = await this.client.workflow.listRuns({
      workflowName,
      status: "running",
    });

    const all = [...pending.items, ...running.items];
    console.log(`[Worker ${workflowName}] Resuming ${all.length} runs`);

    for (const run of all) {
      await this.client.workflow.resume(run.runId);
    }
  }

  /**
   * Stops the worker, closing the connection and waiting for active jobs to complete.
   * @returns A promise that resolves when the worker is fully stopped.
   */
  async stop(): Promise<void> {
    this.active = false;
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }

    if (this.activeJobs.size > 0) {
      console.log(
        `[Worker ${this.workflowName}] Waiting for ${this.activeJobs.size} jobs to complete...`,
      );
      await Promise.allSettled(this.activeJobs);
    }

    if (this.stopCallback) {
      this.stopCallback();
      this.stopCallback = null;
    }
  }

  /**
   * Establishes a WebSocket connection to the workflow server.
   * @param workflowName - The name of the workflow to subscribe to.
   */
  private connect(workflowName: string): void {
    if (!this.active) return;
    if (
      this.socket &&
      (this.socket.readyState === 0 || this.socket.readyState === 1)
    ) {
      return;
    }

    // Use ws:// for http:// and wss:// for https://
    const token = this.client.getToken();
    const wsUrl = this.client.baseUrl.replace(/^http/, "ws") +
      "/api/workflow/ws" +
      `?db=${this.client.dbName}` +
      (token ? `&auth=${token}` : "");

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log(`[Worker ${workflowName}] Connected to ${wsUrl}`);
      this.socket?.send(JSON.stringify({
        event: "SUBSCRIBE",
        data: { queue: `__wkf_workflow_${workflowName}` },
      }));
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "JOB") {
          const promise = this.processJob(msg.data);
          this.activeJobs.add(promise);
          promise.finally(() => this.activeJobs.delete(promise));
        }
      } catch (e) {
        console.error(`[Worker ${workflowName}] Error handling message:`, e);
      }
    };

    this.socket.onclose = () => {
      if (this.active) {
        console.log(`[Worker ${workflowName}] Disconnected, retrying...`);
        setTimeout(() => this.connect(workflowName), 3000);
      }
    };

    this.socket.onerror = (e) => {
      console.error(`[Worker ${workflowName}] WebSocket error:`, e);
    };
  }

  /**
   * Processes a single job assignment.
   * Reconstructs the workflow state and attempts to execute it.
   * @param job - The job data received from the server.
   * @returns A promise that resolves when the job processing is complete.
   */
  async processJob(job: WorkflowJob): Promise<void> {
    console.log(`[Worker ${this.workflowName}] Processing job ${job.id}`);
    const { runId, input } = job.data;

    // Start heartbeat
    const heartbeatInterval = setInterval(async () => {
      try {
        await this.client.workflow.touch(job.id);
      } catch (e) {
        console.warn(
          `[Worker ${this.workflowName}] Heartbeat failed for job ${job.id}`,
        );
      }
    }, 15000); // Every 15 seconds (well within the 30s timeout)

    // The job.data should contain the inputs
    // Check for correct workflow
    if (job.data.workflowName && job.data.workflowName !== this.workflowName) {
      console.warn(
        `[Worker ${this.workflowName}] Received job for ${job.data.workflowName}, ignoring`,
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

      const Class = WorkflowRegistry.get(this.workflowName);
      if (!Class) {
        console.error(
          `[Worker ${this.workflowName}] Workflow class not found in registry. Registered:`,
          Array.from(WorkflowRegistry.keys()),
        );
        clearInterval(heartbeatInterval);
        await this.client.workflow.nack(job.id);
        return;
      }

      const instance = new Class(this.client);
      instance.runId = runId;
      instance.rebuildState(events);

      // Execute with timeout
      const timeout = run.executionTimeout || 30000;
      let timeoutId: any;
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
        clearTimeout(timeoutId);
      }

      // If we get here, execution completed successfully (or suspended successfully)
      // Ack the job
      clearInterval(heartbeatInterval);
      await this.client.workflow.ack(job.id);
      if (instance.isSuspended) {
        console.log(`[Worker ${this.workflowName}] Job ${job.id} suspended`);
      } else {
        console.log(`[Worker ${this.workflowName}] Job ${job.id} completed`);
      }
    } catch (e: any) {
      clearInterval(heartbeatInterval);

      if (e instanceof WorkflowSuspension) {
        await this.client.workflow.ack(job.id);
        console.log(`[Worker ${this.workflowName}] Job ${job.id} suspended`);
        return;
      }

      console.error(
        `[Worker ${this.workflowName}] Job ${job.id} failed:`,
        e.message,
      );

      if (e.message === "CircuitBreaker: Execution timeout") {
        try {
          await this.client.workflow.updateRun(runId, {
            status: "failed",
            error: { message: e.message },
          });
        } catch (err) {
          console.error(
            `[Worker ${this.workflowName}] Failed to update run status:`,
            err,
          );
        }
      }

      // The workflow run status is already updated by the decorators to 'failed' if it bubbled up.
      // We should ack the job because we processed it (and it failed),
      // OR nack it if we want to retry?
      // If the error was handled by decorators, instance.run might throw.
      // If it throws, it means it failed.
      // If we nack, it will retry.
      // The Step decorator has retry logic. If it bubbles up, it means retries exhausted.
      // So we should probably ACK it to stop retrying the WORKFLOW job, unless it was a transient system error.
      // But for now, let's ACK it so we don't loop forever on a bug.
      await this.client.workflow.ack(job.id);
    }
  }
}
