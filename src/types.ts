export interface SubscriptionOptions {
  lastId?: string;
  group?: string;
}

export interface RealtimeEvent {
  action: "create" | "update" | "delete";
  record: any;
}

export interface WorkflowContext {
  runId: string;
  workflowName: string;
  history: Map<string, any>;
  stepAttempts: Map<string, number>;

  sleep(duration: number | string): Promise<void>;
  waitForSignal<T = any>(name: string): Promise<T>;
  parallel<T>(steps: (() => Promise<T>)[]): Promise<T[]>;
}
