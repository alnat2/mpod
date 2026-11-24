#!/usr/bin/env node
// cdp-eval.mjs — evaluate JS inside a page on a device/browser over CDP.
//
//   scripts/qa/cdp-eval.mjs <port> <urlSubstring> "<js expression>"
//
// Port is a forwarded DevTools port:
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//
// Prints the JSON value of the expression. Works for real devices and emulators,
// including installed WebAPKs (their pages show up in /json/list).

const [port, filter, expression] = process.argv.slice(2);
if (!port || !expression) {
  console.error('usage: cdp-eval.mjs <port> <urlSubstring> "<js>"');
  process.exit(2);
}

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const target =
  pages.find((t) => !filter || t.url.includes(filter)) ?? pages[0];

if (!target) {
  console.error('no page target; available:', pages.map((p) => p.url).join(', '));
  process.exit(3);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
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

const res = await send('Runtime.evaluate', {
  expression: `(async function(){ ${expression} })()`,
  returnByValue: true,
  awaitPromise: true,
  allowUnsafeEvalBlockedByCSP: true,
});

const r = res.result;
if (r?.exceptionDetails) {
  console.error('page error:', JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  process.exit(4);
}
console.log(JSON.stringify({ url: target.url, value: r?.result?.value ?? null }, null, 1));
ws.close();
