// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

import type { RealtimeEvent, SubscriptionOptions } from "./types.ts";

export class RocketBaseClient {
  public baseUrl: string;
  private token: string | null = null;
  private apiKey: string | null = null;
  public dbName: string = "postgres"; // Changed to public for Worker access
  private adminDbName: string = "postgres";
  private realtimeSocket: WebSocket | null = null;
  private subscriptions = new Map<
    string,
    {
      callback: (e: RealtimeEvent) => void;
      options?: SubscriptionOptions;
    }
  >();

  constructor(baseUrl: string = "http://127.0.0.1:3000") {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem("pb_auth_token");
      this.apiKey = localStorage.getItem("rb_api_key");
    }
  }

  getToken() {
    return this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== "undefined") {
      if (token) {
        localStorage.setItem("pb_auth_token", token);
      } else {
        localStorage.removeItem("pb_auth_token");
      }
    }
    if (this.realtimeSocket) {
      this.realtimeSocket.close();
    }
  }

  setApiKey(key: string | null) {
    this.apiKey = key;
    if (typeof window !== "undefined") {
      if (key) {
        localStorage.setItem("rb_api_key", key);
      } else {
        localStorage.removeItem("rb_api_key");
      }
    }
  }

  setDb(db: string) {
    this.dbName = db;
    if (this.realtimeSocket) {
      this.realtimeSocket.close();
    }
  }

  setAdminDb(db: string) {
    this.adminDbName = db;
    if (this.realtimeSocket) {
      this.realtimeSocket.close();
    }
  }

  close() {
    if (this.realtimeSocket) {
      this.realtimeSocket.close();
      this.realtimeSocket = null;
    }
    this.subscriptions.clear();
  }

  private get headers() {
    const h: any = {
      "Content-Type": "application/json",
      "x-dbname": this.dbName,
    };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  private get adminHeaders() {
    const h: any = {
      "Content-Type": "application/json",
      "x-dbname": this.adminDbName,
    };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  get settings() {
    // @ts-ignore:
    const self = this;
    return {
      databases: {
        list: async () => {
          const res = await fetch(`${self.baseUrl}/api/databases`, {
            headers: self.headers,
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        create: async (data: {
          name: string;
          extensions?: string[];
          initScript?: string;
        }) => {
          const res = await fetch(`${self.baseUrl}/api/databases`, {
            method: "POST",
            headers: self.headers,
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        delete: async (name: string) => {
          const res = await fetch(`${self.baseUrl}/api/databases/${name}`, {
            method: "DELETE",
            headers: self.headers,
          });
          if (!res.ok) throw new Error(await res.text());
          return true;
        },
      },
      collections: {
        create: async (data: any) => {
          const res = await fetch(`${self.baseUrl}/api/collections`, {
            method: "POST",
            headers: self.headers,
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        update: async (id: string, data: any) => {
          const res = await fetch(`${self.baseUrl}/api/collections/${id}`, {
            method: "PATCH",
            headers: self.headers,
            body: JSON.stringify(data),
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
        delete: async (id: string) => {
          const res = await fetch(`${self.baseUrl}/api/collections/${id}`, {
            method: "DELETE",
            headers: self.headers,
          });
          if (!res.ok) throw new Error(await res.text());
          return true;
        },
        getList: async () => {
          const res = await fetch(`${self.baseUrl}/api/collections`, {
            headers: self.headers,
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        },
      },
    };
  }

  get auth() {
    const self = this;
    return {
      // Login using the configured default auth collection
      login: async (email: string, pass: string) => {
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
      // Register a new user in the configured default auth collection
      register: async (data: any) => {
        const res = await fetch(`${self.baseUrl}/api/auth/register`, {
          method: "POST",
          headers: self.headers,
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      // Get the profile of the currently logged in user
      me: async () => {
        // This assumes the token is valid
        // We might need an endpoint /api/auth/me that resolves the user from the token
        // independent of collection
        const res = await fetch(`${self.baseUrl}/api/auth/me`, {
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      // List available auth methods (OAuth providers)
      listMethods: async () => {
        const res = await fetch(`${self.baseUrl}/api/auth/methods`, {
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      // Login via OAuth2 code
      authViaOAuth2: async (
        provider: string,
        code: string,
        redirectUrl: string,
      ) => {
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

  get keys() {
    const self = this;
    return {
      generate: async (data: any) => {
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

  get admins() {
    const self = this;
    return {
      authWithPassword: async (identity: string, password: string) => {
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
      init: async (data: any) => {
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
      hasAdmins: async () => {
        const res = await fetch(`${self.baseUrl}/api/admins/has-admins`, {
          headers: self.headers,
        });
        if (!res.ok) return { hasAdmins: false };
        return res.json();
      },
      me: async () => {
        const res = await fetch(`${self.baseUrl}/api/admins/me`, {
          headers: self.adminHeaders,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    };
  }

  get cron() {
    const self = this;
    return {
      list: async () => {
        const res = await fetch(`${self.baseUrl}/api/cron`, {
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      create: async (data: any) => {
        const res = await fetch(`${self.baseUrl}/api/cron`, {
          method: "POST",
          headers: self.headers,
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      delete: async (name: string) => {
        const res = await fetch(`${self.baseUrl}/api/cron/${name}`, {
          method: "DELETE",
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return true;
      },
    };
  }

  get webhookLogs() {
    const self = this;
    return {
      list: async (
        filters: {
          collection?: string;
          status?: string;
          page?: number;
          perPage?: number;
        } = {},
      ) => {
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

  get workflowStats() {
    const self = this;
    return {
      get: async () => {
        const res = await fetch(`${self.baseUrl}/api/workflows/stats`, {
          headers: self.headers,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    };
  }

  collection(name: string) {
    const self = this;

    return {
      getList: async (
        page = 1,
        perPage = 30,
        options: { filter?: string; expand?: string } = {},
      ) => {
        const params = new URLSearchParams({
          page: String(page),
          perPage: String(perPage),
        });
        if (options.filter) params.append("filter", options.filter);
        if (options.expand) params.append("expand", options.expand);

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records?${params.toString()}`,
          { headers: self.headers },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      getOne: async (id: string, options: { expand?: string } = {}) => {
        const params = new URLSearchParams();
        if (options.expand) params.append("expand", options.expand);

        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/${id}?${params.toString()}`,
          { headers: self.headers },
        );
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },

      search: async (
        q: string,
        options: {
          page?: number;
          perPage?: number;
          expand?: string;
          snippet?: boolean;
        } = {},
      ) => {
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

      getView: async (
        slug: string,
        options: {
          page?: number;
          perPage?: number;
          expand?: string;
          filter?: string;
          sort?: string;
        } = {},
      ) => {
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

      create: async (data: any) => {
        const isFormData = data instanceof FormData;
        const h = { ...self.headers };
        if (isFormData) delete h["Content-Type"];

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

      update: async (id: string, data: any) => {
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

      bulkUpdate: async (ids: string[], data: any) => {
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

      delete: async (id: string) => {
        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/${id}`,
          {
            method: "DELETE",
            headers: self.headers,
          },
        );
        if (!res.ok) throw new Error(await res.text());
        return true;
      },

      bulkDelete: async (ids: string[]) => {
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

      authWithPassword: async (identity: string, password: string) => {
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

      subscribe: (
        callback: (e: RealtimeEvent) => void,
        options?: SubscriptionOptions,
      ) => {
        self.subscriptions.set(name, { callback, options });
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

  private connectRealtime() {
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
      setTimeout(() => this.connectRealtime(), 3000);
    };
  }

  get migrations() {
    const self = this;
    const name = "_migrations";
    return {
      getList: async (
        page = 1,
        perPage = 500,
        options: { filter?: string; sort?: string } = {},
      ) => {
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
      create: async (data: {
        name: string;
        appliedAt: string;
        batch?: number;
      }) => {
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
      delete: async (id: string) => {
        const res = await fetch(
          `${self.baseUrl}/api/collections/${name}/records/${id}`,
          {
            method: "DELETE",
            headers: self.adminHeaders,
          },
        );
        if (!res.ok) throw new Error(await res.text());
        return true;
      },
      run: async (
        migrations: {
          name: string;
          up: (sdk: RocketBaseClient) => Promise<void>;
        }[],
      ) => {
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

  get workflow() {
    const self = this;

    const base = `${self.baseUrl}/api/workflows`;

    return {
      createRun: async (data: any) => {
        const res = await fetch(`${base}/runs`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify(data),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      trigger: async (
        workflowName: string,
        input: any[],
        options: any = {},
      ) => {
        const run = await self.workflow.createRun({
          deploymentId: options.deploymentId || "sdk",

          workflowName,

          input,
        });

        await self.workflow.queueMessage(`__wkf_workflow_${workflowName}`, {
          type: "workflow_start",

          runId: run.runId,

          workflowName,

          input,
        });

        return run;
      },

      resume: async (runId: string) => {
        const run = await self.workflow.getRun(runId);

        await self.workflow.queueMessage(`__wkf_workflow_${run.workflowName}`, {
          type: "resume",

          runId: run.runId,

          workflowName: run.workflowName,

          input: run.input,
        });

        return run;
      },

      getRun: async (runId: string) => {
        const res = await fetch(`${base}/runs/${runId}`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      updateRun: async (runId: string, data: any) => {
        const res = await fetch(`${base}/runs/${runId}`, {
          method: "PATCH",

          headers: self.headers,

          body: JSON.stringify(data),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      listRuns: async (
        params: {
          workflowName?: string;

          status?: string;

          limit?: number;

          cursor?: string;
        } = {},
      ) => {
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

      createStep: async (runId: string, data: any) => {
        const res = await fetch(`${base}/steps`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ runId, ...data }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      updateStep: async (runId: string, stepId: string, data: any) => {
        const res = await fetch(`${base}/steps/${runId}/${stepId}`, {
          method: "PATCH",

          headers: self.headers,

          body: JSON.stringify(data),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      createEvent: async (runId: string, data: any) => {
        const res = await fetch(`${base}/events`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ runId, ...data }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      listEvents: async (runId: string) => {
        const res = await fetch(`${base}/runs/${runId}/events`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      pollQueue: async (queueName: string) => {
        const res = await fetch(`${base}/queue/${queueName}`, {
          headers: self.headers,
        });

        if (!res.ok) throw new Error(await res.text());

        const text = await res.text();

        return text ? JSON.parse(text) : null;
      },

      sendSignal: async (
        runId: string,
        signalName: string,
        data: any,
        correlationId?: string,
      ) => {
        // 1. Create signal event

        await self.workflow.createEvent(runId, {
          eventType: "signal_received",

          correlationId: correlationId ||
            `signal-${signalName}-${crypto.randomUUID()}`, // Deterministic ID for the signal

          payload: { name: signalName, data },
        });

        // 2. Queue workflow for execution

        const run = await self.workflow.getRun(runId);

        await self.workflow.queueMessage(`__wkf_workflow_${run.workflowName}`, {
          type: "signal",

          runId: runId,

          workflowName: run.workflowName,

          input: run.input,
        });

        return true;
      },

      queueMessage: async (queueName: string, message: any, opts?: any) => {
        const res = await fetch(`${base}/queue`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ queueName, message, opts }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      ack: async (messageId: string) => {
        const res = await fetch(`${base}/queue/ack`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ messageId }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      nack: async (messageId: string) => {
        const res = await fetch(`${base}/queue/nack`, {
          method: "POST",

          headers: self.headers,

          body: JSON.stringify({ messageId }),
        });

        if (!res.ok) throw new Error(await res.text());

        return res.json();
      },

      hooks: {
        create: async (runId: string, data: any) => {
          const res = await fetch(`${base}/hooks`, {
            method: "POST",

            headers: self.headers,

            body: JSON.stringify({ runId, ...data }),
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        get: async (id: string) => {
          const res = await fetch(`${base}/hooks/${id}`, {
            headers: self.headers,
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        getByToken: async (token: string) => {
          const res = await fetch(`${base}/hooks?token=${token}`, {
            headers: self.headers,
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        list: async (runId: string) => {
          const res = await fetch(`${base}/hooks?runId=${runId}`, {
            headers: self.headers,
          });

          if (!res.ok) throw new Error(await res.text());

          return res.json();
        },

        dispose: async (id: string) => {
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

  async gate(name: string, data?: any, options?: RequestInit) {
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
