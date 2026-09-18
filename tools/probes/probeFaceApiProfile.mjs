// Diagnostic: can the free face-api.js detectors find a face where the MediaPipe
// landmarker fails (a near-true side profile)? Tests TinyFaceDetector and
// SsdMobilenetv1 on one photo and reports the box + confidence.
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
  "--remote-debugging-port=9237",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1440,1000",
  "about:blank",
]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try {
    wsUrl = (await (await fetch("http://127.0.0.1:9237/json/version")).json())
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

const file = process.argv[2] || "reccesed.jpg";
const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
const out = await evaluate(`(async (PHOTO_URL) => {
  const BASE = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js-models@master';
  const faceapi = await import('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/+esm');
  const img = new Image(); img.src = PHOTO_URL; await img.decode();
  const out = {};
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(BASE + '/tiny_face_detector');
    const tiny = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.2 }));
    out.tiny = tiny ? { score: tiny.score, box: tiny.box } : null;
  } catch (e) { out.tinyError = String(e); }
  try {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(BASE + '/ssd_mobilenetv1');
    const ssd = await faceapi.detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }));
    out.ssd = ssd ? { score: ssd.score, box: ssd.box } : null;
  } catch (e) { out.ssdError = String(e); }
  return out;
})(${JSON.stringify(url)})`);
console.log(JSON.stringify(out, null, 2));
browser.close();
chrome.kill();
