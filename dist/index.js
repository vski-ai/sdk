var u = class {
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
    (this.realtimeSocket.close(), this.realtimeSocket = null),
      this.subscriptions.clear();
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
          return !0;
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
          return !0;
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
        let a = await t.json();
        return e.setToken(a.token), a;
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
        let a = await fetch(`${e.baseUrl}/api/auth/oauth2-login`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ provider: s, code: r, redirectUrl: t }),
        });
        if (!a.ok) throw new Error(await a.text());
        let o = await a.json();
        return e.setToken(o.token), o;
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
        let a = await t.json();
        return e.setToken(a.token), a;
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
        return s.ok ? s.json() : { hasAdmins: !1 };
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
        return !0;
      },
    };
  }
  get webhookLogs() {
    let e = this;
    return {
      list: async (s = {}) => {
        let r = new URLSearchParams();
        Object.entries(s).forEach(([a, o]) => {
          o !== void 0 && o !== "" && r.append(a, o.toString());
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
      getList: async (r = 1, t = 30, a = {}) => {
        let o = new URLSearchParams({ page: String(r), perPage: String(t) });
        a.filter && o.append("filter", a.filter),
          a.expand && o.append("expand", a.expand);
        let n = await fetch(
          `${s.baseUrl}/api/collections/${e}/records?${o.toString()}`,
          { headers: s.headers },
        );
        if (!n.ok) throw new Error(await n.text());
        return n.json();
      },
      getOne: async (r, t = {}) => {
        let a = new URLSearchParams();
        t.expand && a.append("expand", t.expand);
        let o = await fetch(
          `${s.baseUrl}/api/collections/${e}/records/${r}?${a.toString()}`,
          { headers: s.headers },
        );
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      search: async (r, t = {}) => {
        let a = new URLSearchParams({ q: r });
        t.page && a.append("page", String(t.page)),
          t.perPage && a.append("perPage", String(t.perPage)),
          t.expand && a.append("expand", t.expand),
          t.snippet && a.append("snippet", "true");
        let o = await fetch(
          `${s.baseUrl}/api/collections/${e}/records/search?${a.toString()}`,
          { headers: s.headers },
        );
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      getView: async (r, t = {}) => {
        let a = new URLSearchParams();
        t.page && a.append("page", String(t.page)),
          t.perPage && a.append("perPage", String(t.perPage)),
          t.expand && a.append("expand", t.expand),
          t.filter && a.append("filter", t.filter),
          t.sort && a.append("sort", t.sort);
        let o = await fetch(
          `${s.baseUrl}/api/collections/${e}/records/views/${r}?${a.toString()}`,
          { headers: s.headers },
        );
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      create: async (r) => {
        let t = r instanceof FormData, a = { ...s.headers };
        t && delete a["Content-Type"];
        let o = await fetch(`${s.baseUrl}/api/collections/${e}/records`, {
          method: "POST",
          headers: a,
          body: t ? r : JSON.stringify(r),
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      update: async (r, t) => {
        let a = t instanceof FormData, o = { ...s.headers };
        a && delete o["Content-Type"];
        let n = await fetch(`${s.baseUrl}/api/collections/${e}/records/${r}`, {
          method: "PATCH",
          headers: o,
          body: a ? t : JSON.stringify(t),
        });
        if (!n.ok) throw new Error(await n.text());
        return n.json();
      },
      bulkUpdate: async (r, t) => {
        let a = await fetch(`${s.baseUrl}/api/collections/${e}/records/bulk`, {
          method: "PATCH",
          headers: s.headers,
          body: JSON.stringify({ ids: r, data: t }),
        });
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      delete: async (r) => {
        let t = await fetch(`${s.baseUrl}/api/collections/${e}/records/${r}`, {
          method: "DELETE",
          headers: s.headers,
        });
        if (!t.ok) throw new Error(await t.text());
        return !0;
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
        let a = await fetch(
          `${s.baseUrl}/api/collections/${e}/auth-with-password`,
          {
            method: "POST",
            headers: s.headers,
            body: JSON.stringify({ identity: r, password: t }),
          },
        );
        if (!a.ok) throw new Error(await a.text());
        let o = await a.json();
        return s.setToken(o.token), o;
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
        !t || !r.events || r.events.forEach((a) => {
          try {
            t.callback(a.data),
              t.options?.group || (t.options = { ...t.options, lastId: a.id }),
              a.ackId && t.options?.group &&
              this.realtimeSocket?.send(
                JSON.stringify({
                  type: "ACK",
                  collection: r.collection,
                  id: a.ackId,
                  group: t.options.group,
                }),
              );
          } catch (o) {
            console.error("Error handling realtime event:", o);
          }
        });
      },
      this.realtimeSocket.onclose = () => {
        setTimeout(() => this.connectRealtime(), 3e3);
      };
  }
  get migrations() {
    let e = this, s = "_migrations";
    return {
      getList: async (r = 1, t = 500, a = {}) => {
        let o = new URLSearchParams({ page: String(r), perPage: String(t) });
        a.filter && o.append("filter", a.filter),
          a.sort && o.append("sort", a.sort);
        let n = await fetch(
          `${e.baseUrl}/api/collections/${s}/records?${o.toString()}`,
          { headers: e.adminHeaders },
        );
        if (!n.ok) throw new Error(await n.text());
        return n.json();
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
        return !0;
      },
      run: async (r) => {
        let t = await e.migrations.getList(1, 500),
          a = new Set(t.items.map((o) => o.name));
        for (let o of r) {
          a.has(o.name) ||
            (console.log(`[Migrations] Applying: ${o.name}`),
              await o.up(e),
              await e.migrations.create({
                name: o.name,
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
      trigger: async (r, t, a = {}) => {
        let o = await e.workflow.createRun({
          deploymentId: a.deploymentId || "sdk",
          workflowName: r,
          input: t,
        });
        return await e.workflow.queueMessage(`__wkf_workflow_${r}`, {
          type: "workflow_start",
          runId: o.runId,
          workflowName: r,
          input: t,
        }),
          o;
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
        let a = await fetch(`${s}/runs/${r}`, {
          method: "PATCH",
          headers: e.headers,
          body: JSON.stringify(t),
        });
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      listRuns: async (r = {}) => {
        let t = new URLSearchParams();
        r.workflowName && t.append("workflowName", r.workflowName),
          r.status && t.append("status", r.status),
          r.limit && t.append("limit", String(r.limit)),
          r.cursor && t.append("cursor", r.cursor);
        let a = await fetch(`${s}/runs?${t.toString()}`, {
          headers: e.headers,
        });
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      createStep: async (r, t) => {
        let a = await fetch(`${s}/steps`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ runId: r, ...t }),
        });
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      updateStep: async (r, t, a) => {
        let o = await fetch(`${s}/steps/${r}/${t}`, {
          method: "PATCH",
          headers: e.headers,
          body: JSON.stringify(a),
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      createEvent: async (r, t) => {
        let a = await fetch(`${s}/events`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ runId: r, ...t }),
        });
        if (!a.ok) throw new Error(await a.text());
        return a.json();
      },
      listEvents: async (r) => {
        let t = await fetch(`${s}/runs/${r}/events`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      pollQueue: async (r) => {
        let t = await fetch(`${s}/queue/${r}`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        let a = await t.text();
        return a ? JSON.parse(a) : null;
      },
      sendSignal: async (r, t, a, o) => {
        await e.workflow.createEvent(r, {
          eventType: "signal_received",
          correlationId: o || `signal-${t}-${crypto.randomUUID()}`,
          payload: { name: t, data: a },
        });
        let n = await e.workflow.getRun(r);
        return await e.workflow.queueMessage(
          `__wkf_workflow_${n.workflowName}`,
          {
            type: "signal",
            runId: r,
            workflowName: n.workflowName,
            input: n.input,
          },
        ),
          !0;
      },
      queueMessage: async (r, t, a) => {
        let o = await fetch(`${s}/queue`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ queueName: r, message: t, opts: a }),
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
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
      hooks: {
        create: async (r, t) => {
          let a = await fetch(`${s}/hooks`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify({ runId: r, ...t }),
          });
          if (!a.ok) throw new Error(await a.text());
          return a.json();
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
};
var l = new Map();
var c = class extends Error {
  constructor(e = "Workflow suspended") {
    super(e), this.name = "WorkflowSuspension";
  }
};
var d = class {
  client;
  runId = "";
  workflowName = "unknown";
  history = new Map();
  completedSteps = new Set();
  rollbackStack = [];
  stepAttempts = new Map();
  callCounter = 0;
  signalQueues = new Map();
  signalCursors = new Map();
  isSuspended = !1;
  constructor(e) {
    e && (this.client = e);
  }
  async parallel(e) {
    return await Promise.all(e.map((s) => s()));
  }
  getDeterministicId(e) {
    return `${e}-${this.callCounter++}`;
  }
  async sleep(e) {
    let s = this.getDeterministicId("sleep");
    if (this.completedSteps.has(s)) return;
    if (!this.runId) {
      throw new Error("Cannot sleep outside of a workflow context.");
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
      this.isSuspended = !0,
      new c(`Sleeping for ${r}ms`);
  }
  async waitForSignal(e) {
    let s = this.getDeterministicId(`signal-${e}`);
    if (this.history.has(s)) {
      let t = this.history.get(s), a = this.signalQueues.get(e);
      if (a) {
        let o = this.signalCursors.get(e) || 0;
        o < a.length && a[o] === t && this.signalCursors.set(e, o + 1);
      }
      return t;
    }
    let r = this.signalQueues.get(e);
    if (r) {
      let t = this.signalCursors.get(e) || 0;
      if (t < r.length) {
        let a = r[t];
        return this.signalCursors.set(e, t + 1), a;
      }
    }
    throw this.runId
      ? (await this.client.workflow.createEvent(this.runId, {
        eventType: "signal_waiting",
        correlationId: s,
        payload: { name: e },
      }),
        this.isSuspended = !0,
        new c(`Waiting for signal: ${e}`))
      : new Error("Cannot wait for signal outside of a workflow context.");
  }
  async runRollback(e) {
    let s = {}, r = [...this.rollbackStack];
    for (; r.length > 0;) {
      let t = r.pop();
      if (typeof this[t] == "function") {
        try {
          let a = await this[t](e, s);
          s[t] = a;
        } catch (a) {
          if (a.name === "StopRollback") break;
          console.error(`Rollback method ${t} failed:`, a.message);
        }
      }
    }
  }
  rebuildState(e) {
    this.history.clear(),
      this.completedSteps.clear(),
      this.rollbackStack = [],
      this.stepAttempts.clear(),
      this.signalQueues.clear(),
      this.signalCursors.clear(),
      this.callCounter = 0;
    for (let s of e) {
      let r = s.payload || {};
      switch (s.eventType) {
        case "step_completed":
          this.completedSteps.add(s.correlationId),
            this.history.set(s.correlationId, r.output);
          break;
        case "wait_completed":
          this.completedSteps.add(s.correlationId);
          break;
        case "signal_received":
          this.history.set(s.correlationId, r.data),
            r.name &&
            (this.signalQueues.has(r.name) || this.signalQueues.set(r.name, []),
              this.signalQueues.get(r.name).push(r.data));
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
    if (this.completedSteps.has(e)) return this.history.get(e);
    if (t.rollback) {
      for (let n of t.rollback) {
        let h = `${e}-rb-${n}`;
        this.history.has(h) ||
          (await this.client.workflow.createEvent(this.runId, {
            eventType: "rollback_registered",
            correlationId: h,
            payload: { method: n },
          }),
            this.rollbackStack.push(n));
      }
    }
    let a = t.retries || 0, o = 0;
    for (
      this.stepAttempts.has(e) || this.stepAttempts.set(e, 0),
        o = this.stepAttempts.get(e);;
    ) {
      try {
        await this.client.workflow.createEvent(this.runId, {
          eventType: "step_started",
          correlationId: e,
          payload: { attempt: o },
        });
        let n = await s.apply(this, r);
        return await this.client.workflow.createEvent(this.runId, {
          eventType: "step_completed",
          correlationId: e,
          payload: { output: n },
        }),
          this.completedSteps.add(e),
          this.history.set(e, n),
          n;
      } catch (n) {
        if (o < a) {
          o++,
            this.stepAttempts.set(e, o),
            await this.client.workflow.createEvent(this.runId, {
              eventType: "step_retrying",
              correlationId: e,
              payload: { error: n.message, attempt: o },
            }),
            await new Promise((h) => setTimeout(h, 1e3 * o));
          continue;
        }
        throw await this.client.workflow.createEvent(this.runId, {
          eventType: "step_failed",
          correlationId: e,
          payload: { error: n.message, attempt: o },
        }),
          n;
      }
    }
  }
};
function E(i) {
  return function (e) {
    l.set(i, e), e.prototype.workflowName = i;
    let s = e.prototype.run;
    s && (e.prototype.run = async function (...r) {
      let t = this;
      if (!t.client) throw new Error("Workflow needs a RocketBaseClient.");
      if (!t.runId) {
        let a = await t.client.workflow.trigger(i, r);
        t.runId = a.runId;
      }
      await t.client.workflow.updateRun(t.runId, { status: "running" });
      try {
        let a = await s.apply(t, r);
        return t.isSuspended ||
          await t.client.workflow.updateRun(t.runId, {
            status: "completed",
            output: a,
          }),
          a;
      } catch (a) {
        if (a instanceof c) return;
        console.error(`[Workflow ${i}] Failed:`, a.message);
        try {
          await t.runRollback(a);
        } catch (o) {
          console.error(`[Workflow ${i}] Rollback failed:`, o.message);
        }
        throw await t.client.workflow.updateRun(t.runId, {
          status: "failed",
          error: { message: a.message, stack: a.stack },
        }),
          a;
      }
    });
  };
}
function I(i, e = {}) {
  return function (s, r, t) {
    let a = t.value;
    t.value = async function (...o) {
      return this.executeStep(i, a, o, e);
    };
  };
}
var p = class {
  client;
  socket;
  active;
  workflowName;
  stopCallback;
  constructor(e) {
    this.client = e,
      this.socket = null,
      this.active = !1,
      this.workflowName = "",
      this.stopCallback = null;
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
      t = [...s.data, ...r.data];
    console.log(`[Worker ${e}] Resuming ${t.length} runs`);
    for (let a of t) await this.client.workflow.resume(a.runId);
  }
  stop() {
    this.active = !1,
      this.socket && (this.socket.close(), this.socket = null),
      this.stopCallback && (this.stopCallback(), this.stopCallback = null);
  }
  connect(e) {
    if (!this.active) return;
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
      this.socket.onmessage = async (t) => {
        try {
          let a = JSON.parse(t.data);
          a.event === "JOB" && await this.processJob(a.data);
        } catch (a) {
          console.error(`[Worker ${e}] Error handling message:`, a);
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
    let { runId: s, input: r } = e.data;
    if (e.data.workflowName && e.data.workflowName !== this.workflowName) {
      console.warn(
        `[Worker ${this.workflowName}] Received job for ${e.data.workflowName}, ignoring`,
      ), await this.client.workflow.nack(e.id);
      return;
    }
    try {
      let t = await this.client.workflow.listEvents(s),
        a = l.get(this.workflowName);
      if (!a) {
        console.error(
          `[Worker ${this.workflowName}] Workflow class not found in registry. Registered:`,
          Array.from(l.keys()),
        ), await this.client.workflow.nack(e.id);
        return;
      }
      let o = new a(this.client);
      o.runId = s,
        o.rebuildState(t),
        await o.run(...r || []),
        await this.client.workflow.ack(e.id),
        console.log(`[Worker ${this.workflowName}] Job ${e.id} completed`);
    } catch (t) {
      console.error(
        `[Worker ${this.workflowName}] Job ${e.id} failed:`,
        t.message,
      ), await this.client.workflow.ack(e.id);
    }
  }
};
var k = class extends Error {
  constructor(e = "Rollback stopped") {
    super(e), this.name = "StopRollback";
  }
};
var w = null,
  f = {
    run: (i, e) => {
      let s = w;
      w = i;
      try {
        let r = e();
        return r instanceof Promise
          ? r.finally(() => {
            w = s;
          })
          : (w = s, r);
      } catch (r) {
        throw w = s, r;
      }
    },
    getStore: () => w,
  };
function W(i) {
  return {
    run: (e) => {
      let s = class extends d {
        static workflowName = i;
        workflowName = i;
        async run(...t) {
          let a = this;
          return await f.run(this, async () => {
            try {
              return await e.call(a, a, ...t);
            } catch (o) {
              throw o;
            }
          });
        }
      };
      l.set(i, s);
      let r = s.prototype.run;
      return s.prototype.run = async function (...t) {
        let a = this;
        if (!a.client) throw new Error("Workflow needs a RocketBaseClient.");
        if (!a.runId) {
          let o = await a.client.workflow.trigger(i, t);
          a.runId = o.runId;
        }
        await a.client.workflow.updateRun(a.runId, { status: "running" });
        try {
          let o = await r.apply(a, t);
          return a.isSuspended ||
            await a.client.workflow.updateRun(a.runId, {
              status: "completed",
              output: o,
            }),
            o;
        } catch (o) {
          if (o instanceof c) return;
          console.error(`[Workflow ${i}] Failed:`, o.message);
          try {
            await a.runRollback(o);
          } catch (n) {
            console.error(`[Workflow ${i}] Rollback failed:`, n.message);
          }
          throw await a.client.workflow.updateRun(a.runId, {
            status: "failed",
            error: { message: o.message, stack: o.stack },
          }),
            o;
        }
      },
        s;
    },
  };
}
function C(i, e, s) {
  let r, t, a = {};
  return typeof i == "string"
    ? (r = i, t = e, a = s || {})
    : (t = i, r = "", a = e || {}),
    async function (...o) {
      let n = this instanceof d ? this : f.getStore();
      if (!n) return await t(...o);
      let h = r || n.getDeterministicId("step");
      return n.executeStep(h, t.bind(n), o, a);
    };
}
export {
  C as step,
  d as WorkflowBase,
  E as Workflow,
  I as Step,
  k as StopRollback,
  l as WorkflowRegistry,
  p as WorkflowWorker,
  u as RocketBaseClient,
  W as workflow,
};
//# sourceMappingURL=index.js.map
