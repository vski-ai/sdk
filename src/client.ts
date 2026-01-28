// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import type {
  AuthMethods,
  AuthResponse,
  CollectionConfig,
  CronJob,
  CronJobConfig,
  DatabaseConfig,
  Migration,
  PaginatedList,
  RealtimeEvent,
  RecordData,
  SubscriptionOptions,
  WebhookLog,
  WorkflowEvent,
  WorkflowRun,
  WorkflowStats,
} from "./types.ts";
import { WorkflowRegistry } from "./registry.ts";

/**
 * Main client for interacting with the RocketBase backend.
 * Provides access to databases, collections, authentication, workflows, and realtime features.
 */
export class RocketBaseClient {
  /** The base URL of the RocketBase server. */
  public baseUrl: string;
  private token: string | null = null;
  private apiKey: string | null = null;
  /** The name of the database to use. */
  public dbName: string = "postgres"; // Changed to public for Worker access
  private adminDbName: string = "postgres";
  private realtimeSocket: WebSocket | null = null;
  private workflowSocket: WebSocket | null = null;
  private subscriptions = new Map<
    string,
    {
      callback: (e: RealtimeEvent) => void;
      options?: SubscriptionOptions;
    }
  >();
  private workflowSubscriptions = new Map<string, Set<(job: any) => void>>();

