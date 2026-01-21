// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import { WorkflowRegistry } from "./registry.ts";
import type { WorkflowBase } from "./workflow-base.ts";
import { WorkflowSuspension } from "./suspension.ts";

export function Workflow(
  name: string,
  options: { maxEvents?: number; executionTimeout?: number } = {},
) {
  return function (constructor: Function) {
    WorkflowRegistry.set(name, constructor);
    constructor.prototype.workflowName = name;
    constructor.prototype.workflowOptions = options;

    const originalRun = constructor.prototype.run;
    if (originalRun) {
      constructor.prototype.run = async function (...args: any[]) {
        const self = this as WorkflowBase;
        if (!self.client) throw new Error("Workflow needs a RocketBaseClient.");

        if (!self.runId) {
          const run = await self.client.workflow.trigger(name, args, options);
          self.runId = run.runId;
        }

        // Update status to running
        await self.client.workflow.updateRun(self.runId, { status: "running" });

        try {
          const result = await originalRun.apply(self, args);
          if (!self.isSuspended) {
            await self.client.workflow.updateRun(self.runId, {
              status: "completed",
              output: result,
            });
          }
          return result;
        } catch (e: any) {
          if (e instanceof WorkflowSuspension) {
            // Workflow is suspended, just exit.
            // Note: isSuspended is already true.
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
    }
  };
}

export function Step(
  id: string,
  options: { retries?: number; rollback?: string[]; timeout?: string } = {},
) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const self = this as WorkflowBase;
      return self.executeStep(id, originalMethod, args, options);
    };
  };
}
