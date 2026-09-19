// Eye-area raw diagnostic: dump the underlying ratios that decide the brow /
// eyelid / canthal parts, so "always 100" components can be confirmed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
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

const files = [
  "adriana_lima.jpg",
  "alain_flick.jpg",
  "chico_frontal.jpg",
  "Doutzen Kroes.jpg",
  "EliasDePoot.jpg",
  "FatGirl.jpeg",
  "FatGuy.jpeg",
  "jordan_barrett.jpg",
  "MarlonTexeira.jpg",
  "sean_opry.jpg",
  "SimonNessman.jpg",
];
const edge = spawn(EDGE, [
  "--headless=new",
  "--remote-debugging-port=9336",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,900",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9336/json/version");
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
    throw new Error(res.exceptionDetails.exception?.description || "evaluate failed");
  return res.result.value;
};
for (let i = 0; i < 80; i++) {
  try {
    if ((await evaluate("document.readyState")) === "complete") break;
  } catch {}
  await wait(250);
}
await evaluate("window.__engine = import('/js/faceEngine.js')");
await evaluate("(async()=>{await (await window.__engine).ensureLandmarker();})()");
await wait(1500);

const rows = [];
for (const f of files) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(f);
  const src = `(async () => {
    const engine = await window.__engine;
    const img = new Image(); img.src = ${JSON.stringify(url)}; await img.decode();
    const a = await engine.analyzeFace(img);
    if (a.noFace || !a.frontalMetricsMeasured) return { file: ${JSON.stringify(f)}, skip: true };
    const w = img.naturalWidth, h = img.naturalHeight;
    const P = (i) => ({ x: a.landmarks[i].x * w, y: a.landmarks[i].y * h });
    const d = (i, j) => Math.hypot(P(i).x - P(j).x, P(i).y - P(j).y);
    const eyeWidth = (d(33,133) + d(263,362)) / 2 || 1;
    const eyeCenterL = { x: (P(33).x + P(133).x)/2, y: (P(33).y + P(133).y)/2 };
    const eyeCenterR = { x: (P(263).x + P(362).x)/2, y: (P(263).y + P(362).y)/2 };
    const browEyeDist = (Math.abs(eyeCenterL.y - P(70).y) + Math.abs(eyeCenterR.y - P(300).y)) / 2;
    return {
      file: ${JSON.stringify(f)},
      ear: +a.eyeShape.ear.toFixed(3),
      tiltDeg: +a.canthalTilt.degrees.toFixed(1),
      browEyeRatio: +(browEyeDist / eyeWidth).toFixed(3),
      intercanthalRatio: +(d(133,362) / eyeWidth).toFixed(3),
      parts: {
        canthal: +a.eyeArea.scoreParts.canthal.toFixed(1),
        projection: +a.eyeArea.scoreParts.projection.toFixed(1),
        eyelid: +a.eyeArea.scoreParts.eyelid.toFixed(1),
        brow: +a.eyeArea.scoreParts.brow.toFixed(1),
      },
      score: +a.eyeArea.score.toFixed(1),
      label: a.eyeArea.label,
    };
  })()`;
  rows.push(await evaluate(src).catch((e) => ({ file: f, error: e.message })));
}
console.log(JSON.stringify(rows, null, 1));
browser.close();
edge.kill();
