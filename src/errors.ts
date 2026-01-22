// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

/**
 * Error thrown to stop the rollback process in a workflow.
 * When thrown inside a rollback handler, it prevents further rollback steps from executing.
 */
export class StopRollback extends Error {
  /**
   * Creates a new StopRollback error.
   * @param message - The error message.
   */
  constructor(message: string = "Rollback stopped") {
    super(message);
    this.name = "StopRollback";
  }
}
