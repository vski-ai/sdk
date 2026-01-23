// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

/**
 * Manages the execution context for functional workflows.
 * Used to store and retrieve the current workflow instance across async calls.
 */

// Try to use AsyncLocalStorage for concurrency safety in Deno/Node
// Fallback to global variable for browser
let storage: {
  run: <T>(ctx: unknown, fn: () => T) => T;
  getStore: () => unknown;
};

// Check for AsyncLocalStorage (Node/Deno)
// ts-ignore: unstable apis
const AsyncLocalStorage = globalThis.AsyncLocalStorage ||
  // ts-ignore: unstable apis
  ((await import("node:async_hooks").catch(() => ({}))) as Record<
    string,
    unknown
  >).AsyncLocalStorage;

if (AsyncLocalStorage) {
  const als = new AsyncLocalStorage();
  storage = {
    run: (ctx, fn) => als.run(ctx, fn),
    getStore: () => als.getStore(),
  };
} else {
  // Browser fallback - NOT concurrency safe for interleaved async calls
  let currentContext: unknown = null;
  storage = {
    run: <T>(ctx, fn) => {
      const prev = currentContext;
      currentContext = ctx;
      try {
        const result = fn();
        if (result instanceof Promise) {
          return (result as Promise<T>).finally(() => {
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
  if (typeof window !== "undefined") {
    console.warn(
      "[RocketBase] Using global context storage. Interleaved functional workflow execution might be non-deterministic in browser.",
    );
  }
}

export const WorkflowContext = storage;
