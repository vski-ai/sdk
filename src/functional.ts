// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import { WorkflowRegistry } from "./registry.ts";
import { WorkflowBase } from "./workflow-base.ts";
import { WorkflowContext as ContextManager } from "./context.ts";
import { WorkflowSuspension } from "./suspension.ts";
import type { WorkflowContext } from "./types.ts";

export function workflow(name: string) {
  return {
    run: (fn: (ctx: WorkflowContext, ...args: any[]) => Promise<any>) => {
      // Create a dynamic class that extends WorkflowBase
      const FunctionalWorkflow = class extends WorkflowBase {
        static workflowName = name;
        workflowName = name;

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
          const run = await self.client.workflow.trigger(name, args);
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

export function step(
  idOrFn: string | ((...args: any[]) => Promise<any>),
  fnOrOptions?: ((...args: any[]) => Promise<any>) | {
    retries?: number;
    rollback?: string[];
    timeout?: string;
  },
  options?: { retries?: number; rollback?: string[]; timeout?: string },
) {
  let id: string;
  let fn: (...args: any[]) => Promise<any>;
  let opts: any = {};

  if (typeof idOrFn === "string") {
    id = idOrFn;
    fn = fnOrOptions as any;
    opts = options || {};
  } else {
    // Auto-generate ID if possible or require it?
    // User example: const stepA = step(async () => {})
    // We can't easily auto-generate stable IDs from anonymous functions without a build step.
    // We'll require ID or use a random one (which breaks determinism on replay!).
    // Ideally we require ID. But let's support the user example by assuming
    // they might rely on execution order if we used a counter, but re-execution order must be deterministic.
    // If the user assigns to a const, we don't know the const name.
    // Let's THROW if no ID is provided for now to encourage best practice,
    // OR generate one based on order if we had a global counter in context (but we define step OUTSIDE context).

    // User example: `const stepA = step(async () => {})`
    // This defines `stepA`.
    // If we return a wrapper, when executed inside `run`, we can get the workflow instance.
    // The instance has a call counter `getDeterministicId`. We can use that!

    fn = idOrFn;
    id = ""; // Will be generated at runtime
    opts = fnOrOptions || {};
  }

  return async function (this: WorkflowContext | void, ...args: any[]) {
    const context = (this instanceof WorkflowBase)
      ? this as unknown as WorkflowBase
      : ContextManager.getStore() as WorkflowBase;

    if (!context) {
      // If called outside of workflow context, just run the function
      return await fn(...args);
    }

    // Generate ID if missing using the context's deterministic counter
    const effectiveId = id || context.getDeterministicId("step");

    // We bind the function to the context so 'this' works inside the step implementation
    return context.executeStep(effectiveId, fn.bind(context), args, opts);
  };
}
