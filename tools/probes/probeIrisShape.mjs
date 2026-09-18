// One-off check: is the MediaPipe "iris ring" (469-472 / 474-477) actually a ring
// AROUND the iris centre (i.e. its vertical extent is the iris diameter), or is it
// only a small circle near the centre? If the ring's vertical span is far smaller
// than the visible iris, then "iris height" cannot be used as a scale and an
// iris-anchored scleral reading is impossible on this mesh. Prints the raw Y of
// the iris centre, every ring point, and the eye's own corner/lid landmarks.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
const CHROME =
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
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
  const ready = new Promise((res) => ws.addEventListener("open", res));
  return { ready, send, close: () => ws.close() };
}

const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=9232",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1440,1000",
  "about:blank",
]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try {
    wsUrl = (await (await fetch("http://127.0.0.1:9232/json/version")).json())
      .webSocketDebuggerUrl;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
const browser = cdpConnect(wsUrl);
await browser.ready;
process.on("exit", () => {
  try {
    chrome.kill();
  } catch {}
});
const { targetId } = await browser.send("Target.createTarget", {
  url: ORIGIN + "/index.html",
});
const { sessionId } = await browser.send("Target.attachToTarget", {
  targetId,
  flatten: true,
});
const send = (m, p) => browser.send(m, p, sessionId);
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression, timeout = 120000) => {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout,
  });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
};
for (let i = 0; i < 80; i++) {
  if ((await evaluate("document.readyState")) === "complete") break;
  await wait(250);
}
await evaluate("window.__e = import('/js/faceEngine.js')");

const file = process.argv[2] || "jordan_barrett.jpg";
const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
const out = await evaluate(`(async (PHOTO_URL) => {
  const engine = await window.__e;
  const img = new Image(); img.src = PHOTO_URL; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const a = await engine.analyzeFace(img);
  const lm = a.landmarks;
  const P = (k) => ({ x: +(lm[k].x * w).toFixed(1), y: +(lm[k].y * h).toFixed(1), z: +lm[k].z.toFixed(3) });
  // Depth sanity: MediaPipe's normalized landmarks carry a z (roughly the same
  // scale as x). Report its spread so a front-vs-side classifier based on z is
  // only built if z actually varies -- if every z is 0 the depth signal is absent.
  const zs = lm.map((p) => p.z);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  const zSpread = zMax - zMin;
  return {
    size: [w, h],
    zSpread: +zSpread.toFixed(4),
    zSamples: { nose1: +lm[1].z.toFixed(4), chin152: +lm[152].z.toFixed(4), chin199: +lm[199].z.toFixed(4), forehead10: +lm[10].z.toFixed(4), subnasale2: +lm[2].z.toFixed(4), leftEye33: +lm[33].z.toFixed(4), rightEye263: +lm[263].z.toFixed(4), jarL234: +lm[234].z.toFixed(4), jawR454: +lm[454].z.toFixed(4) },
    leftIrisCenter: P(468),
    leftIrisRing: [469,470,471,472].map(P),
    rightIrisCenter: P(473),
    rightIrisRing: [474,475,476,477].map(P),
    leftEyeRing: { outer: P(33), inner: P(133), upper: P(159), lower_old: P(145) },
    rightEyeRing: { outer: P(263), inner: P(362), upper: P(386), lower_old: P(374) },
  };
})(${JSON.stringify(url)})`);
console.log(JSON.stringify(out, null, 2));
browser.close();
chrome.kill();
