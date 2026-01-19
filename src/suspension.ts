export class WorkflowSuspension extends Error {
  constructor(message: string = "Workflow suspended") {
    super(message);
    this.name = "WorkflowSuspension";
  }
}
