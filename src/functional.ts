// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import { WorkflowRegistry } from "./registry.ts";
import { WorkflowBase } from "./workflow-base.ts";
import { WorkflowContext as ContextManager } from "./context.ts";
import { WorkflowSuspension } from "./suspension.ts";
import type { StepOptions, WorkflowContext, WorkflowOptions } from "./types.ts";

/**
 * Defines a functional workflow.
 * @param name - The unique name of the workflow.
 * @param options - Configuration options for the workflow.
 * @returns An object with a `run` method to define workflow logic.
 */
export function workflow(
  name: string,
  options: WorkflowOptions = {},
): {
  run: (
    fn: (ctx: WorkflowContext, ...args: any[]) => Promise<any>,
  ) => typeof WorkflowBase;
} {
  return {
    /**
     * Defines the execution logic of the workflow.
     * @param fn - A function that takes a context object and arguments, returning a Promise.
     * @returns A class constructor that implements the workflow.
     */
    run: (
      fn: (ctx: WorkflowContext, ...args: any[]) => Promise<any>,
    ): typeof WorkflowBase => {
      // Create a dynamic class that extends WorkflowBase
      const FunctionalWorkflow = class extends WorkflowBase {
        static workflowName = name;
        override workflowName = name;
        override workflowOptions = options;

        async run(...args: any[]) {
          const self = this;
          return await ContextManager.run(this, async () => {
            try {
              return await (fn as any).call(self, self, ...args);
            } catch (e: any) {
              throw e;
            }
          });
        }
      };

      // Register context-aware wrapper similar to @Workflow decorator
      WorkflowRegistry.set(name, FunctionalWorkflow);

      // Monkey-patch prototype run to add standard lifecycle logic
      // (trigger check, status updates, rollback)
      // This duplicates logic from @Workflow decorator. Ideally we extract it.
      // But for now, let's implement it here.

      const originalRun = FunctionalWorkflow.prototype.run;
      FunctionalWorkflow.prototype.run = async function (...args: any[]) {
        const self = this as WorkflowBase;
        if (!self.client) throw new Error("Workflow needs a RocketBaseClient.");

        if (!self.runId) {
          const run = await self.client.workflow.trigger(name, args, options);
          self.runId = run.runId;
        }

        // Update status to running
        await self.client.workflow.updateRun(self.runId, { status: "running" });

        try {
          const result = await (originalRun as any).apply(self, args);
          if (!self.isSuspended) {
            await self.client.workflow.updateRun(self.runId, {
              status: "completed",
              output: result,
            });
          }
          return result;
        } catch (e: any) {
          if (e instanceof WorkflowSuspension) {
            return;
          }
          console.error(`[Workflow ${name}] Failed:`, e.message);
          try {
            await self.runRollback(e);
          } catch (re: any) {
            console.error(`[Workflow ${name}] Rollback failed:`, re.message);
          }
          await self.client.workflow.updateRun(self.runId!, {
            status: "failed",
            error: { message: e.message, stack: e.stack },
          });
          throw e;
        }
      };

      return FunctionalWorkflow;
    },
  };
}

/**
 * Defines a step within a functional workflow.
 * Can be used to wrap a function or define a block of code as a step.
 * @param idOrFn - The step ID (string) or function to wrap.
 * @param fnOrOptions - The function (if ID was first) or options (if function was first).
 * @param options - Options for retries, rollback, etc. (if ID was first).
 * @returns A wrapped function that executes as a workflow step.
 */
export function step<T extends (...args: any[]) => Promise<any>>(
  idOrFn: string | T,
  fnOrOptions?: T | StepOptions,
  options?: StepOptions,
): T {
  let id: string;
  let fn: T;
  let opts: StepOptions = {};

  if (typeof idOrFn === "string") {
    id = idOrFn;
    fn = fnOrOptions as T;
    opts = options || {};
  } else {
    fn = idOrFn;
    id = ""; // Will be generated at runtime
    opts = (fnOrOptions as StepOptions) || {};
  }

  // Merge rollbackFn from options for functional style
  if (options && options.rollbackFn) {
    opts.rollbackFn = options.rollbackFn;
  }

  return (async function (this: WorkflowContext | void, ...args: any[]) {
    const context = (this instanceof WorkflowBase)
      ? this as unknown as WorkflowBase
      : ContextManager.getStore() as WorkflowBase;

    if (!context) {
      // If called outside of workflow context, just run the function
      return await fn(...args);
    }

    // Generate ID if missing using the context's deterministic counter
    // Use 'step' as prefix to ensure stability across different environments/transpilations
    const effectiveId = id || context.getSequentialId("step");

    // We bind the function to context so 'this' works inside the step implementation
    // Pass original fn.name for better observability in logs
    return context.executeStep(
      effectiveId,
      fn.bind(context),
      args,
      opts,
      fn.name,
    );
  } as unknown) as T;
}