  /**
   * Creates a new instance of the RocketBase client.
   * @param baseUrl - The base URL of the RocketBase server (default: http://127.0.0.1:3000).
   */
  constructor(baseUrl: string = "http://127.0.0.1:3000") {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem("rb_auth_token");
      this.apiKey = localStorage.getItem("rb_api_key");
    }
  }

  /**
   * Retrieves the current authentication token.
   * @returns The JWT token or null if not set.
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Sets the authentication token.
   * Updates the local storage and manages the realtime connection.
   * @param token - The new JWT token or null to clear it.
   */
  setToken(token: string | null): void {
    this.token = token;
    if (typeof window !== "undefined") {
      if (token) {
        localStorage.setItem("rb_auth_token", token);
      } else {
        localStorage.removeItem("rb_auth_token");
      }
    }
    if (this.realtimeSocket) {
      this.realtimeSocket.close();
    }
  }

  /**
   * Sets the API key for backend-to-backend communication.
   * @param key - The API key or null to clear it.
   */
  setApiKey(key: string | null): void {
    this.apiKey = key;
    if (typeof window !== "undefined") {
      if (key) {
        localStorage.setItem("rb_api_key", key);
      } else {
        localStorage.removeItem("rb_api_key");
      }
    }
  }

  /**
   * Sets the target database for subsequent requests.
   * @param db - The name of the database.
   */
  setDb(db: string): void {
    this.dbName = db;
    if (this.realtimeSocket) {
      this.realtimeSocket.close();
    }
  }

  /**
   * Sets the target admin database for administrative requests.
   * @param db - The name of the admin database (default: postgres).
   */
  setAdminDb(db: string): void {
    this.adminDbName = db;
    if (this.realtimeSocket) {
      this.realtimeSocket.close();
    }
  }

  /**
   * Closes the client and terminates any active realtime connections.
   */
  close(): void {
    if (this.realtimeSocket) {
      this.realtimeSocket.onopen = null;
      this.realtimeSocket.onmessage = null;
      this.realtimeSocket.onerror = null;
      this.realtimeSocket.onclose = null;
      this.realtimeSocket.close();
      this.realtimeSocket = null;
    }
    if (this.workflowSocket) {
      this.workflowSocket.onopen = null;
      this.workflowSocket.onmessage = null;
      this.workflowSocket.onerror = null;
      this.workflowSocket.onclose = null;
      this.workflowSocket.close();
      this.workflowSocket = null;
    }
    this.subscriptions.clear();
    this.workflowSubscriptions.clear();
  }

  /**
   * Subscribes a worker to jobs for a specific workflow.
   * @param workflowName - The name of the workflow.
   * @param callback - Function called when a job is received.
   * @returns A function to unsubscribe.
   */
  subscribeWorkflow(
    workflowName: string,
    callback: (job: any) => void,
  ): () => void {
    if (!this.workflowSubscriptions.has(workflowName)) {
      this.workflowSubscriptions.set(workflowName, new Set());
    }
    this.workflowSubscriptions.get(workflowName)!.add(callback);
    this.connectWorkflow();

    if (this.workflowSocket?.readyState === 1) {
      this.workflowSocket.send(
        JSON.stringify({
          event: "SUBSCRIBE",
          data: { queue: `__wkf_workflow_${workflowName}` },
        }),
      );
    }

    return () => {
      const subs = this.workflowSubscriptions.get(workflowName);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.workflowSubscriptions.delete(workflowName);
        }
      }
    };
  }

  /** Connects to the workflow WebSocket server. */
  private connectWorkflow(): void {
    if (typeof WebSocket === "undefined") return;
    if (
      this.workflowSocket &&
      (this.workflowSocket.readyState === 0 ||
        this.workflowSocket.readyState === 1)
    ) {
      return;
    }

    const token = this.getToken() || this.apiKey;
    const wsUrl = this.baseUrl.replace(/^http/, "ws") +
      "/api/workflow/ws" +
      `?db=${this.dbName}` +
      (token ? `&auth=${token}` : "");

    this.workflowSocket = new WebSocket(wsUrl);

    this.workflowSocket.onopen = () => {
      this.workflowSubscriptions.forEach((_, name) => {
        this.workflowSocket?.send(
          JSON.stringify({
            event: "SUBSCRIBE",
            data: { queue: `__wkf_workflow_${name}` },
          }),
        );
      });
    };

    this.workflowSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "JOB") {
          const workflowName = msg.data?.data?.workflowName;
          if (!workflowName) return;

          const subs = this.workflowSubscriptions.get(workflowName);
          if (subs && subs.size > 0) {
            // Load balance among local workers if multiple exist
            const arr = Array.from(subs);
            const listener = arr[Math.floor(Math.random() * arr.length)];
            listener(msg.data);
          }
        }
      } catch (e) {
        console.error("Error handling workflow message:", e);
      }
    };

    this.workflowSocket.onclose = () => {
      if (this.workflowSubscriptions.size > 0) {
        setTimeout(() => this.connectWorkflow(), 3000);
      }
    };
  }

  /** Headers for standard requests. */
  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "x-dbname": this.dbName,
    };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  /** Headers for administrative requests. */
  private get adminHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "x-dbname": this.adminDbName,
    };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  /**
   * Namespace for system settings and configuration (Databases, Collections).
   * @returns An object with database and collection management methods.
   */
  get settings(): {
    databases: {
      list: () => Promise<string[]>;
      create: (data: DatabaseConfig) => Promise<unknown>;
      delete: (name: string) => Promise<boolean>;
    };
    collections: {
      create: (data: CollectionConfig) => Promise<unknown>;
      update: (id: string, data: Partial<CollectionConfig>) => Promise<unknown>;
      delete: (id: string) => Promise<boolean>;
      getList: () => Promise<PaginatedList<CollectionConfig>>;
    };
  } {
    // @ts-ignore:
    const self = this;
    return {
      /**
       * Database management operations.
       */
      databases: {
        /**
         * Lists all available databases.
         */
        list: async (): Promise<string[]> => {
          const res = await fetch(`${self.baseUrl}/api/databases`, {
            headers: self.headers,
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        /**
         * Creates a new database.
         * @param data - Configuration for the new database.
         */
        create: async (data: DatabaseConfig): Promise<unknown> => {
          const res = await fetch(`${self.baseUrl}/api/databases`, {
            method: "POST",
            headers: self.headers,
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        /**
         * Deletes a database by name.
         * @param name - The name of the database to delete.
         */
        delete: async (name: string): Promise<boolean> => {
          const res = await fetch(`${self.baseUrl}/api/databases/${name}`, {
            method: "DELETE",
            headers: self.headers,
          });
          if (!res.ok) throw new Error(await res.text());
          await res.text();
          return true;
        },
      },
      /**
       * Collection management operations.
       */
      collections: {
        /**
         * Creates a new collection.
         * @param data - The collection schema definition.
         */
        create: async (data: CollectionConfig): Promise<unknown> => {
          const res = await fetch(`${self.baseUrl}/api/collections`, {
            method: "POST",
            headers: self.headers,
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        /**
         * Updates an existing collection.
         * @param id - The ID or name of the collection.
         * @param data - The fields to update.
         */
        update: async (
          id: string,
          data: Partial<CollectionConfig>,
        ): Promise<unknown> => {
          const res = await fetch(`${self.baseUrl}/api/collections/${id}`, {
            method: "PATCH",
            headers: self.headers,
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        /**
         * Deletes a collection.
         * @param id - The ID or name of the collection.
         */
        delete: async (id: string): Promise<boolean> => {
          const res = await fetch(`${self.baseUrl}/api/collections/${id}`, {
            method: "DELETE",
            headers: self.headers,
          });
          if (!res.ok) throw new Error(await res.text());
          await res.text();
          return true;
        },
        /**
         * Lists all collections.
         */
        getList: async (): Promise<PaginatedList<CollectionConfig>> => {
          const res = await fetch(`${self.baseUrl}/api/collections`, {
            headers: self.headers,
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
      },
    };
  }

  /**
   * Namespace for authentication operations (Login, Register, OAuth).
   * @returns An object with authentication methods.
   */
  get auth(): {
    login: (email: string, pass: string) => Promise<AuthResponse>;
    register: (data: RecordData) => Promise<unknown>;
    me: () => Promise<RecordData>;
    listMethods: () => Promise<AuthMethods>;
    authViaOAuth2: (
      provider: string,
      code: string,
      redirectUrl: string,
    ) => Promise<AuthResponse>;
  } {
    const self = this;
    return {
      /**
       * Login using the configured default auth collection.
       * @param email - The user's email.
       * @param pass - The user's password.
       */
      login: async (email: string, pass: string): Promise<AuthResponse> => {
        const res = await fetch(`${self.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: self.headers,
          body: JSON.stringify({ identity: email, password: pass }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        self.setToken(data.token);
        return data;
      },
      /**
       * Register a new user in the configured default auth collection.
       * @param data - The user registration data.
       */
      register: async (data: RecordData): Promise<unknown> => {
        const res = await fetch(`${self.baseUrl}/api/auth/register`, {
          method: "POST",
          headers: self.headers,
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      /**
       * Get the profile of the currently logged in user.
       */
      me: async (): Promise<RecordData> => {
        const res = await fetch(`${self.baseUrl}/api/auth/me`, {
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      /**
       * List available auth methods (OAuth providers).
       */
      listMethods: async (): Promise<AuthMethods> => {
        const res = await fetch(`${self.baseUrl}/api/auth/methods`, {
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      /**
       * Login via OAuth2 code.
       * @param provider - The OAuth2 provider name (e.g., 'google', 'github').
       * @param code - The authorization code returned by the provider.
       * @param redirectUrl - The redirect URL used in the initial auth request.
       */
      authViaOAuth2: async (
        provider: string,
        code: string,
        redirectUrl: string,
      ): Promise<AuthResponse> => {
        const res = await fetch(`${self.baseUrl}/api/auth/oauth2-login`, {
          method: "POST",
          headers: self.headers,
          body: JSON.stringify({ provider, code, redirectUrl }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        self.setToken(data.token);
        return data;
      },
    };
  }

  /**
   * Namespace for API key management.
   * @returns An object with API key management methods.
   */
  get keys(): {
    generate: (data: {
      name?: string;
      enabled?: boolean;
    }) => Promise<unknown>;
  } {
    const self = this;
    return {
      /**
       * Generates a new API key.
       * @param data - Configuration for the new key.
       */
      generate: async (data: {
        name?: string;
        enabled?: boolean;
      }): Promise<unknown> => {
        const res = await fetch(`${self.baseUrl}/api/keys`, {
          method: "POST",
          headers: self.adminHeaders,
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    };
  }

  /**
   * Namespace for admin-level operations.
   * @returns An object with administrative methods.
   */
  get admins(): {
    authWithPassword: (
      identity: string,
      password: string,
    ) => Promise<AuthResponse>;
    init: (data: { email: string; password: string }) => Promise<unknown>;
    hasAdmins: () => Promise<{ hasAdmins: boolean }>;
    me: () => Promise<RecordData>;
  } {
    const self = this;
    return {
      /**
       * Authenticates an admin user with email and password.
       * @param identity - Admin email.
       * @param password - Admin password.
       */
      authWithPassword: async (
        identity: string,
        password: string,
      ): Promise<AuthResponse> => {
        const res = await fetch(
          `${self.baseUrl}/api/admins/auth-with-password`,
          {
            method: "POST",
            headers: self.headers,
            body: JSON.stringify({ identity, password }),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        self.setToken(data.token);
        return data;
      },
      /**
       * Initializes the first admin account.
       * @param data - Admin registration data.
       */
      init: async (data: {
        email: string;
        password: string;
      }): Promise<unknown> => {
        const res = await fetch(`${self.baseUrl}/api/admins/init`, {
          method: "POST",
          headers: self.headers,
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await res.text());
        const resData = await res.json();
        self.setToken(resData.token);
        return resData;
      },
      /**
       * Checks if any admin accounts exist.
       * @returns Object containing a boolean `hasAdmins`.
       */
      hasAdmins: async (): Promise<{ hasAdmins: boolean }> => {
        const res = await fetch(`${self.baseUrl}/api/admins/has-admins`, {
          headers: self.headers,
        });
        if (!res.ok) {
          await res.text();
          return { hasAdmins: false };
        }
        return res.json();
      },
      /**
       * Gets the currently authenticated admin's profile.
       */
      me: async (): Promise<RecordData> => {
        const res = await fetch(`${self.baseUrl}/api/admins/me`, {
          headers: self.adminHeaders,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    };
  }

  /**
   * Namespace for Cron job management.
   * @returns An object with cron job management methods.
   */
  get cron(): {
    list: () => Promise<CronJob[]>;
    create: (data: CronJobConfig) => Promise<unknown>;
    delete: (name: string) => Promise<boolean>;
  } {
    const self = this;
    return {
      /**
       * Lists all registered cron jobs.
       */
      list: async (): Promise<CronJob[]> => {
        const res = await fetch(`${self.baseUrl}/api/cron`, {
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      /**
       * Registers a new cron job.
       * @param data - Cron job configuration (schedule, endpoint, etc.).
       */
      create: async (data: CronJobConfig): Promise<unknown> => {
        const res = await fetch(`${self.baseUrl}/api/cron`, {
          method: "POST",
          headers: self.headers,
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      /**
       * Deletes a cron job by name.
       * @param name - The name of the cron job to delete.
       */
      delete: async (name: string): Promise<boolean> => {
        const res = await fetch(`${self.baseUrl}/api/cron/${name}`, {
          method: "DELETE",
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        await res.text();
        return true;
      },
    };
  }

  /**
   * Namespace for Webhook logs.
   * @returns An object with webhook log access methods.
   */
  get webhookLogs(): {
    list: (filters?: {
      collection?: string;
      status?: string;
      page?: number;
      perPage?: number;
    }) => Promise<PaginatedList<WebhookLog>>;
  } {
    const self = this;
    return {
      /**
       * Lists webhook execution logs with optional filtering.
       * @param filters - Options to filter logs by collection, status, page, etc.
       */
      list: async (
        filters: {
          collection?: string;
          status?: string;
          page?: number;
          perPage?: number;
        } = {},
      ): Promise<PaginatedList<WebhookLog>> => {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== "") {
            params.append(key, value.toString());
          }
        });
        const res = await fetch(
          `${self.baseUrl}/api/webhooks/logs?${params.toString()}`,
          {
            headers: self.headers,
          },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    };
  }

  /**
   * Namespace for Workflow statistics.
   * @returns An object with workflow statistics methods.
   */
  get workflowStats(): {
    get: () => Promise<WorkflowStats>;
  } {
    const self = this;
    return {
      /**
       * Retrieves aggregated statistics about workflow executions.
       */
      get: async (): Promise<WorkflowStats> => {
        const res = await fetch(`${self.baseUrl}/api/workflows/stats`, {
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    };
  }

  /**
   * Returns a handler for a specific collection.
   * Provides methods for record CRUD, search, and realtime subscriptions.
   * @param name - The name of the collection.
   * @returns A collection handler object.
   */
  collection<T = RecordData>(name: string): {
    getList: (
      page?: number,
      perPage?: number,
      options?: { filter?: string; expand?: string; sort?: string },
    ) => Promise<PaginatedList<T>>;
    getOne: (id: string, options?: { expand?: string }) => Promise<T>;
    search: (
      q: string,
      options?: {
        page?: number;
        perPage?: number;
        expand?: string;
        snippet?: boolean;
      },
    ) => Promise<PaginatedList<T>>;
    getView: (
      slug: string,
      options?: {
        page?: number;
        perPage?: number;
        expand?: string;
        filter?: string;
        sort?: string;
      },
    ) => Promise<PaginatedList<T>>;
    create: (data: RecordData | FormData | Partial<T>) => Promise<T>;
    update: (
      id: string,
      data: RecordData | FormData | Partial<T>,
    ) => Promise<T>;
    bulkUpdate: (
      ids: string[],
      data: RecordData | Partial<T>,
    ) => Promise<{ updated: string[] }>;
    delete: (id: string) => Promise<boolean>;
    bulkDelete: (ids: string[]) => Promise<{ deleted: string[] }>;
    authWithPassword: (
      identity: string,
      password: string,
    ) => Promise<AuthResponse>;
    subscribe: (
      callback: (e: RealtimeEvent<T>) => void,
      options?: SubscriptionOptions,
    ) => () => void;
  } {
    const self = this;

    return {
      /**
       * Lists records in the collection with pagination and filtering.
       * @param page - The page number (default: 1).
       * @param perPage - Records per page (default: 30).
       * @param options - Additional options like filter and expand.
       */
      getList: async (
        page = 1,
        perPage = 30,
        options: { filter?: string; expand?: string; sort?: string } = {},
      ): Promise<PaginatedList<T>> => {
        const params = new URLSearchParams({
          page: String(page),
          perPage: String(perPage),
        });
        if (options.filter) params.append("filter", options.filter);
        if (options.expand) params.append("expand", options.expand);
        if (options.sort) params.append("sort", options.sort);

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records?${params.toString()}`,
          { headers: self.headers },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      /**
       * Retrieves a single record by ID.
       * @param id - The record ID.
       * @param options - Options like expand.
       */
      getOne: async (
        id: string,
        options: { expand?: string } = {},
      ): Promise<T> => {
        const params = new URLSearchParams();
        if (options.expand) params.append("expand", options.expand);

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/${id}?${params.toString()}`,
          { headers: self.headers },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      /**
       * Searches for records using a full-text query.
       * @param q - The search query.
       * @param options - Pagination and expansion options.
       */
      search: async (
        q: string,
        options: {
          page?: number;
          perPage?: number;
          expand?: string;
          snippet?: boolean;
        } = {},
      ): Promise<PaginatedList<T>> => {
        const params = new URLSearchParams({ q });
        if (options.page) params.append("page", String(options.page));
        if (options.perPage) params.append("perPage", String(options.perPage));
        if (options.expand) params.append("expand", options.expand);
        if (options.snippet) params.append("snippet", "true");

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/search?${params.toString()}`,
          { headers: self.headers },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      /**
       * Retrieves records from a specific view.
       * @param slug - The view slug.
       * @param options - Pagination, filter, and sort options.
       */
      getView: async (
        slug: string,
        options: {
          page?: number;
          perPage?: number;
          expand?: string;
          filter?: string;
          sort?: string;
        } = {},
      ): Promise<PaginatedList<T>> => {
        const params = new URLSearchParams();
        if (options.page) params.append("page", String(options.page));
        if (options.perPage) params.append("perPage", String(options.perPage));
        if (options.expand) params.append("expand", options.expand);
        if (options.filter) params.append("filter", options.filter);
        if (options.sort) params.append("sort", options.sort);

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/views/${slug}?${params.toString()}`,
          { headers: self.headers },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      /**
       * Creates a new record in the collection.
       * @param data - The record data.
       */
      create: async (
        data: RecordData | FormData | Partial<T>,
      ): Promise<T> => {
        const isFormData = data instanceof FormData;
        const h = { ...self.headers };
        if (isFormData) delete h["Content-Type"];
        console.log("-0--->", data);
        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records`,
          {
            method: "POST",
            headers: h,
            body: isFormData ? data : JSON.stringify(data),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      /**
       * Updates an existing record.
       * @param id - The record ID.
       * @param data - The data to update.
       */
      update: async (
        id: string,
        data: RecordData | FormData | Partial<T>,
      ): Promise<T> => {
        const isFormData = data instanceof FormData;
        const h = { ...self.headers };
        if (isFormData) delete h["Content-Type"];

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/${id}`,
          {
            method: "PATCH",
            headers: h,
            body: isFormData ? data : JSON.stringify(data),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      /**
       * Bulk updates multiple records.
       * @param ids - The IDs of the records to update.
       * @param data - The data to apply to all records.
       */
      bulkUpdate: async (
        ids: string[],
        data: RecordData | Partial<T>,
      ): Promise<{ updated: string[] }> => {
        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/bulk`,
          {
            method: "PATCH",
            headers: self.headers,
            body: JSON.stringify({ ids, data }),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      /**
       * Deletes a record.
       * @param id - The record ID.
       */
      delete: async (id: string): Promise<boolean> => {
        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/${id}`,
          {
            method: "DELETE",
            headers: self.headers,
          },
        );
        if (!res.ok) throw new Error(await res.text());
        await res.text();
        return true;
      },

      /**
       * Bulk deletes multiple records.
       * @param ids - The IDs of the records to delete.
       */
      bulkDelete: async (ids: string[]): Promise<{ deleted: string[] }> => {
        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/bulk`,
          {
            method: "DELETE",
            headers: self.headers,
            body: JSON.stringify({ ids }),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      /**
       * Authenticates a user of this collection (e.g., 'users' collection) using a password.
       * @param identity - The user identity (e.g., username or email).
       * @param password - The user password.
       */
      authWithPassword: async (
        identity: string,
        password: string,
      ): Promise<AuthResponse> => {
        if (name === "_superusers") {
          return self.admins.authWithPassword(identity, password);
        }

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/auth-with-password`,
          {
            method: "POST",
            headers: self.headers,
            body: JSON.stringify({ identity, password }),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        self.setToken(data.token);
        return data;
      },

      /**
       * Subscribes to realtime changes in the collection.
       * @param callback - Function called when an event occurs.
       * @param options - Subscription options (filter, etc.).
       * @returns A function to unsubscribe.
       */
      subscribe: (
        callback: (e: RealtimeEvent<T>) => void,
        options?: SubscriptionOptions,
      ): () => void => {
        self.subscriptions.set(name, { callback: callback as any, options });
        self.connectRealtime();

        if (self.realtimeSocket?.readyState === 1) {
          self.realtimeSocket.send(
            JSON.stringify({ type: "SUBSCRIBE", collection: name, ...options }),
          );
        }

        return () => {
          self.subscriptions.delete(name);
        };
      },
    };
  }

  /** Connects to the realtime WebSocket server. */
  private connectRealtime(): void {
    if (typeof WebSocket === "undefined") return;
    if (
      this.realtimeSocket &&
      (this.realtimeSocket.readyState === 0 ||
        this.realtimeSocket.readyState === 1)
    ) {
      return;
    }

    const wsUrl = this.baseUrl.replace("http", "ws") +
      "/api/realtime" +
      `?db=${this.dbName}` +
      (this.token ? `&auth=${this.token}` : "");
    this.realtimeSocket = new WebSocket(wsUrl);

    this.realtimeSocket.onopen = () => {
      this.subscriptions.forEach((sub, name) => {
        this.realtimeSocket?.send(
          JSON.stringify({
            type: "SUBSCRIBE",
            collection: name,
            ...sub.options,
          }),
        );
      });
    };

    this.realtimeSocket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const sub = this.subscriptions.get(msg.collection);
      if (!sub || !msg.events) return;

      msg.events.forEach((e: any) => {
        try {
          sub.callback(e.data);
          if (!sub.options?.group) {
            sub.options = { ...sub.options, lastId: e.id };
          }
          if (e.ackId && sub.options?.group) {
            this.realtimeSocket?.send(
              JSON.stringify({
                type: "ACK",
                collection: msg.collection,
                id: e.ackId,
                group: sub.options.group,
              }),
            );
          }
        } catch (err) {
          console.error("Error handling realtime event:", err);
        }
      });
    };

    this.realtimeSocket.onclose = () => {
      if (this.subscriptions.size > 0) {
        setTimeout(() => this.connectRealtime(), 3000);
      }
    };
  }

  /**
   * Namespace for database migrations.
   * @returns An object with migration methods.
   */
  get migrations(): {
    getList: (
      page?: number,
      perPage?: number,
      options?: { filter?: string; sort?: string },
    ) => Promise<PaginatedList<Migration>>;
    create: (data: {
      name: string;
      appliedAt: string;
      batch?: number;
    }) => Promise<Migration>;
    delete: (id: string) => Promise<boolean>;
    run: (
      migrations: {
        name: string;
        up: (sdk: RocketBaseClient) => Promise<void>;
      }[],
    ) => Promise<void>;
  } {
    const self = this;
    const name = "_migrations";
    return {
      /**
       * Lists applied migrations.
       */
      getList: async (
        page = 1,
        perPage = 500,
        options: { filter?: string; sort?: string } = {},
      ): Promise<PaginatedList<Migration>> => {
        const params = new URLSearchParams({
          page: String(page),
          perPage: String(perPage),
        });
        if (options.filter) params.append("filter", options.filter);
        if (options.sort) params.append("sort", options.sort);

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records?${params.toString()}`,
          { headers: self.adminHeaders },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      /**
       * Creates a migration record.
       */
      create: async (data: {
        name: string;
        appliedAt: string;
        batch?: number;
      }): Promise<Migration> => {
        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records`,
          {
            method: "POST",
            headers: self.adminHeaders,
            body: JSON.stringify(data),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      /**
       * Deletes a migration record.
       */
      delete: async (id: string): Promise<boolean> => {
        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/${id}`,
          {
            method: "DELETE",
            headers: self.adminHeaders,
          },
        );
        if (!res.ok) throw new Error(await res.text());
        await res.text();
        return true;
      },
      /**
       * Runs a list of pending migrations.
       * @param migrations - List of migration objects with `up` functions.
       */
      run: async (
        migrations: {
          name: string;
          up: (sdk: RocketBaseClient) => Promise<void>;
        }[],
      ): Promise<void> => {
        const applied = await self.migrations.getList(1, 500);
        const appliedNames = new Set(applied.items.map((m: any) => m.name));

        for (const mig of migrations) {
          if (!appliedNames.has(mig.name)) {
            console.log(`[Migrations] Applying: ${mig.name}`);
            await mig.up(self);
            await self.migrations.create({
              name: mig.name,
              appliedAt: new Date().toISOString(),
              batch: 1, // For now
            });
          }
        }
      },
    };
  }

  /**
   * Namespace for Workflow operations (Runs, Events, Signals, Queues).
   * @returns An object with workflow management methods.
   */
  get workflow(): {
    createRun: (data: Partial<WorkflowRun>) => Promise<WorkflowRun>;
    trigger: (
      workflowName: string,
      input: unknown[],
      options?: any,
    ) => Promise<WorkflowRun>;
    resume: (runId: string) => Promise<WorkflowRun>;
    getRun: (runId: string) => Promise<WorkflowRun>;
    updateRun: (
      runId: string,
      data: Partial<WorkflowRun>,
    ) => Promise<WorkflowRun>;
    cancelRun: (
      runId: string,
      reason?: string,
    ) => Promise<unknown>;
    listRuns: (params?: {
      workflowName?: string;
      status?: string;
      limit?: number;
      cursor?: string;
    }) => Promise<PaginatedList<WorkflowRun>>;
    createStep: (runId: string, data: any) => Promise<unknown>;
    updateStep: (runId: string, stepId: string, data: any) => Promise<unknown>;
    createEvent: (
      runId: string,
      data: {
        eventType: string;
        correlationId?: string;
        payload: Record<string, unknown>;
      },
    ) => Promise<WorkflowEvent>;
    listEvents: (runId: string) => Promise<WorkflowEvent[]>;
    pollQueue: (queueName: string) => Promise<unknown>;
    sendSignal: (
      runId: string,
      signalName: string,
      data: any,
      correlationId?: string,
    ) => Promise<boolean>;
    queueMessage: (
      queueName: string,
      message: any,
      opts?: any,
    ) => Promise<unknown>;
    getJob: (messageId: string) => Promise<unknown>;
    getProcessingJobs: (runId: string) => Promise<unknown>;
    ack: (messageId: string) => Promise<unknown>;
    nack: (messageId: string) => Promise<unknown>;
    touch: (messageId: string) => Promise<unknown>;
    hooks: {
      create: (data: {
        runId?: string;
        workflowName?: string;
        signalName?: string;
        token: string;
        metadata?: any;
      }) => Promise<unknown>;
      execute: (token: string, payload: any) => Promise<unknown>;
      get: (id: string) => Promise<unknown>;
      getByToken: (token: string) => Promise<unknown>;
      list: (runId: string) => Promise<unknown>;
      dispose: (id: string) => Promise<unknown>;
    };
  } {
    const self = this;

    const base = `${self.baseUrl}/api/workflows`;

    return {
      /**
       * Creates a new workflow run directly.
       */
      createRun: async (data: Partial<WorkflowRun>): Promise<WorkflowRun> => {
        const res = await fetch(`${base}/runs`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify(data),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Triggers a workflow execution.
       * @param workflowName - Name of the workflow.
       * @param input - Input arguments.
       * @param options - Execution options.
       */
      trigger: async (
        workflowName: string,
        input: unknown[],
        options: any = {},
      ): Promise<WorkflowRun> => {
        const Class = WorkflowRegistry.get(workflowName);
        const defaultOptions = Class?.prototype?.workflowOptions || {};
        const mergedOptions = { ...defaultOptions, ...options };

        const run = await self.workflow.createRun({
          deploymentId: mergedOptions.deploymentId || "sdk",

          workflowName,

          input,
          ...mergedOptions,
        });

        await self.workflow.queueMessage(`__wkf_workflow_${workflowName}`, {
          type: "workflow_start",
          runId: run.runId,
          workflowName,
          input,
        }, {
          runId: run.runId,
          idempotencyKey: run.runId,
        });

        return run;
      },

      /**
       * Resumes a suspended workflow run.
       * @param runId - The run ID.
       */
      resume: async (runId: string): Promise<WorkflowRun> => {
        const run = await self.workflow.getRun(runId);

        await self.workflow.queueMessage(`__wkf_workflow_${run.workflowName}`, {
          type: "resume",
          runId: run.runId,
          workflowName: run.workflowName,
          input: run.input,
        }, {
          runId: run.runId,
          idempotencyKey: run.runId,
        });

        return run;
      },

      /**
       * Retrieves a workflow run by ID.
       */
      getRun: async (runId: string): Promise<WorkflowRun> => {
        const res = await fetch(`${base}/runs/${runId}`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Updates a workflow run.
       */
      updateRun: async (
        runId: string,
        data: Partial<WorkflowRun>,
      ): Promise<WorkflowRun> => {
        const res = await fetch(`${base}/runs/${runId}`, {
          method: "PATCH",

          headers: self.headers,

          body: JSON.stringify(data),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Cancels a running or pending workflow run.
       * @param runId - The run ID to cancel.
       * @param reason - Optional reason for cancellation.
       */
      cancelRun: async (
        runId: string,
        reason?: string,
      ): Promise<unknown> => {
        const res = await fetch(`${base}/runs/${runId}`, {
          method: "DELETE",
          headers: self.headers,
          body: JSON.stringify({ reason }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Lists workflow runs.
       */
      listRuns: async (
        params: {
          workflowName?: string;

          status?: string;

          limit?: number;

          cursor?: string;
        } = {},
      ): Promise<PaginatedList<WorkflowRun>> => {
        const p = new URLSearchParams();

        if (params.workflowName) p.append("workflowName", params.workflowName);

        if (params.status) p.append("status", params.status);

        if (params.limit) p.append("limit", String(params.limit));

        if (params.cursor) p.append("cursor", params.cursor);

        const res = await fetch(`${base}/runs?${p.toString()}`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Records a new workflow step.
       */
      createStep: async (runId: string, data: any): Promise<unknown> => {
        const res = await fetch(`${base}/steps`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ runId, ...data }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Updates a workflow step.
       */
      updateStep: async (
        runId: string,
        stepId: string,
        data: any,
      ): Promise<unknown> => {
        const res = await fetch(`${base}/steps/${runId}/${stepId}`, {
          method: "PATCH",

          headers: self.headers,

          body: JSON.stringify(data),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Creates a workflow event.
       */
      createEvent: async (
        runId: string,
        data: {
          eventType: string;
          correlationId?: string;
          payload: Record<string, unknown>;
        },
      ): Promise<WorkflowEvent> => {
        const res = await fetch(`${base}/events`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ runId, ...data }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Lists events for a workflow run.
       */
      listEvents: async (runId: string): Promise<WorkflowEvent[]> => {
        const res = await fetch(`${base}/runs/${runId}/events`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Polls a queue for a message.
       */
      pollQueue: async (queueName: string): Promise<unknown> => {
        const res = await fetch(`${base}/queue/${queueName}`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        const text = await res.text();

        return text ? JSON.parse(text) : null;
      },

      /**
       * Sends a signal to a running workflow.
       * @param runId - The run ID.
       * @param signalName - The signal name.
       * @param data - The signal payload.
       * @param correlationId - Optional correlation ID.
       */
      sendSignal: async (
        runId: string,
        signalName: string,
        data: any,
        correlationId?: string,
      ): Promise<boolean> => {
        const signalCorrelationId = correlationId ||
          `signal-${signalName}-${crypto.randomUUID()}`;

        await self.workflow.createEvent(runId, {
          eventType: "signal_received",
          correlationId: signalCorrelationId,
          payload: { name: signalName, data },
        });

        const run = await self.workflow.getRun(runId);

        await self.workflow.queueMessage(`__wkf_workflow_${run.workflowName}`, {
          type: "signal",
          runId: runId,
          workflowName: run.workflowName,
          input: run.input,
        }, {
          runId: runId,
          idempotencyKey: `${runId}-${signalCorrelationId}`,
        });

        return true;
      },

      /**
       * Enqueues a message.
       */
      queueMessage: async (
        queueName: string,
        message: any,
        opts?: any,
      ): Promise<unknown> => {
        const res = await fetch(`${base}/queue`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ queueName, message, opts }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Acknowledges a message (removes it from queue).
       */
      ack: async (messageId: string): Promise<unknown> => {
        const res = await fetch(`${base}/queue/ack`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ messageId }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Negative acknowledges a message (returns it to queue).
       */
      nack: async (messageId: string): Promise<unknown> => {
        const res = await fetch(`${base}/queue/nack`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ messageId }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Gets a queue message by ID.
       */
      getJob: async (messageId: string): Promise<unknown> => {
        const res = await fetch(`${base}/queue/${messageId}`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Gets processing jobs for a run.
       */
      getProcessingJobs: async (runId: string): Promise<unknown> => {
        const p = new URLSearchParams();
        p.append("runId", runId);
        p.append("status", "processing");

        const res = await fetch(`${base}/queue/jobs?${p.toString()}`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Touches a message (extends visibility timeout).
       */
      touch: async (messageId: string): Promise<unknown> => {
        // Send touch via WebSocket to reset gateway timeout
        if (self.workflowSocket?.readyState === 1) {
          self.workflowSocket.send(
            JSON.stringify({
              event: "TOUCH",
              data: { messageId },
            }),
          );
        }

        // Also update the database record
        const res = await fetch(`${base}/queue/touch`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ messageId }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      /**
       * Namespace for workflow hooks.
       */
      hooks: {
        /**
         * Creates a new hook for a workflow run or workflow type.
         */
        create: async (data: {
          runId?: string;
          workflowName?: string;
          signalName?: string;
          token: string;
          metadata?: any;
        }): Promise<unknown> => {
          const res = await fetch(`${base}/hooks`, {
            method: "POST",

            headers: self.headers,

            body: JSON.stringify(data),
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        /**
         * Executes a hook by token.
         */
        execute: async (token: string, payload: any): Promise<unknown> => {
          const res = await fetch(`${base}/hooks/${token}`, {
            method: "POST",

            headers: self.headers,

            body: JSON.stringify(payload),
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        /**
         * Gets a hook by ID.
         */
        get: async (id: string): Promise<unknown> => {
          const res = await fetch(`${base}/hooks/${id}`, {
            headers: self.headers,
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        /**
         * Gets a hook by token.
         */
        getByToken: async (token: string): Promise<unknown> => {
          const res = await fetch(`${base}/hooks?token=${token}`, {
            headers: self.headers,
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        /**
         * Lists hooks for a workflow run.
         */
        list: async (runId: string): Promise<unknown> => {
          const res = await fetch(`${base}/hooks?runId=${runId}`, {
            headers: self.headers,
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        /**
         * Disposes/Deletes a hook.
         */
        dispose: async (id: string): Promise<unknown> => {
          const res = await fetch(`${base}/hooks/${id}`, {
            method: "DELETE",

            headers: self.headers,
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },
      },
    };
  }

  /**
   * Calls a Gate (custom API endpoint) defined in the backend.
   * @param name - The name of the gate to call.
   * @param data - The data payload to send (optional).
   * @param options - Additional fetch options (optional).
   * @returns A promise that resolves to the fetch Response.
   */
  async gate(
    name: string,
    data?: any,
    options?: RequestInit,
  ): Promise<Response> {
    const fetchOptions: RequestInit = {
      method: "POST",

      ...options,

      headers: {
        ...this.headers,

        ...(options?.headers || {}),
      },
    };

    if (data) {
      fetchOptions.body = JSON.stringify(data);
    }

    return await fetch(`${this.baseUrl}/api/gates/${name}`, fetchOptions);
  }
}
