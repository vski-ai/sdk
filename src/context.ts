// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

// Runtime-agnostic context storage
// In environments without AsyncLocalStorage (like browsers),
// this uses a global variable which is NOT concurrency-safe for interleaved async calls.
// For browser usage with multiple concurrent workflows, passing context explicitly or
// using class-based workflows is recommended.

let currentContext: any = null;

/**
 * Manages the execution context for functional workflows.
 * Used to store and retrieve the current workflow instance across async calls.
 */
export const WorkflowContext = {
  /**
   * Runs a function within a specific context.
   * @param ctx - The context object to store.
   * @param fn - The function to execute.
   * @returns The result of the function execution.
   */
  run: <T>(ctx: any, fn: () => T): T => {
    const prev = currentContext;
    currentContext = ctx;
    try {
      const result = fn();
      if (result instanceof Promise) {
        return (result as any).finally(() => {
          currentContext = prev;
        });
      }
      currentContext = prev;
      return result;
    } catch (e) {
      currentContext = prev;
      throw e;
    }
  },
  /**
   * Retrieves the current execution context.
   * @returns The current context object.
   */
  getStore: () => currentContext,
};
