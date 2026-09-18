// Dev-only probe: dumps the landmark/geometry values the soft-tissue metric
// will be built on, plus the skin-coverage measurements under the chin and
// beside the cheeks, for every photo in test_photos/. Run this BEFORE trusting
// any threshold in computeSoftTissue -- the numbers have to come from real
// detections, not from guessing.
//
//   python -m http.server 5501
//   node tools/probeSoftTissue.mjs
// CHROME_PATH / ORIGIN / PHOTO_DIR override the defaults.
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

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9224", "--no-first-run",
  "--disable-gpu", "--use-gl=swiftshader", "--window-size=1440,1000", "about:blank"]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try { wsUrl = (await (await fetch("http://127.0.0.1:9224/json/version")).json()).webSocketDebuggerUrl; break; }
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
await evaluate("window.__e = import('/js/faceEngine.js')");

const dir = process.env.PHOTO_DIR || path.join(root, "test_photos");
const files = fs.readdirSync(dir);
const pad = (s, n) => String(s).padEnd(n);
const f = (v, n = 3) => (typeof v === "number" ? v.toFixed(n) : String(v));

console.log(
  pad("photo", 32) + pad("chinY", 7) + pad("jawY", 7) + pad("chinBelow", 9) +
  pad("cheekOut", 9) + pad("fullw", 7) + pad("lowSkin", 8) + pad("fat", 6) + "jaw"
);

for (const file of files) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
  const out = await evaluate(`(async () => {
    const engine = await window.__e;
    const img = new Image();
    img.src = ${JSON.stringify(url)};
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    const lm = engine.__probeLandmarks ? engine.__probeLandmarks(img) : null;
    const a = await engine.analyzeFace(img);
    const P = (k) => ({ x: a.landmarks[k].x * w, y: a.landmarks[k].y * h });
    const d = (i, j) => Math.hypot(P(i).x - P(j).x, P(i).y - P(j).y);
    return {
      chinY: P(152).y / h, jawY: P(132).y / h,
      chinDx: (P(152).y - P(132).y) / d(116, 345),
      cheekOut: d(116, 345) / d(132, 361),
      fat: a.faceFat.score, jaw: a.jawline.score, overall: a.overall, tier: a.tier,
      px: { w, h },
    };
  })()`).catch((e) => ({ error: e.message, file }));

  if (out.error) { console.log(pad(file.slice(0, 30), 32) + "-- " + out.error); continue; }
  console.log(
    pad(file.slice(0, 30), 32) + pad(f(out.chinY), 7) + pad(f(out.jawY), 7) +
    pad(f(out.chinDx), 9) + pad(f(out.cheekOut), 9) +
    pad(f(out.px.w + "x" + out.px.h), 10) + pad(f(out.fat, 1), 8) + f(out.jaw, 1)
  );
}

browser.close();
chrome.kill();
