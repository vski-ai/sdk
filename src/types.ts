/**
 * Options for realtime subscriptions.
 */
export interface SubscriptionOptions {
  /**
   * The ID of the last event received. Used for resuming subscriptions from a specific point.
   */
  lastId?: string;
  /**
   * The consumer group for the subscription.
   * If specified, events will be distributed among subscribers in the same group.
   */
  group?: string;
}

/**
 * Represents a realtime event from the database.
 */
export interface RealtimeEvent<T = RecordData> {
  /**
   * The type of action that triggered the event.
   */
  action: "create" | "update" | "delete";
  /**
   * The record associated with the event.
   */
  record: T;
}

/**
 * Interface representing the context available within a workflow execution.
 */
export interface WorkflowContext {
  /**
   * The unique identifier for the current workflow run.
   */
  runId: string;
  /**
   * The name of the workflow.
   */
  workflowName: string;
  /**
   * The execution history of the workflow, mapping step IDs to their results.
   */
  history: Map<string, unknown>;
  /**
   * Tracks the number of attempts for each step.
   */
  stepAttempts: Map<string, number>;

  /**
   * Pauses execution for a specified duration.
   * @param duration - The duration to sleep in milliseconds or as a string (e.g., "1s", "5m").
   * @returns A promise that resolves when the sleep is completed.
   */
  sleep(duration: number | string): Promise<void>;
  /**
   * Pauses execution until a specific signal is received.
   * @param name - The name of the signal to wait for.
   * @returns The data payload associated with the signal.
   */
  waitForSignal<T = unknown>(name: string): Promise<T>;
  /**
   * Executes multiple steps in parallel.
   * @param steps - An array of functions returning promises to be executed concurrently.
   * @returns An array of results from the executed steps.
   */
  parallel<T>(steps: (() => Promise<T>)[]): Promise<T[]>;
}

/**
 * Generic type for record data.
 */
export type RecordData = Record<"id", string> & Record<string, unknown>;

/**
 * Represents a paginated list of items.
 */
export interface PaginatedList<T> {
  /** The current page number. */
  page: number;
  /** The number of items per page. */
  perPage: number;
  /** The total number of items available. */
  totalItems: number;
  /** The total number of pages available. */
  totalPages: number;
  /** The items on the current page. */
  items: T[];
}

/**
 * Configuration for creating or connecting to a database.
 */
export interface DatabaseConfig {
  /** The name of the database. */
  name: string;
  /** Optional list of PostgreSQL extensions to enable. */
  extensions?: string[];
  /** Optional SQL script to run when the database is created. */
  initScript?: string;
}

/**
 * Configuration for a single field in a collection.
 */
export interface FieldConfig {
  /** Unique ID of the field. */
  id: string;
  /** Name of the field in the database. */
  name: string;
  /** Type of the field. */
  type:
    | "text"
    | "number"
    | "bool"
    | "email"
    | "url"
    | "date"
    | "select"
    | "json"
    | "file"
    | "relation"
    | "user";
  /** Whether the field is required. */
  required?: boolean;
  /** Whether the field must be unique across all records. */
  unique?: boolean;
  /** Whether the field should be hidden in API responses. */
  hidden?: boolean;
  /** Whether the field is system-managed. */
  system?: boolean;
  /** For relation or file fields, the maximum number of items. */
  maxSelect?: number;
  /** For relation fields, the name of the target collection. */
  toCollection?: string;
  /** Additional field-specific options. */
  options?: Record<string, unknown>;
  /** Default value for the field. */
  default?: unknown;
  /** Catch-all for additional properties. */
  [key: string]: unknown;
}

/**
 * Configuration for a database trigger (webhook).
 */
export interface TriggerConfig {
  /** Unique ID of the trigger. */
  id: string;
  /** Whether the trigger is enabled. */
  enabled: boolean;
  /** The action that triggers the webhook. */
  action: "create" | "update" | "delete" | "INSERT" | "UPDATE" | "DELETE";
  /** The URL to send the webhook request to. */
  url: string;
}

