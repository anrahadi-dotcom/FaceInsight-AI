// Face-shape calibration probe: dump the raw width ratios and the classified
// shape for every frontal test photo, so a wrong shape (robert pattinson =
// diamond, alain delon = square/oval) can be diagnosed with real numbers.
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
      msg.error
        ? reject(new Error(JSON.stringify(msg.error)))
        : resolve(msg.result);
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

const files = fs
  .readdirSync(path.join(root, "test_photos"))
  .filter((f) => /\.(jpe?g|png)$/i.test(f));
const edge = spawn(EDGE, [
  "--headless=new",
  "--remote-debugging-port=9340",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,900",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9340/json/version");
    target = (await r.json()).webSocketDebuggerUrl;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
const browser = cdpConnect(target);
await browser.ready;
process.on("exit", () => {
  try {
    edge.kill();
  } catch {}
});
const { targetId } = await browser.send("Target.createTarget", {
  url: ORIGIN + "/index.html",
});
const { sessionId } = await browser.send("Target.attachToTarget", {
  targetId,
  flatten: true,
});
const page = { send: (m, p) => browser.send(m, p, sessionId) };
await page.send("Runtime.enable");
await page.send("Page.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expr, timeoutMs = 90000) => {
  const res = await page.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  });
  if (res.exceptionDetails)
    throw new Error(
      res.exceptionDetails.exception?.description || "evaluate failed",
    );
  return res.result.value;
};
for (let i = 0; i < 80; i++) {
  try {
    if ((await evaluate("document.readyState")) === "complete") break;
  } catch {}
  await wait(250);
}
await evaluate(
  "window.__engine = import('/js/faceEngine.js?ts=' + Date.now())",
);
await evaluate(
  "(async()=>{await (await window.__engine).ensureLandmarker();})()",
);
await wait(1500);

const rows = [];
for (const f of files) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(f);
  const src = `(async () => {
    const engine = await window.__engine;
    const img = new Image(); img.src = ${JSON.stringify(url)};
    try { await img.decode(); } catch(e){ return { file: ${JSON.stringify(f)}, error: "decode" }; }
    const a = await engine.analyzeFace(img);
    if (a.noFace || !a.frontalMetricsMeasured) return { file: ${JSON.stringify(f)}, skip: true };
    // Recompute the three ratios from the landmarks (same indices the engine uses).
    const w = img.naturalWidth, h = img.naturalHeight;
    const P = (i) => ({ x: a.landmarks[i].x * w, y: a.landmarks[i].y * h });
    const d = (i, j) => Math.hypot(P(i).x - P(j).x, P(i).y - P(j).y);
    // The engine now uses the TEMPLE span as width reference and computes a
    // chin angle; report exactly those inputs.
    const temple = d(234, 454);
    const chinAngle = (() => {
      const A=P(132), B=P(152), C=P(361);
      const v1={x:A.x-B.x,y:A.y-B.y}, v2={x:C.x-B.x,y:C.y-B.y};
      const c=(v1.x*v2.x+v1.y*v2.y)/(Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y));
      return +((Math.acos(Math.max(-1,Math.min(1,c)))*180/Math.PI)).toFixed(1);
    })();
    return {
      file: ${JSON.stringify(f)},
      shape: a.faceShape,
      lt: +(d(10, 152) / temple).toFixed(3),
      jc: +(d(132, 361) / temple).toFixed(3),
      fc: +(d(70, 300) / temple).toFixed(3),
      chin: chinAngle,
    };
  })()`;
  rows.push(await evaluate(src).catch((e) => ({ file: f, error: e.message })));
}
console.log(JSON.stringify(rows, null, 1));
browser.close();
edge.kill();
