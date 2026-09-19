// Nose-landmark diagnostic: dump the raw ratios the nose module reads, so the
// "component always 0" bug can be confirmed against real geometry rather than
// inferred.
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
  "--remote-debugging-port=9334",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,900",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9334/json/version");
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
// Cache-bust: dev edits are not always picked up by the browser's module cache.
await evaluate("window.__engine = import('/js/faceEngine.js?ts=' + Date.now())");
await evaluate(
  "(async()=>{await (await window.__engine).ensureLandmarker();})()",
);
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
    const intercanthal = d(133, 362);
    const alarWidth = d(102, 331);
    const noseLength = d(168, 2);
    const bridgeWidth = d(197, 419);
    const nostrilSpan = d(129, 358);
    void [noseLength, bridgeWidth, nostrilSpan];
    const tipWidth = (() => {
      const l = { x: (P(197).x + P(129).x) / 2, y: (P(197).y + P(129).y) / 2 };
      const r = { x: (P(419).x + P(358).x) / 2, y: (P(419).y + P(358).y) / 2 };
      return Math.hypot(l.x - r.x, l.y - r.y);
    })();
    // Report BOTH the pixel-space ratios (from landmarks*w,h) and the ratios the
    // nose module actually sees (NORMALIZED 0..1 landmarks). The two differ for
    // any non-square image, and reading pixel-space numbers as if they were the
    // module's inputs caused a mis-calibration once already.
    const N = (i) => a.landmarks[i];
    const nd = (i, j) => Math.hypot(N(i).x - N(j).x, N(i).y - N(j).y);
    const nInter = nd(133, 362);
    const nAlar = nd(102, 331);
    const nLen = nd(168, 2);
    return {
      file: ${JSON.stringify(f)},
      imgW: w, imgH: h,
      px: {
        alarToInter: +(alarWidth / intercanthal).toFixed(3),
        lenToWidth: +(noseLength / alarWidth).toFixed(3),
        tipToAlar: +(tipWidth / alarWidth).toFixed(3),
        bridgeToAlar: +(bridgeWidth / alarWidth).toFixed(3),
        nostrilToAlar: +(nostrilSpan / alarWidth).toFixed(3),
      },
      norm: {
        alarToInter: +(nAlar / nInter).toFixed(3),
        lenToWidth: +(nLen / nAlar).toFixed(3),
        bridgeToAlar: +(nd(197, 419) / nAlar).toFixed(3),
        nostrilToAlar: +(nd(129, 358) / nAlar).toFixed(3),
      },
      noseScore: a.nose ? a.nose.score : null,
      noseShape: a.nose ? a.nose.shape : null,
      engineMetrics: a.nose ? a.nose.metrics : null,
    };
  })()`;
  rows.push(await evaluate(src).catch((e) => ({ file: f, error: e.message })));
}
console.log(JSON.stringify(rows, null, 1));
browser.close();
edge.kill();