/**
 * Configuration for a full-text search index.
 */
export interface FtsIndexConfig {
  /** Unique ID of the index. */
  id: string;
  /** The fields to include in the index. */
  fields: string[];
}

/**
 * Configuration for a database view.
 */
export interface ViewConfig {
  /** Unique slug for the view. */
  slug: string;
  /** The SQL query defining the view. */
  sql: string;
}

export interface RetentionConfig {
  enabled: boolean;
  days: number;
  query: string;
}

/**
 * Configuration for a collection.
 */
export interface CollectionConfig {
  /** Unique ID of the collection. */
  id: string;
  /** Unique name of the collection. */
  name: string;
  /** Type of the collection. */
  type?: "base" | "auth" | "view" | "timescale";
  /** Whether the collection is system-managed. */
  system?: boolean;
  /** Whether realtime events are enabled for this collection. */
  realtime?: boolean;
  /** Rules for different operations. */
  listRule?: string | null;
  /** Rules for viewing a single record. */
  viewRule?: string | null;
  /** Rules for creating a record. */
  createRule?: string | null;
  /** Rules for updating a record. */
  updateRule?: string | null;
  /** Rules for deleting a record. */
  deleteRule?: string | null;
  /** Fields defined in the collection. */
  fields: FieldConfig[];
  /** Triggers (webhooks) for the collection. */
  triggers?: TriggerConfig[];
  /** Standard database indexes. */
  indexes?: string[];
  /** Full-text search indexes. */
  ftsIndexes?: FtsIndexConfig[];
  /** Database views. */
  views?: ViewConfig[];
  /** Field-level access rules. */
  fieldRules?: Record<string, string[]>;
  /** Tags for organizing collections. */
  tags?: string | null;
  /** Additional collection-specific options. */
  options?: Record<string, unknown>;

  // Retention Config
  retention?: RetentionConfig;
}

/**
 * Details about available authentication methods.
 */
export interface AuthMethods {
  /** Whether email/password authentication is enabled. */
  emailPassword: boolean;
  /** Configuration for OAuth2 providers. */
  oauth2: {
    /** List of available providers. */
    providers: {
      /** Name of the provider. */
      name: string;
      /** URL for the authorization endpoint. */
      authUrl: string;
    }[];
  };
}

/**
 * Response from an authentication request.
 */
export interface AuthResponse {
  /** JWT token. */
  token: string;
  /** Authenticated user data. */
  user: RecordData;
}

/**
 * Represents a registered cron job.
 */
export interface CronJob {
  /** Unique ID of the cron job. */
  id: number;
  /** Name of the cron job. */
  name: string;
  /** Cron schedule expression. */
  schedule: string;
  /** SQL command or HTTP request to execute. */
  command: string;
  /** Database context for the job. */
  database: string;
  /** Whether the job is active. */
  active: boolean;
}

/**
 * Configuration for creating a new cron job.
 */
export interface CronJobConfig {
  /** Name of the cron job. */
  name: string;
  /** Cron schedule expression. */
  schedule: string;
  /** Type of task to perform. */
  type: "sql" | "http";
  /** SQL script for 'sql' type tasks. */
  sql?: string;
  /** URL for 'http' type tasks. */
  url?: string;
  /** HTTP method for 'http' type tasks. */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Request body for 'http' type tasks. */
  body?: string;
  /** Content type for 'http' type tasks. */
  contentType?: "json" | "urlencoded";
}

/**
 * Represents a log entry for a webhook execution.
 */
