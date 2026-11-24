#!/usr/bin/env node
// media-probe.mjs — runtime instrumentation for the "play from lock screen" bug.
// No product code changes: everything is injected into the live page via CDP.
//
// Usage:
//   node media-probe.mjs <port> install [urlSubstring]   # inject probes (once per page load)
//   node media-probe.mjs <port> dump [urlSubstring]      # print collected events + current state
//   node media-probe.mjs <port> state [urlSubstring]     # print only current media state
//   node media-probe.mjs <port> reset [urlSubstring]     # clear collected events
//   node media-probe.mjs <port> eval "<js>" [urlSubstring]
//
// Port is the local port forwarded to Chrome DevTools:
//   adb forward tcp:9222 localabstract:chrome_devtools_remote

const [port, cmd, ...rest] = process.argv.slice(2);
if (!port || !cmd) {
  console.error("usage: node media-probe.mjs <port> <install|dump|state|reset|eval> [arg] [urlSubstring]");
  process.exit(2);
}

const isEval = cmd === "eval";
const arg = isEval ? rest[0] : undefined;
const filter = (isEval ? rest[1] : rest[0]) ?? "";

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
const target =
  pages.find((t) => filter && t.url.includes(filter)) ??
  pages.find((t) => t.url.includes("/home") || t.url.includes("/login")) ??
  pages[0];

if (!target) {
  console.error("no page target; available:", pages.map((p) => p.url));
  process.exit(3);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params = {}) {
  const id = ++seq;
  const p = new Promise((res) => pending.set(id, res));
  ws.send(JSON.stringify({ id, method, params }));
  return p;
}

const STATE_EXPR = `(() => {
  const els = [...document.querySelectorAll("audio,video")];
  return {
    href: location.href,
    vis: document.visibilityState,
    discarded: !!document.wasDiscarded,
    online: navigator.onLine,
    installed: !!window.__qaInstalled,
    events: window.__qa ? window.__qa.events.length : 0,
    media: els.map(e => ({
      src: (e.currentSrc || e.src || "").split("/").slice(-2).join("/"),
      paused: e.paused,
      ended: e.ended,
      ct: +e.currentTime.toFixed(2),
      dur: Number.isFinite(e.duration) ? +e.duration.toFixed(1) : null,
      rs: e.readyState,
      ns: e.networkState,
      buffered: e.buffered.length ? +e.buffered.end(e.buffered.length - 1).toFixed(1) : 0,
      err: e.error ? { code: e.error.code, msg: e.error.message } : null,
      muted: e.muted,
      volume: e.volume
    })),
    session: navigator.mediaSession ? {
      state: navigator.mediaSession.playbackState,
      metadata: navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : null
    } : null
  };
})()`;

const INSTALL_EXPR = `(() => {
  if (window.__qaInstalled) return "already";
  window.__qaInstalled = true;
  const qa = window.__qa = { t0: Date.now(), pageOpenedAt: Math.round(performance.now()), events: [] };
  const now = () => Math.round(performance.now());
  const rec = (type, data) => qa.events.push({ t: now(), type, ...data });

  rec("install", { href: location.href, vis: document.visibilityState });

  const proto = HTMLMediaElement.prototype;
  const origPlay = proto.play;
  proto.play = function () {
    const el = this;
    const t = now();
    rec("play:call", {
      src: (el.currentSrc || el.src || "").split("/").slice(-2).join("/"),
      paused: el.paused, ct: +el.currentTime.toFixed(2),
      rs: el.readyState, ns: el.networkState,
      buffered: el.buffered.length ? +el.buffered.end(el.buffered.length - 1).toFixed(1) : 0,
      vis: document.visibilityState
    });
    let p;
    try { p = origPlay.apply(el, arguments); }
    catch (e) { rec("play:throw", { name: e && e.name, msg: String(e && e.message) }); throw e; }
    if (p && typeof p.then === "function") {
      p.then(() => rec("play:resolve", { afterMs: now() - t, paused: el.paused, ct: +el.currentTime.toFixed(2), rs: el.readyState }))
       .catch((e) => rec("play:reject", { afterMs: now() - t, name: e && e.name, msg: String(e && e.message) }));
    }
    return p;
  };

  const origPause = proto.pause;
  proto.pause = function () {
    rec("audio:pause", { ct: +this.currentTime.toFixed(2), vis: document.visibilityState });
    return origPause.apply(this, arguments);
  };

  if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
    const ms = navigator.mediaSession;
    const origSet = ms.setActionHandler.bind(ms);
    ms.setActionHandler = function (action, handler) {
      const wrapped = handler ? function (details) {
        rec("ms:" + action, { vis: document.visibilityState, discarded: !!document.wasDiscarded });
        return handler(details);
      } : null;
      rec("ms:register", { action, hasHandler: !!handler });
      try { return origSet(action, wrapped); }
      catch (e) { rec("ms:registerFail", { action, name: e && e.name }); }
    };
  }

  document.addEventListener("visibilitychange", () => rec("visibility", { state: document.visibilityState }));
  addEventListener("pagehide", () => rec("pagehide", {}));
  addEventListener("pageshow", (e) => rec("pageshow", { persisted: e.persisted }));
  addEventListener("online", () => rec("online", {}));
  addEventListener("offline", () => rec("offline", {}));
  document.addEventListener("freeze", () => rec("freeze", {}));
  document.addEventListener("resume", () => rec("resume", {}));

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name.includes("/api/")) rec("net", {
          path: e.name.split("/api/")[1].slice(0, 48),
          start: Math.round(e.startTime), dur: Math.round(e.duration),
          size: e.transferSize, status: e.responseStatus || null
        });
      }
    }).observe({ type: "resource", buffered: false });
  } catch (e) { rec("perfObserverFail", { msg: String(e && e.message) }); }

  return "installed";
})()`;

const DUMP_EXPR = `(() => {
  const s = ${STATE_EXPR};
  return JSON.stringify({
    state: s,
    t0: window.__qa ? window.__qa.t0 : null,
    events: window.__qa ? window.__qa.events : []
  }, null, 1);
})()`;

if (cmd === "installnew") {
  // Inject at document start so media session handlers are wrapped before the app registers them.
  await send("Page.enable");
  const add = await send("Page.addScriptToEvaluateOnNewDocument", { source: INSTALL_EXPR });
  console.error("addScript:", JSON.stringify(add?.result ?? add?.error));
  if (add?.error) console.error("addScript failed:", JSON.stringify(add.error));
  const rel = await send("Page.reload", {});
  if (rel?.error) console.error("reload failed:", JSON.stringify(rel.error));
  // Page.reload is ignored by the Android WebAPK target; a page-side reload is honored.
  await new Promise((r) => setTimeout(r, 300));
  await send("Runtime.evaluate", { expression: "location.reload()", returnByValue: true }).catch(() => {});
  console.log("installed-at-document-start + reload requested");
  ws.close();
  process.exit(0);
}

const exprs = {
  install: INSTALL_EXPR,
  dump: DUMP_EXPR,
  state: `JSON.stringify(${STATE_EXPR}, null, 1)`,
  reset: `(window.__qa && (window.__qa.events.length = 0), "reset")`,
  eval: arg ?? "null",
};

const res = await send("Runtime.evaluate", {
  expression: exprs[cmd],
  returnByValue: true,
  awaitPromise: true,
  allowUnsafeEvalBlockedByCSP: true,
});

const r = res.result;
if (r?.exceptionDetails) {
  console.error("page error:", JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  process.exit(4);
}
console.log(typeof r?.result?.value === "string" ? r.result.value : JSON.stringify(r?.result?.value ?? null));
ws.close();
