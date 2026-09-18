// Dev-only probe: dumps the eye-area composite internals (per-part scores, lid
// exposure, EAR, scleral, brow, intercanthal, weakest part, requirement cap) for
// every photo, so the "every face reads the same" report can be traced to real
// numbers instead of guessed at.
import fs from "node:fs";
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
  "--remote-debugging-port=9234",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1440,1000",
  "about:blank",
]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try {
    wsUrl = (await (await fetch("http://127.0.0.1:9234/json/version")).json())
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

const dir = process.env.PHOTO_DIR || path.join(root, "test_photos");
const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
const pad = (s, n) => String(s).padEnd(n);
const f = (v, n = 1) => (typeof v === "number" ? v.toFixed(n) : String(v));

console.log(
  pad("photo", 26) +
    pad("eye", 6) +
    pad("eyeshape", 18) + pad("tiltDeg", 8) + pad("tiltLab", 9) +
    pad("canth", 6) + pad("eyelid", 7) +
    pad("brow", 6) + pad("proj", 6) + pad("weak", 6) + pad("cap", 5) +
    pad("EAR", 6) +
    pad("lidExp", 7) +
    pad("apert", 7) +
    pad("scl", 6) +
    pad("label", 16) +
    "src",
);
console.log("-".repeat(115));
for (const file of files) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
  const out = await evaluate(`(async (PHOTO_URL) => {
    const engine = await window.__e;
    const img = new Image(); img.src = PHOTO_URL; await img.decode();
    const a = await engine.analyzeFrontPhoto(img);
    const e = a.eyeArea;
    return {
      eye: e.score, canthal: e.scoreParts.canthal, eyelid: e.scoreParts.eyelid,
      brow: e.scoreParts.brow, proj: e.scoreParts.projection,
      weakest: e.weakestPart, label: e.label, exposureLabel: e.upperLidExposureLabel,
      lidExp: e.upperLidExposure, lidSource: e.lidSource, scleral: e.scleralShow,
      ear: a.eyeShape && a.eyeShape.ear, noFace: a.noFace, aperture: e.eyeAperture,
      canthalDeg: a.canthalTilt && a.canthalTilt.degrees, tiltLabel: a.canthalTilt && a.canthalTilt.label,
      browRatio: e.browEyeRatio, interRatio: e.intercanthalRatio, eyeShapeLabel: a.eyeShape && a.eyeShape.label,
    };
  })(${JSON.stringify(url)})`).catch((e) => ({ error: e.message }));
  if (out.error) {
    console.log(pad(file.slice(0, 24), 26) + "-- " + out.error);
    continue;
  }
  console.log(
    pad(file.slice(0, 24), 26) + pad(f(out.eye), 6) +
    pad((out.eyeShapeLabel || "").slice(0, 16), 18) +
    pad(f(out.canthalDeg, 1), 8) + pad(out.tiltLabel, 9) +
    pad(f(out.canthal), 6) +
    pad(f(out.eyelid), 7) + pad(f(out.brow), 6) + pad(f(out.proj), 6) +
      pad(out.weakest.split(" ")[0], 6) +
      pad(out.cap ?? "-", 5) +
      pad(f(out.ear, 3), 6) + pad(f(out.lidExp, 3), 7) + pad(f(out.aperture, 3), 7) +
      pad(f(out.scleral, 3), 6) +
      pad(out.exposureLabel, 16) + out.lidSource + (out.noFace ? "  NO-FACE" : ""),
  );
}
browser.close();
chrome.kill();