export interface WebhookLog {
  /** Unique ID of the log entry. */
  id: string;
  /** URL that was called. */
  url: string;
  /** Data that was sent. */
  payload: {
    /** Target database. */
    database: string;
    /** Target collection. */
    collection: string;
    /** ID of the triggering record. */
    id: string;
    /** Action that triggered the webhook. */
    action: string;
    /** When the event occurred. */
    timestamp: string;
  };
  /** Execution status. */
  status: "pending" | "processing" | "success" | "failed";
  /** HTTP response status code. */
  http_status: number | null;
  /** Error message if execution failed. */
  error_msg: string | null;
  /** Response body from the target URL. */
  response_body: string | null;
  /** Number of times the webhook has been tried. */
  tries: number;
  /** Creation timestamp. */
  created_at: string;
  /** Last update timestamp. */
  updated_at: string;
}

/**
 * Represents a workflow run.
 */
export interface WorkflowRun {
  /** Unique identifier for the run. */
  runId: string;
  /** Identifier of the deployment that executed the run. */
  deploymentId: string;
  /** Name of the executed workflow. */
  workflowName: string;
  /** Current execution status. */
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  /** Arguments passed to the workflow. */
  input: unknown[];
  /** Final output of the workflow. */
  output: unknown;
  /** Error details if the run failed. */
  error: {
    /** Error message. */
    message: string;
    /** Optional stack trace. */
    stack?: string;
  } | null;
  /** Context data used during execution. */
  executionContext: RecordData;
  /** Current count of events generated by the run. */
  eventCount: number;
  /** Maximum allowed number of events for the run. */
  maxEvents: number;
  /** Execution timeout in milliseconds. */
  executionTimeout: number;
  /** When the run started execution. */
  startedAt: string | null;
  /** When the run completed execution. */
  completedAt: string | null;
  /** When the run record was created. */
  createdAt: string;
  /** When the run record was last updated. */
  updatedAt: string;
}

/**
 * Aggregated statistics for workflows.
 */
export interface WorkflowStats {
  /** Total number of workflow runs. */
  total: number;
  /** Number of currently active runs. */
  active: number;
  /** Number of successfully completed runs. */
  completed: number;
  /** Number of failed runs. */
  failed: number;
}

/**
 * Represents a database migration record.
 */
export interface Migration {
  /** Unique ID of the migration. */
  id: string;
  /** Name of the migration. */
  name: string;
  /** When the migration was applied. */
  appliedAt: string;
  /** Batch number for grouping migrations. */
  batch: number;
}

/**
 * Represents an event within a workflow run.
 */
export interface WorkflowEvent {
  /** Unique ID of the event. */
  eventId: string;
  /** ID of the workflow run this event belongs to. */
  runId: string;
  /** Optional ID of the step that generated the event. */
  stepId?: string | null;
  /** Type identifier for the event. */
  eventType: string;
  /** Correlation identifier for matching events. */
  correlationId?: string | null;
  /** Data payload for the event. */
  payload: Record<string, unknown>;
  /** When the event occurred. */
  createdAt: string;
}

/**
 * Represents a job assignment for a workflow worker.
 */
export interface WorkflowJob {
  /** Unique ID of the job message. */
  id: string;
  /** Job data payload. */
  data: {
    /** ID of the run to process. */
    runId: string;
    /** Name of the workflow. */
    workflowName: string;
    /** Input arguments for the workflow run. */
    input?: unknown[];
  };
}

/**
 * Options for starting a workflow.
 */
export interface WorkflowOptions {
  /** Maximum number of events allowed for the run. */
  maxEvents?: number;
  /** Maximum time allowed for execution in milliseconds. */
  executionTimeout?: number;
  /** Deployment identifier. */
  deploymentId?: string;
}

/**
 * Options for a single workflow step.
 */
export interface StepOptions {
  /** Number of retry attempts if step fails. */
  retries?: number;
  /** List of method names to call for rollback if workflow fails (decorator style). */
  rollback?: string[];
  /** Rollback function to call directly if step fails (functional style). */
  rollbackFn?: (error: unknown, accumulator: any) => Promise<any> | any;
  /** Timeout for step (not currently implemented in worker). */
  timeout?: string;
}
