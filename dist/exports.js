var w = new Map();
var k = class {
  baseUrl;
  token = null;
  apiKey = null;
  dbName = "postgres";
  adminDbName = "postgres";
  realtimeSocket = null;
  workflowSocket = null;
  subscriptions = new Map();
  workflowSubscriptions = new Map();
  constructor(e = "http://127.0.0.1:3000") {
    this.baseUrl = e.endsWith("/") ? e.slice(0, -1) : e,
      typeof window < "u" &&
      (this.token = localStorage.getItem("rb_auth_token"),
        this.apiKey = localStorage.getItem("rb_api_key"));
  }
  getToken() {
    return this.token;
  }
  setToken(e) {
    this.token = e,
      typeof window < "u" &&
      (e
        ? localStorage.setItem("rb_auth_token", e)
        : localStorage.removeItem("rb_auth_token")),
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
      this.realtimeSocket = null),
      this.workflowSocket &&
      (this.workflowSocket.onopen = null,
        this.workflowSocket.onmessage = null,
        this.workflowSocket.onerror = null,
        this.workflowSocket.onclose = null,
        this.workflowSocket.close(),
        this.workflowSocket = null),
      this.subscriptions.clear(),
      this.workflowSubscriptions.clear();
  }
  subscribeWorkflow(e, s) {
    return this.workflowSubscriptions.has(e) ||
      this.workflowSubscriptions.set(e, new Set()),
      this.workflowSubscriptions.get(e).add(s),
      this.connectWorkflow(),
      this.workflowSocket?.readyState === 1 &&
      this.workflowSocket.send(
        JSON.stringify({
          event: "SUBSCRIBE",
          data: { queue: `__wkf_workflow_${e}` },
        }),
      ),
      () => {
        let r = this.workflowSubscriptions.get(e);
        r &&
          (r.delete(s), r.size === 0 && this.workflowSubscriptions.delete(e));
      };
  }
  connectWorkflow() {
    if (
      typeof WebSocket > "u" ||
      this.workflowSocket &&
        (this.workflowSocket.readyState === 0 ||
          this.workflowSocket.readyState === 1)
    ) return;
    let e = this.getToken() || this.apiKey,
      s = this.baseUrl.replace(/^http/, "ws") +
        `/api/workflow/ws?db=${this.dbName}` + (e ? `&auth=${e}` : "");
    this.workflowSocket = new WebSocket(s),
      this.workflowSocket.onopen = () => {
        this.workflowSubscriptions.forEach((r, t) => {
          this.workflowSocket?.send(
            JSON.stringify({
              event: "SUBSCRIBE",
              data: { queue: `__wkf_workflow_${t}` },
            }),
          );
        });
      },
      this.workflowSocket.onmessage = (r) => {
        try {
          let t = JSON.parse(r.data);
          if (t.event === "JOB") {
            let o = t.data?.data?.workflowName;
            if (!o) return;
            let a = this.workflowSubscriptions.get(o);
            if (a && a.size > 0) {
              let i = Array.from(a),
                n = i[Math.floor(Math.random() * i.length)];
              n(t.data);
            }
          }
        } catch (t) {
          console.error("Error handling workflow message:", t);
        }
      },
      this.workflowSocket.onclose = () => {
        this.workflowSubscriptions.size > 0 &&
          setTimeout(() => this.connectWorkflow(), 3e3);
      };
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
        let n = { ...w.get(r)?.prototype?.workflowOptions || {}, ...o },
          l = await e.workflow.createRun({
            deploymentId: n.deploymentId || "sdk",
            workflowName: r,
            input: t,
            ...n,
          });
        return await e.workflow.queueMessage(`__wkf_workflow_${r}`, {
          type: "workflow_start",
          runId: l.runId,
          workflowName: r,
          input: t,
        }, { runId: l.runId, idempotencyKey: l.runId }),
          l;
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
          { runId: t.runId, idempotencyKey: t.runId },
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
      cancelRun: async (r, t) => {
        let o = await fetch(`${s}/runs/${r}`, {
          method: "DELETE",
          headers: e.headers,
          body: JSON.stringify({ reason: t }),
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
        let i = a || `signal-${t}-${crypto.randomUUID()}`;
        await e.workflow.createEvent(r, {
          eventType: "signal_received",
          correlationId: i,
          payload: { name: t, data: o },
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
          { runId: r, idempotencyKey: `${r}-${i}` },
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
        create: async (r) => {
          let t = await fetch(`${s}/hooks`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify(r),
          });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        execute: async (r, t) => {
          let o = await fetch(`${s}/hooks/${r}`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify(t),
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
var h = class extends Error {
  constructor(e = "Workflow suspended") {
    super(e), this.name = "WorkflowSuspension";
  }
};
var d = class {
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
    let s = e.map((a) => a()),
      r = await Promise.allSettled(s),
      t = null,
      o = null;
    for (let a of r) {
      a.status === "rejected" &&
        (a.reason instanceof h ? o || (o = a.reason) : t || (t = a.reason));
    }
    if (t) throw t;
    if (o) throw this.isSuspended = !0, o;
    return r.map((a) => a.value);
  }
  getSequentialId(e) {
    return `${e}-${this.callCounter++}`;
  }
  async sleep(e) {
    let s = this.getSequentialId("sleep");
    if (this.completedSteps.has(s)) {
      console.log(
        `[Workflow ${this.workflowName}] Sleep ${s} already completed, skipping`,
      );
      return;
    }
    if (!this.runId) {
      throw new Error("Cannot sleep outside of a workflow context.");
    }
    if (this.emittedEvents.has(s)) {
      throw console.log(
        `[Workflow ${this.workflowName}] Sleep ${s} already emitted, suspending`,
      ),
        this.isSuspended = !0,
        new h(`Sleeping for ${s}`);
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
      new h(`Sleeping for ${r}ms`);
  }
  async waitForSignal(e) {
    let s = this.getSequentialId(`signal-${e}`);
    if (this.history.has(s)) {
      let t = this.history.get(s);
      console.log(
        `[Workflow ${this.workflowName}] Signal ${s} replayed from history`,
      );
      let o = this.signalQueues.get(e);
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
        return console.log(
          `[Workflow ${this.workflowName}] Signal ${s} pulled from signal queue at cursor ${t}`,
        ),
          this.signalCursors.set(e, t + 1),
          this.history.set(s, o),
          o;
      }
    }
    throw this.runId
      ? this.emittedEvents.has(s)
        ? (console.log(
          `[Workflow ${this.workflowName}] Signal ${s} already waiting, suspending`,
        ),
          this.isSuspended = !0,
          new h(`Waiting for signal: ${e}`))
        : (await this.client.workflow.createEvent(this.runId, {
          eventType: "signal_waiting",
          correlationId: s,
          payload: { name: e },
        }),
          this.emittedEvents.add(s),
          this.isSuspended = !0,
          new h(`Waiting for signal: ${e}`))
      : new Error("Cannot wait for signal outside of a workflow context.");
  }
  async runRollback(e) {
    let s = {}, r = [...this.rollbackStack];
    for (; r.length > 0;) {
      let t = r.pop(), o = this.history.get(t);
      if (typeof o == "function") {
        try {
          let a = await o(e, s);
          s[t] = a;
        } catch (a) {
          if (a.name === "StopRollback") break;
          console.error(`Rollback function ${t} failed:`, a.message);
        }
      } else {
        let a = t;
        if (typeof this[a] == "function") {
          try {
            let i = await this[a](e, s);
            s[a] = i;
          } catch (i) {
            if (i.name === "StopRollback") break;
            console.error(`Rollback method ${a} failed:`, i.message);
          }
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
      this.callCounter = 0,
      this.isSuspended = !1;
    let s = new Map();
    for (let r of e) {
      let t = r.payload || {};
      switch (
        r.correlationId && this.emittedEvents.add(r.correlationId), r.eventType
      ) {
        case "step_completed":
          this.completedSteps.add(r.correlationId),
            this.history.set(r.correlationId, t.output);
          break;
        case "wait_completed":
          this.completedSteps.add(r.correlationId);
          break;
        case "signal_received":
          if (t.name) {
            let o = t.name;
            this.signalQueues.has(o) || this.signalQueues.set(o, []),
              this.signalQueues.get(o).push(t.data);
            let a = s.get(o) || 0, i = `signal-${o}-${a}`;
            this.history.set(i, t.data), s.set(o, a + 1);
          }
          break;
        case "rollback_registered":
          this.rollbackStack.push(t.method);
          break;
        case "step_retrying":
          this.stepAttempts.set(r.correlationId, t.attempt);
          break;
      }
    }
  }
  async executeStep(e, s, r, t = {}, o) {
    if (!this.runId) return s.apply(this, r);
    if (this.invokedSteps.has(e)) {
      throw new Error(
        `Duplicate step ID detected: "${e}". Each step within a workflow must have a unique ID.`,
      );
    }
    if (this.completedSteps.has(e)) {
      return console.log(
        `[Workflow ${this.workflowName}] Step ${e} already completed, replaying from history`,
      ),
        this.history.get(e);
    }
    if (t.rollback) {
      for (let n of t.rollback) {
        let l = `${e}-rb-${n}`;
        this.history.has(l) ||
          (await this.client.workflow.createEvent(this.runId, {
            eventType: "rollback_registered",
            correlationId: l,
            payload: { method: n },
          }),
            this.rollbackStack.push(n));
      }
    }
    if (t.rollbackFn) {
      let n = `${e}-rbfn`;
      this.history.has(n) ||
        (await this.client.workflow.createEvent(this.runId, {
          eventType: "rollback_registered",
          correlationId: n,
          payload: { isFunction: !0 },
        }),
          this.rollbackStack.push(n),
          this.history.set(n, t.rollbackFn));
    }
    let a = t.retries || 0, i = 0;
    for (
      this.stepAttempts.has(e) || this.stepAttempts.set(e, 0),
        i = this.stepAttempts.get(e);;
    ) {
      try {
        this.emittedEvents.has(e) ||
          (console.log(
            `[Workflow ${this.workflowName}] Step ${e} starting (Attempt ${i})`,
          ),
            await this.client.workflow.createEvent(this.runId, {
              eventType: "step_started",
              correlationId: e,
              payload: { attempt: i, name: o || e },
            }),
            this.emittedEvents.add(e));
        let n = await s.apply(this, r);
        return console.log(
          `[Workflow ${this.workflowName}] Step ${e} completed`,
        ),
          await this.client.workflow.createEvent(this.runId, {
            eventType: "step_completed",
            correlationId: e,
            payload: { output: n },
          }),
          this.completedSteps.add(e),
          this.history.set(e, n),
          n;
      } catch (n) {
        if (i < a) {
          i++,
            this.stepAttempts.set(e, i),
            await this.client.workflow.createEvent(this.runId, {
              eventType: "step_retrying",
              correlationId: e,
              payload: { error: n.message, attempt: i },
            }),
            await new Promise((l) => setTimeout(l, 1e3 * i));
          continue;
        }
        throw await this.client.workflow.createEvent(this.runId, {
          eventType: "step_failed",
          correlationId: e,
          payload: { error: n.message, attempt: i },
        }),
          n;
      }
    }
  }
};
function R(c, e = {}) {
  return function (s) {
    w.set(c, s), s.prototype.workflowName = c, s.prototype.workflowOptions = e;
    let r = s.prototype.run;
    r && (s.prototype.run = async function (...t) {
      let o = this;
      if (!o.client) throw new Error("Workflow needs a RocketBaseClient.");
      if (!o.runId) {
        let a = await o.client.workflow.trigger(c, t, e);
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
        if (a instanceof h) return;
        console.error(`[Workflow ${c}] Failed:`, a.message);
        try {
          await o.runRollback(a);
        } catch (i) {
          console.error(`[Workflow ${c}] Rollback failed:`, i.message);
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
function U(c, e = {}) {
  return function (s, r, t) {
    let o = t.value;
    t.value = async function (...a) {
      return this.executeStep(c, o, a, e);
    };
  };
}
var g = class {
  client;
  active;
  workflowNames;
  stopCallback;
  activeJobs;
  unsubscribers;
  constructor(e) {
    this.client = e,
      this.active = !1,
      this.workflowNames = new Set(),
      this.stopCallback = null,
      this.activeJobs = new Set(),
      this.unsubscribers = new Map();
  }
  start(e, s = {}) {
    this.active = !0;
    let r = Array.isArray(e) ? e : [e];
    for (let t of r) {
      this.workflowNames.add(t);
      let o = this.client.subscribeWorkflow(t, (a) => {
        if (!this.active) return;
        let i = this.processJob(a);
        this.activeJobs.add(i), i.finally(() => this.activeJobs.delete(i));
      });
      this.unsubscribers.set(t, o),
        s.resume &&
        this.resumePending(t).catch((a) =>
          console.error(`[Worker ${t}] Resume failed:`, a)
        );
    }
    return new Promise((t) => {
      this.stopCallback = t;
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
      t = [...s.items || s.data || [], ...r.items || r.data || []];
    console.log(`[Worker ${e}] Resuming ${t.length} runs`);
    for (let o of t) await this.client.workflow.resume(o.runId);
  }
  async stop() {
    this.active = !1;
    for (let e of this.unsubscribers.values()) e();
    this.unsubscribers.clear(),
      this.activeJobs.size > 0 &&
      (console.log(
        `[Worker] Waiting for ${this.activeJobs.size} jobs to complete...`,
      ),
        await Promise.allSettled(this.activeJobs)),
      this.stopCallback && (this.stopCallback(), this.stopCallback = null);
  }
  async processJob(e) {
    let s = e.data.workflowName || "unknown";
    console.log(`[Worker ${s}] Processing job ${e.id}`);
    let { runId: r, input: t } = e.data,
      o = setInterval(async () => {
        try {
          await this.client.workflow.touch(e.id);
        } catch {
          console.warn(`[Worker ${s}] Heartbeat failed for job ${e.id}`);
        }
      }, 15e3);
    if (e.data.workflowName && !this.workflowNames.has(e.data.workflowName)) {
      console.warn(
        `[Worker] Received job for ${e.data.workflowName}, but not registered to handle it. Ignoring.`,
      ),
        clearInterval(o),
        await this.client.workflow.nack(e.id);
      return;
    }
    try {
      let [a, i] = await Promise.all([
          this.client.workflow.getRun(r),
          this.client.workflow.listEvents(r),
        ]),
        n = w.get(s);
      if (!n) {
        console.error(
          `[Worker ${s}] Workflow class not found in registry. Registered:`,
          Array.from(w.keys()),
        ),
          clearInterval(o),
          await this.client.workflow.nack(e.id);
        return;
      }
      let l = new n(this.client);
      l.runId = r, l.rebuildState(i);
      let S = a.executionTimeout || 3e4,
        f,
        b = new Promise((E, $) => {
          f = setTimeout(
            () => $(new Error("CircuitBreaker: Execution timeout")),
            S,
          );
        });
      try {
        await Promise.race([l.run(...t || []), b]);
      } finally {
        f && clearTimeout(f);
      }
      clearInterval(o),
        await this.client.workflow.ack(e.id),
        l.isSuspended
          ? console.log(`[Worker ${s}] Job ${e.id} suspended`)
          : console.log(`[Worker ${s}] Job ${e.id} completed`);
    } catch (a) {
      if (clearInterval(o), a instanceof h) {
        await this.client.workflow.ack(e.id),
          console.log(`[Worker ${s}] Job ${e.id} suspended`);
        return;
      }
      let i = a instanceof Error ? a.message : String(a);
      if (
        console.error(`[Worker ${s}] Job ${e.id} failed:`, i),
          i === "CircuitBreaker: Execution timeout"
      ) {
        try {
          await this.client.workflow.updateRun(r, {
            status: "failed",
            error: { message: i },
          });
        } catch (n) {
          console.error(`[Worker ${s}] Failed to update run status:`, n);
        }
      }
      await this.client.workflow.ack(e.id);
    }
  }
};
var m = class extends Error {
  constructor(e = "Rollback stopped") {
    super(e), this.name = "StopRollback";
  }
};
var u,
  y = globalThis.AsyncLocalStorage ||
    (await import("node:async_hooks").catch(() => ({}))).AsyncLocalStorage;
if (y) {
  let c = new y();
  u = { run: (e, s) => c.run(e, s), getStore: () => c.getStore() };
} else {
  let c = null;
  u = {
    run: (e, s) => {
      let r = c;
      c = e;
      try {
        let t = s();
        return t instanceof Promise
          ? t.finally(() => {
            c = r;
          })
          : (c = r, t);
      } catch (t) {
        throw c = r, t;
      }
    },
    getStore: () => c,
  },
    typeof window < "u" &&
    console.warn(
      "[RocketBase] Using global context storage. Interleaved functional workflow execution might be non-deterministic in browser.",
    );
}
var p = u;
function B(c, e = {}) {
  return {
    run: (s) => {
      let r = class extends d {
        static workflowName = c;
        workflowName = c;
        workflowOptions = e;
        async run(...o) {
          let a = this;
          return await p.run(this, async () => {
            try {
              return await s.call(a, a, ...o);
            } catch (i) {
              throw i;
            }
          });
        }
      };
      w.set(c, r);
      let t = r.prototype.run;
      return r.prototype.run = async function (...o) {
        let a = this;
        if (!a.client) throw new Error("Workflow needs a RocketBaseClient.");
        if (!a.runId) {
          let i = await a.client.workflow.trigger(c, o, e);
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
          if (i instanceof h) return;
          console.error(`[Workflow ${c}] Failed:`, i.message);
          try {
            await a.runRollback(i);
          } catch (n) {
            console.error(`[Workflow ${c}] Rollback failed:`, n.message);
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
function K(c, e, s) {
  let r, t, o = {};
  return typeof c == "string"
    ? (r = c, t = e, o = s || {})
    : (t = c, r = "", o = e || {}),
    s && s.rollbackFn && (o.rollbackFn = s.rollbackFn),
    async function (...a) {
      let i = this instanceof d ? this : p.getStore();
      if (!i) return await t(...a);
      let n = r || i.getSequentialId("step");
      return i.executeStep(n, t.bind(i), a, o, t.name);
    };
}
export {
  B as workflow,
  d as WorkflowBase,
  g as WorkflowWorker,
  K as step,
  k as RocketBaseClient,
  m as StopRollback,
  R as Workflow,
  U as Step,
  w as WorkflowRegistry,
};
//# sourceMappingURL=exports.js.map
