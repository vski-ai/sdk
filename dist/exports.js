var h = new Map();
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
  workflowReadyResolve = null;
  workflowReadyPromise = null;
  confirmedWorkflowSubscriptions = new Set();
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
  subscribeWorkflow(e, o) {
    return this.workflowSubscriptions.has(e) ||
      (this.workflowSubscriptions.set(e, new Set()),
        this.confirmedWorkflowSubscriptions.delete(e),
        this.workflowReadyPromise ||
        (this.workflowReadyPromise = new Promise((r) => {
          this.workflowReadyResolve = r;
        }))),
      this.workflowSubscriptions.get(e).add(o),
      this.connectWorkflow(),
      this.workflowSocket?.readyState === 1 && this.sendSubscribeMessage(e),
      () => {
        let r = this.workflowSubscriptions.get(e);
        r &&
          (r.delete(o),
            r.size === 0 &&
            (this.workflowSubscriptions.delete(e),
              this.confirmedWorkflowSubscriptions.delete(e)));
      };
  }
  sendSubscribeMessage(e, o = 0) {
    if (!this.workflowSocket || this.workflowSocket.readyState !== 1) {
      o < 3
        ? setTimeout(() => this.sendSubscribeMessage(e, o + 1), 100)
        : console.error(
          `[Client] Failed to send SUBSCRIBE for ${e} after ${o} attempts`,
        );
      return;
    }
    try {
      this.workflowSocket.send(
        JSON.stringify({
          event: "SUBSCRIBE",
          data: { queue: `__wkf_workflow_${e}` },
        }),
      ), console.log(`[Client] Sent SUBSCRIBE message for workflow: ${e}`);
    } catch (r) {
      console.error(`[Client] Error sending SUBSCRIBE for ${e}:`, r),
        o < 3 &&
        setTimeout(() => this.sendSubscribeMessage(e, o + 1), 100 * (o + 1));
    }
  }
  async waitForWorkflowReady() {
    if (this.workflowSubscriptions.size === 0) {
      console.warn("[Client] No workflow subscriptions to wait for");
      return;
    }
    let e = setTimeout(() => {
      console.warn(
        `[Client] Workflow ready timeout - some subscriptions may not be confirmed. Subscribed: ${
          Array.from(this.workflowSubscriptions.keys()).join(", ")
        }, Confirmed: ${
          Array.from(this.confirmedWorkflowSubscriptions.keys()).join(", ")
        }`,
      ), this.workflowReadyResolve && this.workflowReadyResolve();
    }, 3e4);
    this.workflowReadyPromise && await this.workflowReadyPromise,
      clearTimeout(e);
  }
  resolveWorkflowReadyIfAllConfirmed() {
    this.workflowReadyResolve && this.workflowSubscriptions.size > 0 &&
      this.confirmedWorkflowSubscriptions.size ===
        this.workflowSubscriptions.size &&
      (console.log(
        `[Client] All ${this.confirmedWorkflowSubscriptions.size} workflow subscriptions confirmed`,
      ),
        this.workflowReadyResolve(),
        this.workflowReadyResolve = null,
        this.workflowReadyPromise = null);
  }
  connectWorkflow() {
    if (
      typeof WebSocket > "u" ||
      this.workflowSocket &&
        (this.workflowSocket.readyState === 0 ||
          this.workflowSocket.readyState === 1)
    ) return;
    let e = this.workflowSocket?.readyState === 1;
    console.log(
      "[Client] Connecting to workflow WebSocket...",
      e ? "(reconnecting)" : "",
    );
    let o = this.getToken() || this.apiKey,
      r = this.baseUrl.replace(/^http/, "ws") +
        `/api/workflow/ws?db=${this.dbName}` + (o ? `&auth=${o}` : "");
    this.workflowSocket = new WebSocket(r),
      this.workflowSocket.onopen = () => {
        console.log("[Client] Workflow WebSocket connected"),
          this.workflowSubscriptions.forEach((t, s) => {
            console.log(`[Client] Subscribing to workflow: ${s}`),
              this.workflowSocket?.send(
                JSON.stringify({
                  event: "SUBSCRIBE",
                  data: { queue: `__wkf_workflow_${s}` },
                }),
              );
          });
      },
      this.workflowSocket.onmessage = (t) => {
        try {
          let s = JSON.parse(t.data);
          if (s.event === "SUBSCRIBED") {
            let n = s.data?.workflowName;
            n &&
              (console.log(
                `[Client] Subscription confirmed for workflow: ${n}`,
              ),
                this.confirmedWorkflowSubscriptions.add(n),
                this.resolveWorkflowReadyIfAllConfirmed());
          } else if (s.event === "JOB") {
            let n = s.data?.data?.workflowName;
            if (!n) return;
            let i = this.workflowSubscriptions.get(n);
            if (i && i.size > 0) {
              let a = Array.from(i),
                c = a[Math.floor(Math.random() * a.length)];
              c(s.data);
            }
          }
        } catch (s) {
          console.error("Error handling workflow message:", s);
        }
      },
      this.workflowSocket.onerror = (t) => {
        console.error("[Client] Workflow WebSocket error:", t);
      },
      this.workflowSocket.onclose = (t) => {
        console.log(
          `[Client] Workflow WebSocket closed (code: ${t.code}). Reconnecting...`,
        ),
          this.confirmedWorkflowSubscriptions.clear(),
          e && this.workflowSubscriptions.size > 0 &&
          (console.log(
            "[Client] Polling for jobs that may have been missed during disconnect...",
          ),
            setTimeout(async () => {
              try {
                await this.pollForMissedJobs();
              } catch (s) {
                console.error(
                  "[Client] Error polling for missed jobs after reconnection:",
                  s,
                );
              }
            }, 1e3)),
          this.workflowSubscriptions.size > 0 &&
          setTimeout(() => this.connectWorkflow(), 3e3);
      };
  }
  async pollForMissedJobs() {
    let e = Array.from(this.workflowSubscriptions.keys());
    if (e.length !== 0) {
      console.log(
        `[Client] Polling for missed jobs in workflows: ${e.join(", ")}`,
      );
      for (let o of e) {
        try {
          let r = await this.workflow.listRuns({
              workflowName: o,
              status: "pending",
            }),
            t = await this.workflow.listRuns({
              workflowName: o,
              status: "running",
            }),
            s = [...r.items || [], ...t.items || []];
          if (s.length > 0) {
            console.log(
              `[Client] Found ${s.length} pending/running runs for workflow ${o}, resuming...`,
            );
            for (let n of s) {
              await this.workflow.resume(n.runId),
                console.log(`[Client] Resumed run ${n.runId}`);
            }
          }
        } catch (r) {
          console.error(`[Client] Error polling workflow ${o}:`, r);
        }
      }
    }
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
          let o = await fetch(`${e.baseUrl}/api/databases`, {
            headers: e.headers,
          });
          if (!o.ok) throw new Error(await o.text());
          return o.json();
        },
        create: async (o) => {
          let r = await fetch(`${e.baseUrl}/api/databases`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify(o),
          });
          if (!r.ok) throw new Error(await r.text());
          return r.json();
        },
        delete: async (o) => {
          let r = await fetch(`${e.baseUrl}/api/databases/${o}`, {
            method: "DELETE",
            headers: e.headers,
          });
          if (!r.ok) throw new Error(await r.text());
          return await r.text(), !0;
        },
      },
      collections: {
        create: async (o) => {
          let r = await fetch(`${e.baseUrl}/api/collections`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify(o),
          });
          if (!r.ok) throw new Error(await r.text());
          return r.json();
        },
        update: async (o, r) => {
          let t = await fetch(`${e.baseUrl}/api/collections/${o}`, {
            method: "PATCH",
            headers: e.headers,
            body: JSON.stringify(r),
          });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        delete: async (o) => {
          let r = await fetch(`${e.baseUrl}/api/collections/${o}`, {
            method: "DELETE",
            headers: e.headers,
          });
          if (!r.ok) throw new Error(await r.text());
          return await r.text(), !0;
        },
        getList: async () => {
          let o = await fetch(`${e.baseUrl}/api/collections`, {
            headers: e.headers,
          });
          if (!o.ok) throw new Error(await o.text());
          return o.json();
        },
      },
    };
  }
  get auth() {
    let e = this;
    return {
      login: async (o, r) => {
        let t = await fetch(`${e.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ identity: o, password: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        let s = await t.json();
        return e.setToken(s.token), s;
      },
      register: async (o) => {
        let r = await fetch(`${e.baseUrl}/api/auth/register`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify(o),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      me: async () => {
        let o = await fetch(`${e.baseUrl}/api/auth/me`, { headers: e.headers });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      listMethods: async () => {
        let o = await fetch(`${e.baseUrl}/api/auth/methods`, {
          headers: e.headers,
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      authViaOAuth2: async (o, r, t) => {
        let s = await fetch(`${e.baseUrl}/api/auth/oauth2-login`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ provider: o, code: r, redirectUrl: t }),
        });
        if (!s.ok) throw new Error(await s.text());
        let n = await s.json();
        return e.setToken(n.token), n;
      },
    };
  }
  get keys() {
    let e = this;
    return {
      generate: async (o) => {
        let r = await fetch(`${e.baseUrl}/api/keys`, {
          method: "POST",
          headers: e.adminHeaders,
          body: JSON.stringify(o),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
    };
  }
  get admins() {
    let e = this;
    return {
      authWithPassword: async (o, r) => {
        let t = await fetch(`${e.baseUrl}/api/admins/auth-with-password`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ identity: o, password: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        let s = await t.json();
        return e.setToken(s.token), s;
      },
      init: async (o) => {
        let r = await fetch(`${e.baseUrl}/api/admins/init`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify(o),
        });
        if (!r.ok) throw new Error(await r.text());
        let t = await r.json();
        return e.setToken(t.token), t;
      },
      hasAdmins: async () => {
        let o = await fetch(`${e.baseUrl}/api/admins/has-admins`, {
          headers: e.headers,
        });
        return o.ok ? o.json() : (await o.text(), { hasAdmins: !1 });
      },
      me: async () => {
        let o = await fetch(`${e.baseUrl}/api/admins/me`, {
          headers: e.adminHeaders,
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
    };
  }
  get cron() {
    let e = this;
    return {
      list: async () => {
        let o = await fetch(`${e.baseUrl}/api/cron`, { headers: e.headers });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
      create: async (o) => {
        let r = await fetch(`${e.baseUrl}/api/cron`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify(o),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      },
      delete: async (o) => {
        let r = await fetch(`${e.baseUrl}/api/cron/${o}`, {
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
      list: async (o = {}) => {
        let r = new URLSearchParams();
        Object.entries(o).forEach(([s, n]) => {
          n !== void 0 && n !== "" && r.append(s, n.toString());
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
        let o = await fetch(`${e.baseUrl}/api/workflows/stats`, {
          headers: e.headers,
        });
        if (!o.ok) throw new Error(await o.text());
        return o.json();
      },
    };
  }
  collection(e) {
    let o = this;
    return {
      getList: async (r = 1, t = 30, s = {}) => {
        let n = new URLSearchParams({ page: String(r), perPage: String(t) });
        s.filter && n.append("filter", s.filter),
          s.expand && n.append("expand", s.expand),
          s.sort && n.append("sort", s.sort);
        let i = await fetch(
          `${o.baseUrl}/api/collections/${e}/records?${n.toString()}`,
          { headers: o.headers },
        );
        if (!i.ok) throw new Error(await i.text());
        return i.json();
      },
      getOne: async (r, t = {}) => {
        let s = new URLSearchParams();
        t.expand && s.append("expand", t.expand);
        let n = await fetch(
          `${o.baseUrl}/api/collections/${e}/records/${r}?${s.toString()}`,
          { headers: o.headers },
        );
        if (!n.ok) throw new Error(await n.text());
        return n.json();
      },
      search: async (r, t = {}) => {
        let s = new URLSearchParams({ q: r });
        t.page && s.append("page", String(t.page)),
          t.perPage && s.append("perPage", String(t.perPage)),
          t.expand && s.append("expand", t.expand),
          t.snippet && s.append("snippet", "true");
        let n = await fetch(
          `${o.baseUrl}/api/collections/${e}/records/search?${s.toString()}`,
          { headers: o.headers },
        );
        if (!n.ok) throw new Error(await n.text());
        return n.json();
      },
      getView: async (r, t = {}) => {
        let s = new URLSearchParams();
        t.page && s.append("page", String(t.page)),
          t.perPage && s.append("perPage", String(t.perPage)),
          t.expand && s.append("expand", t.expand),
          t.filter && s.append("filter", t.filter),
          t.sort && s.append("sort", t.sort);
        let n = await fetch(
          `${o.baseUrl}/api/collections/${e}/records/views/${r}?${s.toString()}`,
          { headers: o.headers },
        );
        if (!n.ok) throw new Error(await n.text());
        return n.json();
      },
      create: async (r) => {
        let t = r instanceof FormData, s = { ...o.headers };
        t && delete s["Content-Type"];
        let n = await fetch(`${o.baseUrl}/api/collections/${e}/records`, {
          method: "POST",
          headers: s,
          body: t ? r : JSON.stringify(r),
        });
        if (!n.ok) throw new Error(await n.text());
        return n.json();
      },
      update: async (r, t) => {
        let s = t instanceof FormData, n = { ...o.headers };
        s && delete n["Content-Type"];
        let i = await fetch(`${o.baseUrl}/api/collections/${e}/records/${r}`, {
          method: "PATCH",
          headers: n,
          body: s ? t : JSON.stringify(t),
        });
        if (!i.ok) throw new Error(await i.text());
        return i.json();
      },
      bulkUpdate: async (r, t) => {
        let s = await fetch(`${o.baseUrl}/api/collections/${e}/records/bulk`, {
          method: "PATCH",
          headers: o.headers,
          body: JSON.stringify({ ids: r, data: t }),
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      delete: async (r) => {
        let t = await fetch(`${o.baseUrl}/api/collections/${e}/records/${r}`, {
          method: "DELETE",
          headers: o.headers,
        });
        if (!t.ok) throw new Error(await t.text());
        return await t.text(), !0;
      },
      bulkDelete: async (r) => {
        let t = await fetch(`${o.baseUrl}/api/collections/${e}/records/bulk`, {
          method: "DELETE",
          headers: o.headers,
          body: JSON.stringify({ ids: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      authWithPassword: async (r, t) => {
        if (e === "_superusers") return o.admins.authWithPassword(r, t);
        let s = await fetch(
          `${o.baseUrl}/api/collections/${e}/auth-with-password`,
          {
            method: "POST",
            headers: o.headers,
            body: JSON.stringify({ identity: r, password: t }),
          },
        );
        if (!s.ok) throw new Error(await s.text());
        let n = await s.json();
        return o.setToken(n.token), n;
      },
      subscribe: (
        r,
        t,
      ) => (o.subscriptions.set(e, { callback: r, options: t }),
        o.connectRealtime(),
        o.realtimeSocket?.readyState === 1 &&
        o.realtimeSocket.send(
          JSON.stringify({ type: "SUBSCRIBE", collection: e, ...t }),
        ),
        () => {
          o.subscriptions.delete(e);
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
        this.subscriptions.forEach((o, r) => {
          this.realtimeSocket?.send(
            JSON.stringify({ type: "SUBSCRIBE", collection: r, ...o.options }),
          );
        });
      },
      this.realtimeSocket.onmessage = (o) => {
        let r = JSON.parse(o.data), t = this.subscriptions.get(r.collection);
        !t || !r.events || r.events.forEach((s) => {
          try {
            t.callback(s.data),
              t.options?.group || (t.options = { ...t.options, lastId: s.id }),
              s.ackId && t.options?.group &&
              this.realtimeSocket?.send(
                JSON.stringify({
                  type: "ACK",
                  collection: r.collection,
                  id: s.ackId,
                  group: t.options.group,
                }),
              );
          } catch (n) {
            console.error("Error handling realtime event:", n);
          }
        });
      },
      this.realtimeSocket.onclose = () => {
        this.subscriptions.size > 0 &&
          setTimeout(() => this.connectRealtime(), 3e3);
      };
  }
  get migrations() {
    let e = this, o = "_migrations";
    return {
      getList: async (r = 1, t = 500, s = {}) => {
        let n = new URLSearchParams({ page: String(r), perPage: String(t) });
        s.filter && n.append("filter", s.filter),
          s.sort && n.append("sort", s.sort);
        let i = await fetch(
          `${e.baseUrl}/api/collections/${o}/records?${n.toString()}`,
          { headers: e.adminHeaders },
        );
        if (!i.ok) throw new Error(await i.text());
        return i.json();
      },
      create: async (r) => {
        let t = await fetch(`${e.baseUrl}/api/collections/${o}/records`, {
          method: "POST",
          headers: e.adminHeaders,
          body: JSON.stringify(r),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      delete: async (r) => {
        let t = await fetch(`${e.baseUrl}/api/collections/${o}/records/${r}`, {
          method: "DELETE",
          headers: e.adminHeaders,
        });
        if (!t.ok) throw new Error(await t.text());
        return await t.text(), !0;
      },
      run: async (r) => {
        let t = await e.migrations.getList(1, 500),
          s = new Set(t.items.map((n) => n.name));
        for (let n of r) {
          s.has(n.name) ||
            (console.log(`[Migrations] Applying: ${n.name}`),
              await n.up(e),
              await e.migrations.create({
                name: n.name,
                appliedAt: new Date().toISOString(),
                batch: 1,
              }));
        }
      },
    };
  }
  get workflow() {
    let e = this, o = `${e.baseUrl}/api/workflows`;
    return {
      createRun: async (r) => {
        let t = await fetch(`${o}/runs`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify(r),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      trigger: async (r, t, s = {}) => {
        let a = { ...h.get(r)?.prototype?.workflowOptions || {}, ...s },
          c = await e.workflow.createRun({
            deploymentId: a.deploymentId || "sdk",
            workflowName: r,
            input: t,
            ...a,
          });
        return await e.workflow.queueMessage(`__wkf_workflow_${r}`, {
          type: "workflow_start",
          runId: c.runId,
          workflowName: r,
          input: t,
        }, { runId: c.runId, idempotencyKey: c.runId }),
          c;
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
        let t = await fetch(`${o}/runs/${r}`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      updateRun: async (r, t) => {
        let s = await fetch(`${o}/runs/${r}`, {
          method: "PATCH",
          headers: e.headers,
          body: JSON.stringify(t),
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      cancelRun: async (r, t) => {
        let s = await fetch(`${o}/runs/${r}`, {
          method: "DELETE",
          headers: e.headers,
          body: JSON.stringify({ reason: t }),
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      listRuns: async (r = {}) => {
        let t = new URLSearchParams();
        r.workflowName && t.append("workflowName", r.workflowName),
          r.status && t.append("status", r.status),
          r.limit && t.append("limit", String(r.limit)),
          r.cursor && t.append("cursor", r.cursor);
        let s = await fetch(`${o}/runs?${t.toString()}`, {
          headers: e.headers,
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      createStep: async (r, t) => {
        let s = await fetch(`${o}/steps`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ runId: r, ...t }),
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      updateStep: async (r, t, s) => {
        let n = await fetch(`${o}/steps/${r}/${t}`, {
          method: "PATCH",
          headers: e.headers,
          body: JSON.stringify(s),
        });
        if (!n.ok) throw new Error(await n.text());
        return n.json();
      },
      createEvent: async (r, t) => {
        let s = await fetch(`${o}/events`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ runId: r, ...t }),
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      listEvents: async (r) => {
        let t = await fetch(`${o}/runs/${r}/events`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      pollQueue: async (r) => {
        let t = await fetch(`${o}/queue/${r}`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        let s = await t.text();
        return s ? JSON.parse(s) : null;
      },
      sendSignal: async (r, t, s, n) => {
        let i = n || `signal-${t}-${crypto.randomUUID()}`;
        await e.workflow.createEvent(r, {
          eventType: "signal_received",
          correlationId: i,
          payload: { name: t, data: s },
        });
        let a = await e.workflow.getRun(r);
        return await e.workflow.queueMessage(
          `__wkf_workflow_${a.workflowName}`,
          {
            type: "signal",
            runId: r,
            workflowName: a.workflowName,
            input: a.input,
          },
          { runId: r, idempotencyKey: `${r}-${i}` },
        ),
          !0;
      },
      queueMessage: async (r, t, s) => {
        let n = await fetch(`${o}/queue`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ queueName: r, message: t, opts: s }),
        });
        if (!n.ok) throw new Error(await n.text());
        return n.json();
      },
      ack: async (r) => {
        let t = await fetch(`${o}/queue/ack`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ messageId: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      nack: async (r) => {
        let t = await fetch(`${o}/queue/nack`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ messageId: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      getJob: async (r) => {
        let t = await fetch(`${o}/queue/${r}`, { headers: e.headers });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      getProcessingJobs: async (r) => {
        let t = new URLSearchParams();
        t.append("runId", r), t.append("status", "processing");
        let s = await fetch(`${o}/queue/jobs?${t.toString()}`, {
          headers: e.headers,
        });
        if (!s.ok) throw new Error(await s.text());
        return s.json();
      },
      touch: async (r) => {
        e.workflowSocket?.readyState === 1 &&
          e.workflowSocket.send(
            JSON.stringify({ event: "TOUCH", data: { messageId: r } }),
          );
        let t = await fetch(`${o}/queue/touch`, {
          method: "POST",
          headers: e.headers,
          body: JSON.stringify({ messageId: r }),
        });
        if (!t.ok) throw new Error(await t.text());
        return t.json();
      },
      hooks: {
        create: async (r) => {
          let t = await fetch(`${o}/hooks`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify(r),
          });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        execute: async (r, t) => {
          let s = await fetch(`${o}/hooks/${r}`, {
            method: "POST",
            headers: e.headers,
            body: JSON.stringify(t),
          });
          if (!s.ok) throw new Error(await s.text());
          return s.json();
        },
        get: async (r) => {
          let t = await fetch(`${o}/hooks/${r}`, { headers: e.headers });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        getByToken: async (r) => {
          let t = await fetch(`${o}/hooks?token=${r}`, { headers: e.headers });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        list: async (r) => {
          let t = await fetch(`${o}/hooks?runId=${r}`, { headers: e.headers });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
        dispose: async (r) => {
          let t = await fetch(`${o}/hooks/${r}`, {
            method: "DELETE",
            headers: e.headers,
          });
          if (!t.ok) throw new Error(await t.text());
          return t.json();
        },
      },
    };
  }
  async gate(e, o, r) {
    let t = {
      method: "POST",
      ...r,
      headers: { ...this.headers, ...r?.headers || {} },
    };
    return o && (t.body = JSON.stringify(o)),
      await fetch(`${this.baseUrl}/api/gates/${e}`, t);
  }
};
var w = class extends Error {
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
    let o = e.map((n) => n()),
      r = await Promise.allSettled(o),
      t = null,
      s = null;
    for (let n of r) {
      n.status === "rejected" &&
        (n.reason instanceof w ? s || (s = n.reason) : t || (t = n.reason));
    }
    if (t) throw t;
    if (s) throw this.isSuspended = !0, s;
    return r.map((n) => n.value);
  }
  getSequentialId(e) {
    return `${e}-${this.callCounter++}`;
  }
  async sleep(e) {
    let o = this.getSequentialId("sleep");
    if (this.completedSteps.has(o)) {
      console.log(
        `[Workflow ${this.workflowName}] Sleep ${o} already completed, skipping`,
      );
      return;
    }
    if (!this.runId) {
      throw new Error("Cannot sleep outside of a workflow context.");
    }
    if (this.emittedEvents.has(o)) {
      throw console.log(
        `[Workflow ${this.workflowName}] Sleep ${o} already emitted, suspending`,
      ),
        this.isSuspended = !0,
        new w(`Sleeping for ${o}`);
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
      correlationId: o,
      payload: { duration: r, resumeAt: t.toISOString() },
    }),
      this.emittedEvents.add(o),
      this.isSuspended = !0,
      new w(`Sleeping for ${r}ms`);
  }
  async waitForSignal(e) {
    let o = this.getSequentialId(`signal-${e}`);
    if (this.history.has(o)) {
      let t = this.history.get(o);
      console.log(
        `[Workflow ${this.workflowName}] Signal ${o} replayed from history`,
      );
      let s = this.signalQueues.get(e);
      if (s) {
        let n = this.signalCursors.get(e) || 0;
        n < s.length && s[n] === t && this.signalCursors.set(e, n + 1);
      }
      return t;
    }
    let r = this.signalQueues.get(e);
    if (r) {
      let t = this.signalCursors.get(e) || 0;
      if (t < r.length) {
        let s = r[t];
        return console.log(
          `[Workflow ${this.workflowName}] Signal ${o} pulled from signal queue at cursor ${t}`,
        ),
          this.signalCursors.set(e, t + 1),
          this.history.set(o, s),
          s;
      }
    }
    throw this.runId
      ? this.emittedEvents.has(o)
        ? (console.log(
          `[Workflow ${this.workflowName}] Signal ${o} already waiting, suspending`,
        ),
          this.isSuspended = !0,
          new w(`Waiting for signal: ${e}`))
        : (await this.client.workflow.createEvent(this.runId, {
          eventType: "signal_waiting",
          correlationId: o,
          payload: { name: e },
        }),
          this.emittedEvents.add(o),
          this.isSuspended = !0,
          new w(`Waiting for signal: ${e}`))
      : new Error("Cannot wait for signal outside of a workflow context.");
  }
  async runRollback(e) {
    let o = {}, r = [...this.rollbackStack];
    for (; r.length > 0;) {
      let t = r.pop(), s = this.history.get(t);
      if (typeof s == "function") {
        try {
          let n = await s(e, o);
          o[t] = n;
        } catch (n) {
          if (n.name === "StopRollback") break;
          console.error(`Rollback function ${t} failed:`, n.message);
        }
      } else {
        let n = t;
        if (typeof this[n] == "function") {
          try {
            let i = await this[n](e, o);
            o[n] = i;
          } catch (i) {
            if (i.name === "StopRollback") break;
            console.error(`Rollback method ${n} failed:`, i.message);
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
    let o = new Map();
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
            let s = t.name;
            this.signalQueues.has(s) || this.signalQueues.set(s, []),
              this.signalQueues.get(s).push(t.data);
            let n = o.get(s) || 0, i = `signal-${s}-${n}`;
            this.history.set(i, t.data), o.set(s, n + 1);
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
  async executeStep(e, o, r, t = {}, s) {
    if (!this.runId) return o.apply(this, r);
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
      for (let a of t.rollback) {
        let c = `${e}-rb-${a}`;
        this.history.has(c) ||
          (await this.client.workflow.createEvent(this.runId, {
            eventType: "rollback_registered",
            correlationId: c,
            payload: { method: a },
          }),
            this.rollbackStack.push(a));
      }
    }
    if (t.rollbackFn) {
      let a = `${e}-rbfn`;
      this.history.has(a) ||
        (await this.client.workflow.createEvent(this.runId, {
          eventType: "rollback_registered",
          correlationId: a,
          payload: { isFunction: !0 },
        }),
          this.rollbackStack.push(a),
          this.history.set(a, t.rollbackFn));
    }
    let n = t.retries || 0, i = 0;
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
              payload: { attempt: i, name: s || e },
            }),
            this.emittedEvents.add(e));
        let a = await o.apply(this, r);
        return console.log(
          `[Workflow ${this.workflowName}] Step ${e} completed`,
        ),
          await this.client.workflow.createEvent(this.runId, {
            eventType: "step_completed",
            correlationId: e,
            payload: { output: a },
          }),
          this.completedSteps.add(e),
          this.history.set(e, a),
          a;
      } catch (a) {
        if (i < n) {
          i++,
            this.stepAttempts.set(e, i),
            await this.client.workflow.createEvent(this.runId, {
              eventType: "step_retrying",
              correlationId: e,
              payload: { error: a.message, attempt: i },
            }),
            await new Promise((c) => setTimeout(c, 1e3 * i));
          continue;
        }
        throw await this.client.workflow.createEvent(this.runId, {
          eventType: "step_failed",
          correlationId: e,
          payload: { error: a.message, attempt: i },
        }),
          a;
      }
    }
  }
};
function T(l, e = {}) {
  return function (o) {
    h.set(l, o), o.prototype.workflowName = l, o.prototype.workflowOptions = e;
    let r = o.prototype.run;
    r && (o.prototype.run = async function (...t) {
      let s = this;
      if (!s.client) throw new Error("Workflow needs a RocketBaseClient.");
      if (!s.runId) {
        let n = await s.client.workflow.trigger(l, t, e);
        s.runId = n.runId;
      }
      await s.client.workflow.updateRun(s.runId, { status: "running" });
      try {
        let n = await r.apply(s, t);
        return s.isSuspended ||
          await s.client.workflow.updateRun(s.runId, {
            status: "completed",
            output: n,
          }),
          n;
      } catch (n) {
        if (n instanceof w) return;
        console.error(`[Workflow ${l}] Failed:`, n.message);
        try {
          await s.runRollback(n);
        } catch (i) {
          console.error(`[Workflow ${l}] Rollback failed:`, i.message);
        }
        throw await s.client.workflow.updateRun(s.runId, {
          status: "failed",
          error: { message: n.message, stack: n.stack },
        }),
          n;
      }
    });
  };
}
function N(l, e = {}) {
  return function (o, r, t) {
    let s = t.value;
    t.value = async function (...n) {
      return this.executeStep(l, s, n, e);
    };
  };
}
var g = class {
  client;
  active;
  ready;
  workflowNames;
  stopCallback;
  activeJobs;
  unsubscribers;
  pendingSubscriptions;
  confirmedSubscriptions;
  constructor(e) {
    this.client = e,
      this.active = !1,
      this.ready = !1,
      this.workflowNames = new Set(),
      this.stopCallback = null,
      this.activeJobs = new Set(),
      this.unsubscribers = new Map(),
      this.pendingSubscriptions = new Map(),
      this.confirmedSubscriptions = new Set();
  }
  start(e, o = {}) {
    this.active = !0, this.ready = !1;
    let r = Array.isArray(e) ? e : [e];
    console.log(`[Worker] Starting worker for workflows: ${r.join(", ")}`);
    for (let t of r) {
      this.workflowNames.add(t);
      let s = this.client.subscribeWorkflow(t, (n) => {
        if (!this.active) {
          console.log(`[Worker] Worker is not active, ignoring job ${n.id}`);
          return;
        }
        if (!this.ready) {
          console.log(`[Worker] Worker is not ready yet, ignoring job ${n.id}`);
          return;
        }
        let i = this.processJob(n);
        this.activeJobs.add(i), i.finally(() => this.activeJobs.delete(i));
      });
      this.unsubscribers.set(t, s);
    }
    return this.client.waitForWorkflowReady().then(() => {
      console.log(
        `[Worker] Worker is now ready and accepting jobs for workflows: ${
          Array.from(this.workflowNames).join(", ")
        }`,
      ), this.ready = !0;
    }).catch((t) => {
      console.error("[Worker] Failed to reach ready state:", t);
    }),
      this.pollJobsOnStartup(Array.from(this.workflowNames)).catch((t) => {
        console.error("[Worker] Startup polling failed:", t);
      }),
      new Promise((t) => {
        this.stopCallback = t;
      });
  }
  async resumePending(e) {
    console.log(`[Worker ${e}] Polling for pending and running runs...`);
    try {
      let o = await this.client.workflow.listRuns({
          workflowName: e,
          status: "pending",
        }),
        r = await this.client.workflow.listRuns({
          workflowName: e,
          status: "running",
        }),
        t = [...o.items || o.data || [], ...r.items || r.data || []];
      console.log(`[Worker ${e}] Found ${t.length} runs to resume`);
      let s = 0;
      for (let n of t) {
        try {
          await this.client.workflow.resume(n.runId),
            s++,
            console.log(
              `[Worker ${e}] Resumed run ${n.runId} (status: ${n.status})`,
            );
        } catch (i) {
          console.error(
            `[Worker ${e}] Failed to resume run ${n.runId}:`,
            i instanceof Error ? i.message : String(i),
          );
        }
      }
      console.log(`[Worker ${e}] Successfully resumed ${s}/${t.length} runs`);
    } catch (o) {
      throw console.error(
        `[Worker ${e}] Error polling for pending runs:`,
        o instanceof Error ? o.message : String(o),
      ),
        o;
    }
  }
  async pollJobsOnStartup(e) {
    console.log(
      `[Worker] Polling for jobs on startup for workflows: ${e.join(", ")}`,
    );
    for (let o of e) {
      try {
        await this.resumePending(o);
      } catch (r) {
        console.error(`[Worker] Startup polling failed for workflow ${o}:`, r);
      }
    }
    console.log("[Worker] Startup polling completed");
  }
  async stop() {
    console.log("[Worker] Stopping worker..."),
      this.active = !1,
      this.ready = !1;
    for (let e of this.unsubscribers.values()) e();
    this.unsubscribers.clear(),
      this.confirmedSubscriptions.clear(),
      this.pendingSubscriptions.clear(),
      this.activeJobs.size > 0 &&
      (console.log(
        `[Worker] Waiting for ${this.activeJobs.size} jobs to complete...`,
      ),
        await Promise.allSettled(this.activeJobs)),
      console.log("[Worker] Worker stopped"),
      this.stopCallback && (this.stopCallback(), this.stopCallback = null);
  }
  async processJob(e) {
    let o = e.data.workflowName || "unknown";
    console.log(`[Worker ${o}] Processing job ${e.id}`);
    let { runId: r, input: t } = e.data,
      s = setInterval(async () => {
        try {
          await this.client.workflow.touch(e.id);
        } catch {
          console.warn(`[Worker ${o}] Heartbeat failed for job ${e.id}`);
        }
      }, 5e3);
    if (e.data.workflowName && !this.workflowNames.has(e.data.workflowName)) {
      console.warn(
        `[Worker] Received job for ${e.data.workflowName}, but not registered to handle it. Ignoring.`,
      ),
        clearInterval(s),
        await this.client.workflow.nack(e.id);
      return;
    }
    try {
      let [n, i] = await Promise.all([
          this.client.workflow.getRun(r),
          this.client.workflow.listEvents(r),
        ]),
        a = h.get(o);
      if (!a) {
        console.error(
          `[Worker ${o}] Workflow class not found in registry. Registered:`,
          Array.from(h.keys()),
        ),
          clearInterval(s),
          await this.client.workflow.nack(e.id);
        return;
      }
      let c = new a(this.client);
      c.runId = r, c.rebuildState(i);
      let S = n.executionTimeout || 31536e6,
        d,
        b = new Promise((E, $) => {
          d = setTimeout(
            () => $(new Error("CircuitBreaker: Execution timeout")),
            S,
          );
        });
      try {
        await Promise.race([c.run(...t || []), b]);
      } finally {
        d && clearTimeout(d);
      }
      c.isSuspended ||
      (console.log(`[Worker ${o}] Job ${e.id} completed, updating run status`),
        await this.client.workflow.updateRun(r, { status: "completed" })),
        clearInterval(s),
        await this.client.workflow.ack(e.id),
        c.isSuspended
          ? console.log(`[Worker ${o}] Job ${e.id} suspended`)
          : console.log(`[Worker ${o}] Job ${e.id} completed`);
    } catch (n) {
      if (clearInterval(s), n instanceof w) {
        await this.client.workflow.ack(e.id),
          console.log(`[Worker ${o}] Job ${e.id} suspended`);
        return;
      }
      let i = n instanceof Error ? n.message : String(n);
      if (
        console.error(`[Worker ${o}] Job ${e.id} failed:`, i),
          i === "CircuitBreaker: Execution timeout"
      ) {
        try {
          await this.client.workflow.updateRun(r, {
            status: "failed",
            error: { message: i },
          });
        } catch (a) {
          console.error(`[Worker ${o}] Failed to update run status`, a);
        }
      }
      await this.client.workflow.ack(e.id);
    }
  }
};
var y = class extends Error {
  constructor(e = "Rollback stopped") {
    super(e), this.name = "StopRollback";
  }
};
var u,
  m = globalThis.AsyncLocalStorage ||
    (await import("node:async_hooks").catch(() => ({}))).AsyncLocalStorage;
if (m) {
  let l = new m();
  u = { run: (e, o) => l.run(e, o), getStore: () => l.getStore() };
} else {
  let l = null;
  u = {
    run: (e, o) => {
      let r = l;
      l = e;
      try {
        let t = o();
        return t instanceof Promise
          ? t.finally(() => {
            l = r;
          })
          : (l = r, t);
      } catch (t) {
        throw l = r, t;
      }
    },
    getStore: () => l,
  },
    typeof window < "u" &&
    console.warn(
      "[RocketBase] Using global context storage. Interleaved functional workflow execution might be non-deterministic in browser.",
    );
}
var p = u;
function q(l, e = {}) {
  return {
    run: (o) => {
      let r = class extends f {
        static workflowName = l;
        workflowName = l;
        workflowOptions = e;
        async run(...s) {
          let n = this;
          return await p.run(this, async () => {
            try {
              return await o.call(n, n, ...s);
            } catch (i) {
              throw i;
            }
          });
        }
      };
      r.prototype.workflowOptions = e, h.set(l, r);
      let t = r.prototype.run;
      return r.prototype.run = async function (...s) {
        let n = this;
        if (!n.client) throw new Error("Workflow needs a RocketBaseClient.");
        if (!n.runId) {
          let i = await n.client.workflow.trigger(l, s, e);
          n.runId = i.runId;
        }
        await n.client.workflow.updateRun(n.runId, { status: "running" });
        try {
          let i = await t.apply(n, s);
          return n.isSuspended ||
            await n.client.workflow.updateRun(n.runId, {
              status: "completed",
              output: i,
            }),
            i;
        } catch (i) {
          if (i instanceof w) return;
          console.error(`[Workflow ${l}] Failed:`, i.message);
          try {
            await n.runRollback(i);
          } catch (a) {
            console.error(`[Workflow ${l}] Rollback failed:`, a.message);
          }
          throw await n.client.workflow.updateRun(n.runId, {
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
function K(l, e, o) {
  let r, t, s = {};
  return typeof l == "string"
    ? (r = l, t = e, s = o || {})
    : (t = l, r = "", s = e || {}),
    o && o.rollbackFn && (s.rollbackFn = o.rollbackFn),
    async function (...n) {
      let i = this instanceof f ? this : p.getStore();
      if (!i) return await t(...n);
      let a = r || i.getSequentialId("step");
      return i.executeStep(a, t.bind(i), n, s, t.name);
    };
}
export {
  f as WorkflowBase,
  g as WorkflowWorker,
  h as WorkflowRegistry,
  K as step,
  k as RocketBaseClient,
  N as Step,
  q as workflow,
  T as Workflow,
  w as WorkflowSuspension,
  y as StopRollback,
};
//# sourceMappingURL=exports.js.map
