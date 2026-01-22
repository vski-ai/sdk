// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import { WorkflowRegistry } from "./registry.ts";
import type { StepOptions, WorkflowOptions } from "./types.ts";
import type { WorkflowBase } from "./workflow-base.ts";
import { WorkflowSuspension } from "./suspension.ts";

/**
 * Decorator to define a class as a Workflow.
 * Wraps the class to handle initialization, execution, and state management via RocketBase.
 * @param name - The unique name of the workflow.
 * @param options - Configuration options for the workflow (e.g., max events, timeout).
 * @returns A class decorator function.
 */
export function Workflow(
  name: string,
  options: WorkflowOptions = {},
): (constructor: Function) => void {
  return function (constructor: Function): void {
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

/**
 * Decorator to define a method as a Step within a Workflow.
 * Wraps the method to provide idempotency, retries, and rollback capabilities.
 * @param id - The unique identifier for the step.
 * @param options - Options for retries, rollback methods, and timeout.
 * @returns A method decorator function.
 */
export function Step(
  id: string,
  options: StepOptions = {},
): (
  _target: any,
  _propertyKey: string,
  descriptor: PropertyDescriptor,
) => void {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ): void {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const self = this as WorkflowBase;
      return self.executeStep(id, originalMethod, args, options);
    };
  };
}
