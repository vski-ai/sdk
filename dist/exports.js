var h = new Map();
var k = class {
  baseUrl;
  token = null;
  apiKey = null;
  dbName = "postgres";
  adminDbName = "postgres";
  realtimeSocket = null;
  subscriptions = new Map();
  constructor(e = "http://127.0.0.1:3000") {
    this.baseUrl = e.endsWith("/") ? e.slice(0, -1) : e,
      typeof window < "u" &&
      (this.token = localStorage.getItem("pb_auth_token"),
        this.apiKey = localStorage.getItem("rb_api_key"));
  }
  getToken() {
    return this.token;
  }
  setToken(e) {
    this.token = e,
      typeof window < "u" &&
      (e
        ? localStorage.setItem("pb_auth_token", e)
        : localStorage.removeItem("pb_auth_token")),
      this.realtimeSocket && this.realtimeSocket.close();
  }
  setApiKey(e) {
    this.apiKey = e,
      typeof window < "u" &&
      (e
        ? localStorage.setItem("rb_api_key", e)
        : localStorage.removeItem("rb_api_key"));
  }
  setDb(e) {
    this.dbName = e, this.realtimeSocket && this.realtimeSocket.close();
  }
  setAdminDb(e) {
    this.adminDbName = e, this.realtimeSocket && this.realtimeSocket.close();
  }
  close() {
    this.realtimeSocket &&
    (this.realtimeSocket.onopen = null,
      this.realtimeSocket.onmessage = null,
      this.realtimeSocket.onerror = null,
      this.realtimeSocket.onclose = null,
      this.realtimeSocket.close(),
      this.realtimeSocket = null), this.subscriptions.clear();
  }
  get headers() {
    let e = { "Content-Type": "application/json", "x-dbname": this.dbName };
    return this.token && (e.Authorization = `Bearer ${this.token}`),
      this.apiKey && (e["X-API-Key"] = this.apiKey),
      e;
  }
  get adminHeaders() {
    let e = {
      "Content-Type": "application/json",
      "x-dbname": this.adminDbName,
    };
    return this.token && (e.Authorization = `Bearer ${this.token}`),
      this.apiKey && (e["X-API-Key"] = this.apiKey),
      e;
  }
  get settings() {
    let e = this;
    return {
      databases: {
        list: async () => {
          let s = await fetch(`${e.baseUrl}/api/databases`, {
            headers: e.headers,
          });
          if (!s.ok) throw new Error(await s.text());
          return s.json();
        },
        create: async (s) => {
          let r = await fetch(`${e.baseUrl}/api/databases`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify(s),
          });
          if (!r.ok) throw new Error(await r.text());
          return r.json();
        },
        delete: async (s) => {
          let r = await fetch(`${e.baseUrl}/api/databases/${s}`, {
            method: "DELETE",
            headers: e.headers,
          });
          if (!r.ok) throw new Error(await r.text());
          return await r.text(), !0;
        },
      },
      collections: {
        create: async (s) => {
          let r = await fetch(`${e.baseUrl}/api/collections`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify(s),
          });
          if (!r.ok) throw new Error(await r.text());
          return r.json();
        },
        update: async (s, r) => {
          let t = await fetch(`${e.baseUrl}/api/collections/${s}`, {
            method: "PATCH",
            headers: e.headers,
            body: JSON.stringify(r),
          });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        delete: async (s) => {
          let r = await fetch(`${e.baseUrl}/api/collections/${s}`, {
            method: "DELETE",
            headers: e.headers,
          });
          if (!r.ok) throw new Error(await r.text());
          return await r.text(), !0;
        },
        getList: async () => {
          let s = await fetch(`${e.baseUrl}/api/collections`, {
            headers: e.headers,
          });
          if (!s.ok) throw new Error(await s.text());
          return s.json();
        },
      },
    };
  }
  get auth() {
    let e = this;
    return {
      login: async (s, r) => {
        let t = await fetch(`${e.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ identity: s, password: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        let o = await t.json();
        return e.setToken(o.token), o;
      },
      register: async (s) => {
        let r = await fetch(`${e.baseUrl}/api/auth/register`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify(s),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      me: async () => {
        let s = await fetch(`${e.baseUrl}/api/auth/me`, { headers: e.headers });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      listMethods: async () => {
        let s = await fetch(`${e.baseUrl}/api/auth/methods`, {
          headers: e.headers,
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      authViaOAuth2: async (s, r, t) => {
        let o = await fetch(`${e.baseUrl}/api/auth/oauth2-login`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ provider: s, code: r, redirectUrl: t }),
        });
        if (!o.ok) throw new Error(await o.text());
        let a = await o.json();
        return e.setToken(a.token), a;
      },
    };
  }
  get keys() {
    let e = this;
    return {
      generate: async (s) => {
        let r = await fetch(`${e.baseUrl}/api/keys`, {
          method: "POST",
          headers: e.adminHeaders,
          body: JSON.stringify(s),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
    };
  }
  get admins() {
    let e = this;
    return {
      authWithPassword: async (s, r) => {
        let t = await fetch(`${e.baseUrl}/api/admins/auth-with-password`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ identity: s, password: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        let o = await t.json();
        return e.setToken(o.token), o;
      },
      init: async (s) => {
        let r = await fetch(`${e.baseUrl}/api/admins/init`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify(s),
        });
        if (!r.ok) throw new Error(await r.text());
        let t = await r.json();
        return e.setToken(t.token), t;
      },
      hasAdmins: async () => {
        let s = await fetch(`${e.baseUrl}/api/admins/has-admins`, {
          headers: e.headers,
        });
        return s.ok ? s.json() : (await s.text(), { hasAdmins: !1 });
      },
      me: async () => {
        let s = await fetch(`${e.baseUrl}/api/admins/me`, {
          headers: e.adminHeaders,
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
    };
  }
  get cron() {
    let e = this;
    return {
      list: async () => {
        let s = await fetch(`${e.baseUrl}/api/cron`, { headers: e.headers });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      create: async (s) => {
        let r = await fetch(`${e.baseUrl}/api/cron`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify(s),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      delete: async (s) => {
        let r = await fetch(`${e.baseUrl}/api/cron/${s}`, {
          method: "DELETE",
          headers: e.headers,
        });
        if (!r.ok) throw new Error(await r.text());
        return await r.text(), !0;
      },
    };
  }
  get webhookLogs() {
    let e = this;
    return {
      list: async (s = {}) => {
        let r = new URLSearchParams();
        Object.entries(s).forEach(([o, a]) => {
          a !== void 0 && a !== "" && r.append(o, a.toString());
        });
        let t = await fetch(`${e.baseUrl}/api/webhooks/logs?${r.toString()}`, {
          headers: e.headers,
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
    };
  }
  get workflowStats() {
    let e = this;
    return {
      get: async () => {
        let s = await fetch(`${e.baseUrl}/api/workflows/stats`, {
          headers: e.headers,
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
    };
  }
  collection(e) {
    let s = this;
    return {
      getList: async (r = 1, t = 30, o = {}) => {
        let a = new URLSearchParams({ page: String(r), perPage: String(t) });
        o.filter && a.append("filter", o.filter),
          o.expand && a.append("expand", o.expand),
          o.sort && a.append("sort", o.sort);
        let i = await fetch(
          `${s.baseUrl}/api/collections/${e}/records?${a.toString()}`,
          { headers: s.headers },
        );
        if (!i.ok) throw new Error(await i.text());
        return i.json();
      },
      getOne: async (r, t = {}) => {
        let o = new URLSearchParams();
        t.expand && o.append("expand", t.expand);
        let a = await fetch(
          `${s.baseUrl}/api/collections/${e}/records/${r}?${o.toString()}`,
          { headers: s.headers },
        );
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      search: async (r, t = {}) => {
        let o = new URLSearchParams({ q: r });
        t.page && o.append("page", String(t.page)),
          t.perPage && o.append("perPage", String(t.perPage)),
          t.expand && o.append("expand", t.expand),
          t.snippet && o.append("snippet", "true");
        let a = await fetch(
          `${s.baseUrl}/api/collections/${e}/records/search?${o.toString()}`,
          { headers: s.headers },
        );
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      getView: async (r, t = {}) => {
        let o = new URLSearchParams();
        t.page && o.append("page", String(t.page)),
          t.perPage && o.append("perPage", String(t.perPage)),
          t.expand && o.append("expand", t.expand),
          t.filter && o.append("filter", t.filter),
          t.sort && o.append("sort", t.sort);
        let a = await fetch(
          `${s.baseUrl}/api/collections/${e}/records/views/${r}?${o.toString()}`,
          { headers: s.headers },
        );
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      create: async (r) => {
        let t = r instanceof FormData, o = { ...s.headers };
        t && delete o["Content-Type"];
        let a = await fetch(`${s.baseUrl}/api/collections/${e}/records`, {
          method: "POST",
          headers: o,
          body: t ? r : JSON.stringify(r),
        });
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      update: async (r, t) => {
        let o = t instanceof FormData, a = { ...s.headers };
        o && delete a["Content-Type"];
        let i = await fetch(`${s.baseUrl}/api/collections/${e}/records/${r}`, {
          method: "PATCH",
          headers: a,
          body: o ? t : JSON.stringify(t),
        });
        if (!i.ok) throw new Error(await i.text());
        return i.json();
      },
      bulkUpdate: async (r, t) => {
        let o = await fetch(`${s.baseUrl}/api/collections/${e}/records/bulk`, {
          method: "PATCH",
          headers: s.headers,
          body: JSON.stringify({ ids: r, data: t }),
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      delete: async (r) => {
        let t = await fetch(`${s.baseUrl}/api/collections/${e}/records/${r}`, {
          method: "DELETE",
          headers: s.headers,
        });
        if (!t.ok) throw new Error(await t.text());
        return await t.text(), !0;
      },
      bulkDelete: async (r) => {
        let t = await fetch(`${s.baseUrl}/api/collections/${e}/records/bulk`, {
          method: "DELETE",
          headers: s.headers,
          body: JSON.stringify({ ids: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      authWithPassword: async (r, t) => {
        if (e === "_superusers") return s.admins.authWithPassword(r, t);
        let o = await fetch(
          `${s.baseUrl}/api/collections/${e}/auth-with-password`,
          {
            method: "POST",
            headers: s.headers,
            body: JSON.stringify({ identity: r, password: t }),
          },
        );
        if (!o.ok) throw new Error(await o.text());
        let a = await o.json();
        return s.setToken(a.token), a;
      },
      subscribe: (
        r,
        t,
      ) => (s.subscriptions.set(e, { callback: r, options: t }),
        s.connectRealtime(),
        s.realtimeSocket?.readyState === 1 &&
        s.realtimeSocket.send(
          JSON.stringify({ type: "SUBSCRIBE", collection: e, ...t }),
        ),
        () => {
          s.subscriptions.delete(e);
        }),
    };
  }
  connectRealtime() {
    if (
      typeof WebSocket > "u" ||
      this.realtimeSocket &&
        (this.realtimeSocket.readyState === 0 ||
          this.realtimeSocket.readyState === 1)
    ) return;
    let e = this.baseUrl.replace("http", "ws") +
      `/api/realtime?db=${this.dbName}` +
      (this.token ? `&auth=${this.token}` : "");
    this.realtimeSocket = new WebSocket(e),
      this.realtimeSocket.onopen = () => {
        this.subscriptions.forEach((s, r) => {
          this.realtimeSocket?.send(
            JSON.stringify({ type: "SUBSCRIBE", collection: r, ...s.options }),
          );
        });
      },
      this.realtimeSocket.onmessage = (s) => {
        let r = JSON.parse(s.data), t = this.subscriptions.get(r.collection);
        !t || !r.events || r.events.forEach((o) => {
          try {
            t.callback(o.data),
              t.options?.group || (t.options = { ...t.options, lastId: o.id }),
              o.ackId && t.options?.group &&
              this.realtimeSocket?.send(
                JSON.stringify({
                  type: "ACK",
                  collection: r.collection,
                  id: o.ackId,
                  group: t.options.group,
                }),
              );
          } catch (a) {
            console.error("Error handling realtime event:", a);
          }
        });
      },
      this.realtimeSocket.onclose = () => {
        this.subscriptions.size > 0 &&
          setTimeout(() => this.connectRealtime(), 3e3);
      };
  }
  get migrations() {
    let e = this, s = "_migrations";
    return {
      getList: async (r = 1, t = 500, o = {}) => {
        let a = new URLSearchParams({ page: String(r), perPage: String(t) });
        o.filter && a.append("filter", o.filter),
          o.sort && a.append("sort", o.sort);
        let i = await fetch(
          `${e.baseUrl}/api/collections/${s}/records?${a.toString()}`,
          { headers: e.adminHeaders },
        );
        if (!i.ok) throw new Error(await i.text());
        return i.json();
      },
      create: async (r) => {
        let t = await fetch(`${e.baseUrl}/api/collections/${s}/records`, {
          method: "POST",
          headers: e.adminHeaders,
          body: JSON.stringify(r),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      delete: async (r) => {
        let t = await fetch(`${e.baseUrl}/api/collections/${s}/records/${r}`, {
          method: "DELETE",
          headers: e.adminHeaders,
        });
        if (!t.ok) throw new Error(await t.text());
        return await t.text(), !0;
      },
      run: async (r) => {
        let t = await e.migrations.getList(1, 500),
          o = new Set(t.items.map((a) => a.name));
        for (let a of r) {
          o.has(a.name) ||
            (console.log(`[Migrations] Applying: ${a.name}`),
              await a.up(e),
              await e.migrations.create({
                name: a.name,
                appliedAt: new Date().toISOString(),
                batch: 1,
              }));
        }
      },
    };
  }
  get workflow() {
    let e = this, s = `${e.baseUrl}/api/workflows`;
    return {
      createRun: async (r) => {
        let t = await fetch(`${s}/runs`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify(r),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      trigger: async (r, t, o = {}) => {
        let c = { ...h.get(r)?.prototype?.workflowOptions || {}, ...o },
          w = await e.workflow.createRun({
            deploymentId: c.deploymentId || "sdk",
            workflowName: r,
            input: t,
            ...c,
          });
        return await e.workflow.queueMessage(`__wkf_workflow_${r}`, {
          type: "workflow_start",
          runId: w.runId,
          workflowName: r,
          input: t,
        }),
          w;
      },
      resume: async (r) => {
        let t = await e.workflow.getRun(r);
        return await e.workflow.queueMessage(
          `__wkf_workflow_${t.workflowName}`,
          {
            type: "resume",
            runId: t.runId,
            workflowName: t.workflowName,
            input: t.input,
          },
        ),
          t;
      },
      getRun: async (r) => {
        let t = await fetch(`${s}/runs/${r}`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      updateRun: async (r, t) => {
        let o = await fetch(`${s}/runs/${r}`, {
          method: "PATCH",
          headers: e.headers,
          body: JSON.stringify(t),
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      listRuns: async (r = {}) => {
        let t = new URLSearchParams();
        r.workflowName && t.append("workflowName", r.workflowName),
          r.status && t.append("status", r.status),
          r.limit && t.append("limit", String(r.limit)),
          r.cursor && t.append("cursor", r.cursor);
        let o = await fetch(`${s}/runs?${t.toString()}`, {
          headers: e.headers,
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      createStep: async (r, t) => {
        let o = await fetch(`${s}/steps`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ runId: r, ...t }),
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      updateStep: async (r, t, o) => {
        let a = await fetch(`${s}/steps/${r}/${t}`, {
          method: "PATCH",
          headers: e.headers,
          body: JSON.stringify(o),
        });
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      createEvent: async (r, t) => {
        let o = await fetch(`${s}/events`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ runId: r, ...t }),
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      listEvents: async (r) => {
        let t = await fetch(`${s}/runs/${r}/events`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      pollQueue: async (r) => {
        let t = await fetch(`${s}/queue/${r}`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        let o = await t.text();
        return o ? JSON.parse(o) : null;
      },
      sendSignal: async (r, t, o, a) => {
        await e.workflow.createEvent(r, {
          eventType: "signal_received",
          correlationId: a || `signal-${t}-${crypto.randomUUID()}`,
          payload: { name: t, data: o },
        });
        let i = await e.workflow.getRun(r);
        return await e.workflow.queueMessage(
          `__wkf_workflow_${i.workflowName}`,
          {
            type: "signal",
            runId: r,
            workflowName: i.workflowName,
            input: i.input,
          },
        ),
          !0;
      },
      queueMessage: async (r, t, o) => {
        let a = await fetch(`${s}/queue`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ queueName: r, message: t, opts: o }),
        });
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      ack: async (r) => {
        let t = await fetch(`${s}/queue/ack`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ messageId: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      nack: async (r) => {
        let t = await fetch(`${s}/queue/nack`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ messageId: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      touch: async (r) => {
        let t = await fetch(`${s}/queue/touch`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ messageId: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      hooks: {
        create: async (r, t) => {
          let o = await fetch(`${s}/hooks`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify({ runId: r, ...t }),
          });
          if (!o.ok) throw new Error(await o.text());
          return o.json();
        },
        get: async (r) => {
          let t = await fetch(`${s}/hooks/${r}`, { headers: e.headers });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        getByToken: async (r) => {
          let t = await fetch(`${s}/hooks?token=${r}`, { headers: e.headers });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        list: async (r) => {
          let t = await fetch(`${s}/hooks?runId=${r}`, { headers: e.headers });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        dispose: async (r) => {
          let t = await fetch(`${s}/hooks/${r}`, {
            method: "DELETE",
            headers: e.headers,
          });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
      },
    };
  }
  async gate(e, s, r) {
    let t = {
      method: "POST",
      ...r,
      headers: { ...this.headers, ...r?.headers || {} },
    };
    return s && (t.body = JSON.stringify(s)),
      await fetch(`${this.baseUrl}/api/gates/${e}`, t);
  }
};
var l = class extends Error {
  constructor(e = "Workflow suspended") {
    super(e), this.name = "WorkflowSuspension";
  }
};
var f = class {
  client;
  runId = "";
  workflowName = "unknown";
  workflowOptions = {};
  history = new Map();
  completedSteps = new Set();
  rollbackStack = [];
  stepAttempts = new Map();
  callCounter = 0;
  signalQueues = new Map();
  signalCursors = new Map();
  isSuspended = !1;
  invokedSteps = new Set();
  emittedEvents = new Set();
  constructor(e) {
    e && (this.client = e);
  }
  async parallel(e) {
    return await Promise.all(e.map((s) => s()));
  }
  getSequentialId(e) {
    return `${e}-${this.callCounter++}`;
  }
  async sleep(e) {
    let s = this.getSequentialId("sleep");
    if (this.completedSteps.has(s)) return;
    if (!this.runId) {
      throw new Error("Cannot sleep outside of a workflow context.");
    }
    if (this.emittedEvents.has(s)) {
      throw this.isSuspended = !0, new l(`Sleeping for ${s}`);
    }
    let r = 0;
    if (typeof e == "string") {
      if (e.endsWith("s")) r = parseFloat(e) * 1e3;
      else if (e.endsWith("m")) r = parseFloat(e) * 6e4;
      else if (e.endsWith("ms")) r = parseFloat(e);
      else if (r = parseFloat(e), isNaN(r)) {
        throw new Error(`Invalid duration format: ${e}`);
      }
    } else r = e;
    let t = new Date(Date.now() + r);
    throw await this.client.workflow.createEvent(this.runId, {
      eventType: "wait_created",
      correlationId: s,
      payload: { duration: r, resumeAt: t.toISOString() },
    }),
      this.emittedEvents.add(s),
      this.isSuspended = !0,
      new l(`Sleeping for ${r}ms`);
  }
  async waitForSignal(e) {
    let s = this.getSequentialId(`signal-${e}`);
    if (this.history.has(s)) {
      let t = this.history.get(s), o = this.signalQueues.get(e);
      if (o) {
        let a = this.signalCursors.get(e) || 0;
        a < o.length && o[a] === t && this.signalCursors.set(e, a + 1);
      }
      return t;
    }
    let r = this.signalQueues.get(e);
    if (r) {
      let t = this.signalCursors.get(e) || 0;
      if (t < r.length) {
        let o = r[t];
        return this.signalCursors.set(e, t + 1), o;
      }
    }
    throw this.runId
      ? this.emittedEvents.has(s)
        ? (this.isSuspended = !0, new l(`Waiting for signal: ${e}`))
        : (await this.client.workflow.createEvent(this.runId, {
          eventType: "signal_waiting",
          correlationId: s,
          payload: { name: e },
        }),
          this.emittedEvents.add(s),
          this.isSuspended = !0,
          new l(`Waiting for signal: ${e}`))
      : new Error("Cannot wait for signal outside of a workflow context.");
  }
  async runRollback(e) {
    let s = {}, r = [...this.rollbackStack];
    for (; r.length > 0;) {
      let t = r.pop();
      if (typeof this[t] == "function") {
        try {
          let o = await this[t](e, s);
          s[t] = o;
        } catch (o) {
          if (o.name === "StopRollback") break;
          console.error(`Rollback method ${t} failed:`, o.message);
        }
      }
    }
  }
  rebuildState(e) {
    this.history.clear(),
      this.completedSteps.clear(),
      this.invokedSteps.clear(),
      this.emittedEvents.clear(),
      this.rollbackStack = [],
      this.stepAttempts.clear(),
      this.signalQueues.clear(),
      this.signalCursors.clear(),
      this.callCounter = 0;
    for (let s of e) {
      let r = s.payload || {};
      switch (
        s.correlationId && this.emittedEvents.add(s.correlationId), s.eventType
      ) {
        case "step_completed":
          this.completedSteps.add(s.correlationId),
            this.history.set(s.correlationId, r.output);
          break;
        case "wait_completed":
          this.completedSteps.add(s.correlationId);
          break;
        case "signal_received":
          if (this.history.set(s.correlationId, r.data), r.name) {
            let t = r.name;
            this.signalQueues.has(t) || this.signalQueues.set(t, []),
              this.signalQueues.get(t).push(r.data);
          }
          break;
        case "rollback_registered":
          this.rollbackStack.push(r.method);
          break;
        case "step_retrying":
          this.stepAttempts.set(s.correlationId, r.attempt);
          break;
      }
    }
  }
  async executeStep(e, s, r, t = {}) {
    if (!this.runId) return s.apply(this, r);
    if (this.invokedSteps.has(e)) {
      throw new Error(
        `Duplicate step ID detected: "${e}". Each step within a workflow must have a unique ID.`,
      );
    }
    if (this.invokedSteps.add(e), this.completedSteps.has(e)) {
      return this.history.get(e);
    }
    if (t.rollback) {
      for (let i of t.rollback) {
        let c = `${e}-rb-${i}`;
        this.history.has(c) ||
          (await this.client.workflow.createEvent(this.runId, {
            eventType: "rollback_registered",
            correlationId: c,
            payload: { method: i },
          }),
            this.rollbackStack.push(i));
      }
    }
    let o = t.retries || 0, a = 0;
    for (
      this.stepAttempts.has(e) || this.stepAttempts.set(e, 0),
        a = this.stepAttempts.get(e);;
    ) {
      try {
        this.emittedEvents.has(e) ||
          (await this.client.workflow.createEvent(this.runId, {
            eventType: "step_started",
            correlationId: e,
            payload: { attempt: a },
          }),
            this.emittedEvents.add(e));
        let i = await s.apply(this, r);
        return await this.client.workflow.createEvent(this.runId, {
          eventType: "step_completed",
          correlationId: e,
          payload: { output: i },
        }),
          this.completedSteps.add(e),
          this.history.set(e, i),
          i;
      } catch (i) {
        if (a < o) {
          a++,
            this.stepAttempts.set(e, a),
            await this.client.workflow.createEvent(this.runId, {
              eventType: "step_retrying",
              correlationId: e,
              payload: { error: i.message, attempt: a },
            }),
            await new Promise((c) => setTimeout(c, 1e3 * a));
          continue;
        }
        throw await this.client.workflow.createEvent(this.runId, {
          eventType: "step_failed",
          correlationId: e,
          payload: { error: i.message, attempt: a },
        }),
          i;
      }
    }
  }
};
function P(n, e = {}) {
  return function (s) {
    h.set(n, s), s.prototype.workflowName = n, s.prototype.workflowOptions = e;
    let r = s.prototype.run;
    r && (s.prototype.run = async function (...t) {
      let o = this;
      if (!o.client) throw new Error("Workflow needs a RocketBaseClient.");
      if (!o.runId) {
        let a = await o.client.workflow.trigger(n, t, e);
        o.runId = a.runId;
      }
      await o.client.workflow.updateRun(o.runId, { status: "running" });
      try {
        let a = await r.apply(o, t);
        return o.isSuspended ||
          await o.client.workflow.updateRun(o.runId, {
            status: "completed",
            output: a,
          }),
          a;
      } catch (a) {
        if (a instanceof l) return;
        console.error(`[Workflow ${n}] Failed:`, a.message);
        try {
          await o.runRollback(a);
        } catch (i) {
          console.error(`[Workflow ${n}] Rollback failed:`, i.message);
        }
        throw await o.client.workflow.updateRun(o.runId, {
          status: "failed",
          error: { message: a.message, stack: a.stack },
        }),
          a;
      }
    });
  };
}
function U(n, e = {}) {
  return function (s, r, t) {
    let o = t.value;
    t.value = async function (...a) {
      return this.executeStep(n, o, a, e);
    };
  };
}
var m = class {
  client;
  socket;
  active;
  workflowName;
  stopCallback;
  activeJobs;
  constructor(e) {
    this.client = e,
      this.socket = null,
      this.active = !1,
      this.workflowName = "",
      this.stopCallback = null,
      this.activeJobs = new Set();
  }
  async start(e, s = {}) {
    return this.active = !0,
      this.workflowName = e,
      this.connect(e),
      s.resume &&
      this.resumePending(e).catch((r) =>
        console.error(`[Worker ${e}] Resume failed:`, r)
      ),
      new Promise((r) => {
        this.stopCallback = r;
      });
  }
  async resumePending(e) {
    let s = await this.client.workflow.listRuns({
        workflowName: e,
        status: "pending",
      }),
      r = await this.client.workflow.listRuns({
        workflowName: e,
        status: "running",
      }),
      t = [...s.items, ...r.items];
    console.log(`[Worker ${e}] Resuming ${t.length} runs`);
    for (let o of t) await this.client.workflow.resume(o.runId);
  }
  async stop() {
    this.active = !1,
      this.socket &&
      (this.socket.onopen = null,
        this.socket.onmessage = null,
        this.socket.onerror = null,
        this.socket.onclose = null,
        this.socket.close(),
        this.socket = null),
      this.activeJobs.size > 0 &&
      (console.log(
        `[Worker ${this.workflowName}] Waiting for ${this.activeJobs.size} jobs to complete...`,
      ),
        await Promise.allSettled(this.activeJobs)),
      this.stopCallback && (this.stopCallback(), this.stopCallback = null);
  }
  connect(e) {
    if (
      !this.active ||
      this.socket &&
        (this.socket.readyState === 0 || this.socket.readyState === 1)
    ) return;
    let s = this.client.getToken(),
      r = this.client.baseUrl.replace(/^http/, "ws") +
        `/api/workflow/ws?db=${this.client.dbName}` + (s ? `&auth=${s}` : "");
    this.socket = new WebSocket(r),
      this.socket.onopen = () => {
        console.log(`[Worker ${e}] Connected to ${r}`),
          this.socket?.send(
            JSON.stringify({
              event: "SUBSCRIBE",
              data: { queue: `__wkf_workflow_${e}` },
            }),
          );
      },
      this.socket.onmessage = (t) => {
        try {
          let o = JSON.parse(t.data);
          if (o.event === "JOB") {
            let a = this.processJob(o.data);
            this.activeJobs.add(a), a.finally(() => this.activeJobs.delete(a));
          }
        } catch (o) {
          console.error(`[Worker ${e}] Error handling message:`, o);
        }
      },
      this.socket.onclose = () => {
        this.active &&
          (console.log(`[Worker ${e}] Disconnected, retrying...`),
            setTimeout(() => this.connect(e), 3e3));
      },
      this.socket.onerror = (t) => {
        console.error(`[Worker ${e}] WebSocket error:`, t);
      };
  }
  async processJob(e) {
    console.log(`[Worker ${this.workflowName}] Processing job ${e.id}`);
    let { runId: s, input: r } = e.data,
      t = setInterval(async () => {
        try {
          await this.client.workflow.touch(e.id);
        } catch {
          console.warn(
            `[Worker ${this.workflowName}] Heartbeat failed for job ${e.id}`,
          );
        }
      }, 15e3);
    if (e.data.workflowName && e.data.workflowName !== this.workflowName) {
      console.warn(
        `[Worker ${this.workflowName}] Received job for ${e.data.workflowName}, ignoring`,
      ),
        clearInterval(t),
        await this.client.workflow.nack(e.id);
      return;
    }
    try {
      let [o, a] = await Promise.all([
          this.client.workflow.getRun(s),
          this.client.workflow.listEvents(s),
        ]),
        i = h.get(this.workflowName);
      if (!i) {
        console.error(
          `[Worker ${this.workflowName}] Workflow class not found in registry. Registered:`,
          Array.from(h.keys()),
        ),
          clearInterval(t),
          await this.client.workflow.nack(e.id);
        return;
      }
      let c = new i(this.client);
      c.runId = s, c.rebuildState(a);
      let w = o.executionTimeout || 3e4,
        p,
        y = new Promise((b, S) => {
          p = setTimeout(
            () => S(new Error("CircuitBreaker: Execution timeout")),
            w,
          );
        });
      try {
        await Promise.race([c.run(...r || []), y]);
      } finally {
        clearTimeout(p);
      }
      clearInterval(t),
        await this.client.workflow.ack(e.id),
        c.isSuspended
          ? console.log(`[Worker ${this.workflowName}] Job ${e.id} suspended`)
          : console.log(`[Worker ${this.workflowName}] Job ${e.id} completed`);
    } catch (o) {
      if (clearInterval(t), o instanceof l) {
        await this.client.workflow.ack(e.id),
          console.log(`[Worker ${this.workflowName}] Job ${e.id} suspended`);
        return;
      }
      if (
        console.error(
          `[Worker ${this.workflowName}] Job ${e.id} failed:`,
          o.message,
        ), o.message === "CircuitBreaker: Execution timeout"
      ) {
        try {
          await this.client.workflow.updateRun(s, {
            status: "failed",
            error: { message: o.message },
          });
        } catch (a) {
          console.error(
            `[Worker ${this.workflowName}] Failed to update run status:`,
            a,
          );
        }
      }
      await this.client.workflow.ack(e.id);
    }
  }
};
var g = class extends Error {
  constructor(e = "Rollback stopped") {
    super(e), this.name = "StopRollback";
  }
};
var d = null,
  u = {
    run: (n, e) => {
      let s = d;
      d = n;
      try {
        let r = e();
        return r instanceof Promise
          ? r.finally(() => {
            d = s;
          })
          : (d = s, r);
      } catch (r) {
        throw d = s, r;
      }
    },
    getStore: () => d,
  };
function M(n, e = {}) {
  return {
    run: (s) => {
      let r = class extends f {
        static workflowName = n;
        workflowName = n;
        workflowOptions = e;
        async run(...o) {
          let a = this;
          return await u.run(this, async () => {
            try {
              return await s.call(a, a, ...o);
            } catch (i) {
              throw i;
            }
          });
        }
      };
      h.set(n, r);
      let t = r.prototype.run;
      return r.prototype.run = async function (...o) {
        let a = this;
        if (!a.client) throw new Error("Workflow needs a RocketBaseClient.");
        if (!a.runId) {
          let i = await a.client.workflow.trigger(n, o, e);
          a.runId = i.runId;
        }
        await a.client.workflow.updateRun(a.runId, { status: "running" });
        try {
          let i = await t.apply(a, o);
          return a.isSuspended ||
            await a.client.workflow.updateRun(a.runId, {
              status: "completed",
              output: i,
            }),
            i;
        } catch (i) {
          if (i instanceof l) return;
          console.error(`[Workflow ${n}] Failed:`, i.message);
          try {
            await a.runRollback(i);
          } catch (c) {
            console.error(`[Workflow ${n}] Rollback failed:`, c.message);
          }
          throw await a.client.workflow.updateRun(a.runId, {
            status: "failed",
            error: { message: i.message, stack: i.stack },
          }),
            i;
        }
      },
        r;
    },
  };
}
function B(n, e, s) {
  let r, t, o = {};
  return typeof n == "string"
    ? (r = n, t = e, o = s || {})
    : (t = n, r = "", o = e || {}),
    async function (...a) {
      let i = this instanceof f ? this : u.getStore();
      if (!i) return await t(...a);
      let c = t.name || "step", w = r || i.getSequentialId(c);
      return i.executeStep(w, t.bind(i), a, o);
    };
}
export {
  B as step,
  f as WorkflowBase,
  g as StopRollback,
  h as WorkflowRegistry,
  k as RocketBaseClient,
  M as workflow,
  m as WorkflowWorker,
  P as Workflow,
  U as Step,
};
//# sourceMappingURL=exports.js.map
