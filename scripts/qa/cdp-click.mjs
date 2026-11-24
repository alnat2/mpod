#!/usr/bin/env node
// cdp-click.mjs — trusted click on an element inside the page, over CDP.
//
//   scripts/qa/cdp-click.mjs <port> <urlSubstring> "<js expression returning an Element>"
//
// Example:
//   scripts/qa/cdp-click.mjs 9222 home "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Play')"
//
// Why: an installed WebAPK often exposes no accessibility tree (agent-device sees
// a single "Web View" node), so coordinate taps miss. Dispatching real CDP input
// events at the element's center is a genuine trusted gesture.

const [port, filter, expr] = process.argv.slice(2);
if (!port || !expr) {
  console.error('usage: cdp-click.mjs <port> <urlSubstring> "<js returning element>"');
  process.exit(2);
}

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const target = pages.find((t) => !filter || t.url.includes(filter)) ?? pages[0];
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

const probe = await send('Runtime.evaluate', {
  expression: `(function(){
    const el = (${expr});
    if (!el) return { err: 'no element' };
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x + b.width / 2),
      y: Math.round(b.y + b.height / 2),
      w: Math.round(b.width),
      h: Math.round(b.height),
      text: ((el.getAttribute && el.getAttribute('aria-label')) || el.textContent || '').trim().slice(0, 60),
      vis: document.visibilityState,
    };
  })()`,
  returnByValue: true,
});

const v = probe.result?.result?.value;
if (!v || v.err) {
  console.error(JSON.stringify(v ?? probe.result ?? probe));
  process.exit(4);
}

const { x, y } = v;
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

console.log(JSON.stringify({ url: target.url, ...v }));
ws.close();
