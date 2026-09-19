// Full baseline dump: every test photo, every sub-score + tier + shape + nose, so
// the rating calibration is based on the whole set rather than one face.
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
  "--remote-debugging-port=9360",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,900",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9360/json/version");
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
const evaluate = async (expr, t = 90000) => {
  const res = await page.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: t,
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
  `window.__engine = import(${JSON.stringify(ORIGIN + "/js/faceEngine.js")})`,
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
    return {
      file: ${JSON.stringify(f)},
      overall: +a.overall.toFixed(1),
      tier: a.tier,
      symmetry: +a.symmetry.toFixed(1),
      golden: +a.golden.toFixed(1),
      faceFat: +a.faceFat.score.toFixed(1),
      jawline: +a.jawline.score.toFixed(1),
      eyeArea: +a.eyeArea.score.toFixed(1),
      skin: +a.skinQuality.toFixed(1),
      acne: a.skinAcne ? +a.skinAcne.score.toFixed(1) : null,
      shape: a.faceShape,
      nosescore: a.nose ? a.nose.score : null,
      noseShape: a.nose ? a.nose.shape : null,
      potential: a.potential && a.potential.score !== null ? +a.potential.score.toFixed(1) : null,
    };
  })()`;
  rows.push(await evaluate(src).catch((e) => ({ file: f, error: e.message })));
}
fs.writeFileSync(
  path.join(root, "tools", "_baseline.json"),
  JSON.stringify(rows, null, 1),
);
console.log(JSON.stringify(rows, null, 1));
browser.close();
edge.kill();
