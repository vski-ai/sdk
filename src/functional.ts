// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import { WorkflowRegistry } from "./registry.ts";
import { WorkflowBase } from "./workflow-base.ts";
import { WorkflowContext as ContextManager } from "./context.ts";
import { WorkflowSuspension } from "./suspension.ts";
import type { WorkflowContext } from "./types.ts";

export function workflow(
  name: string,
  options: { maxEvents?: number; executionTimeout?: number } = {},
) {
  return {
    run: (fn: (ctx: WorkflowContext, ...args: any[]) => Promise<any>) => {
      // Create a dynamic class that extends WorkflowBase
      const FunctionalWorkflow = class extends WorkflowBase {
        static workflowName = name;
        workflowName = name;
        workflowOptions = options;

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

      // Monkey-patch prototype run to add the standard lifecycle logic
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

export function step<T extends (...args: any[]) => Promise<any>>(
  idOrFn: string | T,
  fnOrOptions?: T | {
    retries?: number;
    rollback?: string[];
    timeout?: string;
  },
  options?: { retries?: number; rollback?: string[]; timeout?: string },
): T {
  let id: string;
  let fn: T;
  let opts: any = {};

  if (typeof idOrFn === "string") {
    id = idOrFn;
    fn = fnOrOptions as T;
    opts = options || {};
  } else {
    fn = idOrFn;
    id = ""; // Will be generated at runtime
    opts = fnOrOptions || {};
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
    // Use function name as prefix if available to make it less brittle than just "step"
    const prefix = fn.name || "step";
    const effectiveId = id || context.getSequentialId(prefix);

    // We bind the function to the context so 'this' works inside the step implementation
    return context.executeStep(effectiveId, fn.bind(context), args, opts);
  } as unknown) as T;
}
