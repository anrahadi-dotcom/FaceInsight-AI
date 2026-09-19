// Trace the nose classification for real photos: print the branch inputs the
// classifier uses so a wrong shape label can be explained by its own numbers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5502";
const EDGE =
  process.env.CHROME_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

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
  const ready = new Promise((res) => ws.addEventListener("open", res));
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
  return { ready, send, close: () => ws.close() };
}

const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=9337", "--no-first-run",
  "--disable-gpu", "--use-gl=swiftshader", "--window-size=1280,900", "about:blank"]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9337/json/version");
    target = (await r.json()).webSocketDebuggerUrl;
    break;
  } catch { await new Promise((r) => setTimeout(r, 250)); }
}
const browser = cdpConnect(target);
await browser.ready;
process.on("exit", () => { try { edge.kill(); } catch {} });
const { targetId } = await browser.send("Target.createTarget", { url: ORIGIN + "/index.html" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const page = { send: (m, p) => browser.send(m, p, sessionId) };
await page.send("Runtime.enable");
await page.send("Page.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expr, timeoutMs = 90000) => {
  const res = await page.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "evaluate failed");
  return res.result.value;
};
for (let i = 0; i < 80; i++) {
  try { if ((await evaluate("document.readyState")) === "complete") break; } catch {}
  await wait(250);
}
await evaluate("window.__engine = import('/js/faceEngine.js?ts=' + Date.now())");
await evaluate("(async()=>{await (await window.__engine).ensureLandmarker();})()");
await wait(1500);

const out = [];
for (const f of ["chico_frontal.jpg", "adriana_lima.jpg", "jordan_barrett.jpg"]) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(f);
  const src = `(async () => {
    const engine = await window.__engine;
    const noseMod = await import('/js/nose.js?ts=' + Date.now());
    const img = new Image(); img.src = ${JSON.stringify(url)}; await img.decode();
    const a = await engine.analyzeFace(img);
    // Re-run the nose module directly on the SAME landmarks analyzeFace used.
    const direct = noseMod.assessNose(a.landmarks, null);
    return {
      file: ${JSON.stringify(f)},
      fromEngine: a.nose ? { score: a.nose.score, shape: a.nose.shape, metrics: a.nose.metrics } : null,
      direct: direct ? { score: direct.score, shape: direct.shape, metrics: direct.metrics } : null,
    };
  })()`;
  out.push(await evaluate(src).catch((e) => ({ file: f, error: e.message })));
}
console.log(JSON.stringify(out, null, 1));
browser.close();
edge.kill();
