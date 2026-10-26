/* MGH Energy Control — data layer for the Vercel version.
   Provides window.claude.use("db" | "user" | "downloads") with the same calls the pages use,
   backed by this project's /api routes (Postgres). Live updates are by polling every 8 seconds. */
(function () {
  var PIN_KEY = "mgh-app-pin", DEV_KEY = "mgh-device-id", POLL_MS = 8000;

  function getPin() { try { return localStorage.getItem(PIN_KEY) || ""; } catch (e) { return ""; } }
  function setPin(p) { try { localStorage.setItem(PIN_KEY, p); } catch (e) {} }
  var asking = null;
  function askPin() {
    if (!asking) asking = new Promise(function (resolve) {
      var p = window.prompt("Manhattan Grand Hotel · Energy Control\nEnter the staff PIN:");
      if (p) setPin(p.trim());
      asking = null; resolve(!!p);
    });
    return asking;
  }

  async function api(url, opt, retried) {
    opt = opt || {};
    var r;
    try {
      r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ "content-type": "application/json", "x-app-pin": getPin() }, opt.headers || {}) }));
    } catch (e) { throw { code: "unavailable", message: "No connection" }; }
    if (r.status === 401 && !retried) { if (await askPin()) return api(url, opt, true); }
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw { code: j.code || (r.status === 401 ? "not_granted" : "unavailable"), message: j.message || r.statusText };
    return j;
  }

  function snap(path, r) {
    var data = r && r.exists ? r.data : undefined;
    return { id: path.split("/").pop(), exists: !!(r && r.exists), data: function () { return data; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ---- live document subscriptions (polling) ---- */
  var subs = {};          // path -> { listeners:Set, last:string }
  var writing = {};       // path -> pending write count
  var timer = null;
  function deliver(path, r) {
    var s = subs[path]; if (!s) return;
    var key = JSON.stringify(r);
    if (key === s.last) return;
    s.last = key;
    s.listeners.forEach(function (l) { try { l.next(snap(path, r)); } catch (e) { console.error(e); } });
  }
  async function poll(only) {
    var paths = (only || Object.keys(subs)).filter(function (p) { return subs[p] && !writing[p]; });
    if (!paths.length) return;
    try {
      for (var i = 0; i < paths.length; i += 64) {
        var r = await api("/api/docs", { method: "POST", body: JSON.stringify({ paths: paths.slice(i, i + 64) }) });
        Object.keys(r.docs).forEach(function (p) { if (!writing[p]) deliver(p, r.docs[p]); });
      }
    } catch (e) { /* transient: try again next tick */ }
  }
  function ensureTimer() {
    if (!timer) timer = setInterval(function () { if (!document.hidden) poll(); }, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
  }

  async function write(path, method, body) {
    writing[path] = (writing[path] || 0) + 1;
    try {
      await api("/api/doc?path=" + encodeURIComponent(path), { method: method, body: body === undefined ? undefined : JSON.stringify(body) });
    } finally {
      writing[path]--; if (!writing[path]) delete writing[path];
    }
    if (subs[path]) poll([path]);
  }

  function docRef(path) {
    return {
      id: path.split("/").pop(), path: path,
      get: async function () { return snap(path, await api("/api/doc?path=" + encodeURIComponent(path))); },
      set: function (d) { return write(path, "PUT", d); },
      update: function (d) { return write(path, "PATCH", d); },
      delete: function () { return write(path, "DELETE"); },
      onSnapshot: function (next, error) {
        var s = subs[path] || (subs[path] = { listeners: new Set(), last: null });
        var l = { next: next, error: error }; s.listeners.add(l);
        if (s.last !== null) { try { next(snap(path, JSON.parse(s.last))); } catch (e) {} }
        ensureTimer(); poll([path]);
        return function () { s.listeners.delete(l); if (!s.listeners.size) delete subs[path]; };
      },
      collection: function (c) { return collRef(path + "/" + c); }
    };
  }
  function collRef(path, st) {
    st = st || { where: [], order: null, limit: null };
    async function get() {
      var qs = "collection=" + encodeURIComponent(path);
      if (st.where.length) qs += "&where=" + encodeURIComponent(JSON.stringify(st.where));
      if (st.order) qs += "&orderBy=" + encodeURIComponent(st.order[0]) + "&dir=" + st.order[1];
      if (st.limit) qs += "&limit=" + st.limit;
      var r = await api("/api/query?" + qs);
      var docs = r.docs.map(function (d) { return snap(path + "/" + d.id, { exists: true, data: d.data }); });
      return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: {} };
    }
    return {
      path: path,
      doc: function (id) { return docRef(path + "/" + (id || rid())); },
      add: async function (d) { var r = docRef(path + "/" + rid()); await r.set(d); return r; },
      where: function (f, op, v) { return collRef(path, { where: st.where.concat([[f, op, v]]), order: st.order, limit: st.limit }); },
      orderBy: function (f, dir) { return collRef(path, { where: st.where, order: [f, dir || "asc"], limit: st.limit }); },
      limit: function (n) { return collRef(path, { where: st.where, order: st.order, limit: n }); },
      get: get,
      onSnapshot: function (next, error) {
        var stop = false, last = null;
        async function tick() { if (stop) return; try { var s = await get(); var k = JSON.stringify(s.docs.map(function (d) { return [d.id, d.data()]; })); if (k !== last) { last = k; next(s); } } catch (e) {} if (!stop) setTimeout(tick, POLL_MS * 2); }
        tick(); return function () { stop = true; };
      }
    };
  }
  var DB = { doc: docRef, collection: collRef };

  /* ---- user: device id + role from the PIN ---- */
  var roleP = null;
  function whoami() { if (!roleP) roleP = api("/api/whoami").then(function (r) { return r.role; }, function () { roleP = null; return null; }); return roleP; }
  function deviceId() {
    try { var v = localStorage.getItem(DEV_KEY); if (!v) { v = "dev_" + rid(); localStorage.setItem(DEV_KEY, v); } return v; } catch (e) { return null; }
  }
  var USER = {
    id: async function () { return deviceId(); },
    isOwner: async function () { return (await whoami()) === "admin"; },
    canEdit: async function () { return (await whoami()) === "admin"; },
    can: async function () { return null; },
    name: async function () { return ""; },
    me: async function () { var r = await whoami(); return { id: deviceId(), name: "", avatarUrl: "", color: "#5d6a66", email: null, isOwner: r === "admin", canEdit: r === "admin" }; },
    profiles: async function (ids) { var o = {}; [].concat(ids || []).forEach(function (i) { o[i] = { id: i, name: "", avatarUrl: "", color: "#5d6a66", email: null, isMe: i === deviceId(), guest: false }; }); return o; },
    search: async function () { return []; }
  };

  /* ---- downloads: a normal browser download ---- */
  var DL = {
    save: async function (req) {
      var blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = req.filename || "download"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
      return { status: "saved" };
    }
  };

  window.claude = { use: async function (n) { if (n === "db") { await whoami(); return DB; } return n === "user" ? USER : n === "downloads" ? DL : null; } };
  window.MGH = { changePin: function () { var p = window.prompt("Enter the staff PIN:"); if (p) { setPin(p.trim()); roleP = null; location.reload(); } }, role: whoami };
})();
