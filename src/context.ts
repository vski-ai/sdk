// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

// Runtime-agnostic context storage
// In environments without AsyncLocalStorage (like browsers),
// this uses a global variable which is NOT concurrency-safe for interleaved async calls.
// For browser usage with multiple concurrent workflows, passing context explicitly or
// using class-based workflows is recommended.

let currentContext: any = null;

export const WorkflowContext = {
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
  getStore: () => currentContext,
};
