/**
 * Internal error used to signal that a workflow execution is suspended.
 * This is caught by the worker to save state and exit the execution loop.
 */
export class WorkflowSuspension extends Error {
  /**
   * Creates a new WorkflowSuspension error.
   * @param message - The reason for suspension.
   */
  constructor(message: string = "Workflow suspended") {
    super(message);
    this.name = "WorkflowSuspension";
  }
}
