// One-off diagnostic: prints the raw silhouette measurements for a single photo
// so the source of a wrong soft-tissue reading can be seen instead of guessed.
// Exposes the internals through a temporary global that faceEngine attaches in
// dev (see window.__softProbe). Not part of the app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
  const ready = new Promise((res) => ws.addEventListener("open", res));
  return { ready, send, close: () => ws.close() };
}

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9225", "--no-first-run",
  "--disable-gpu", "--use-gl=swiftshader", "--window-size=1440,1000", "about:blank"]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try { wsUrl = (await (await fetch("http://127.0.0.1:9225/json/version")).json()).webSocketDebuggerUrl; break; }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
const browser = cdpConnect(wsUrl);
await browser.ready;
const { targetId } = await browser.send("Target.createTarget", { url: ORIGIN + "/index.html" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const send = (m, p) => browser.send(m, p, sessionId);
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression, timeout = 90000) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
};
for (let i = 0; i < 80; i++) {
  if ((await evaluate("document.readyState")) === "complete") break;
  await wait(250);
}

const file = process.argv[2] || "download (6).jpeg";
const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
const out = await evaluate(`(async () => {
  const engine = await import('/js/faceEngine.js');
  const img = new Image();
  img.src = ${JSON.stringify(url)};
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const lm = await engine.__landmarksFor?.(img);
  const a = await engine.analyzeFace(img);
  const P = (k) => ({ x: a.landmarks[k].x * w, y: a.landmarks[k].y * h });
  return {
    size: [w, h],
    jawL: P(132), jawR: P(361), chin: P(152), cheekL: P(116), cheekR: P(345),
    soft: a.faceFat.softTissue, boneScore: a.faceFat.boneScore,
    faceFat: a.faceFat,
  };
})()`);
console.log(JSON.stringify(out, null, 2));
browser.close();
chrome.kill();
