// Dev-only tuning harness: pulls the raw eye-area INPUTS (canthal degrees, lid
// exposure, brow ratio, intercanthal ratio, aperture, EAR) for every photo, then
// applies candidate scoring formulas IN THE PAGE so the resulting spread can be
// seen before any of them is committed to faceEngine.js.
//
// Edit the CANDIDATE functions below, re-run, and read the table. This is how the
// eye-area bands are chosen from the measured distribution instead of guessed.
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
  "--remote-debugging-port=9236",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1440,1000",
  "about:blank",
]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try {
    wsUrl = (await (await fetch("http://127.0.0.1:9236/json/version")).json())
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

// ---- CANDIDATE formulas (run in-page) --------------------------------------
const CANDIDATES = `
  const clamp100 = (x) => Math.max(0, Math.min(100, x));
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function canthalScore(deg) {
    if (deg >= 2) return clamp100(78 + Math.min(deg - 2, 6) * 4 - Math.max(0, deg - 8) * 2);
    if (deg >= -2) return clamp100(78 + (deg) * 2);   // neutral: 74..82
    return clamp100(78 - (Math.abs(deg) - 2) * 6);
  }
  function eyelidScore(lid) {
    // Ideal: a crease that is visible but not heavily hooded. Measured frontal
    // spread is 0.20 (tight) .. 0.65 (soft), with strong hooding at 0.84+.
    const ideal = 0.34;
    const d = lid - ideal;
    return clamp100(92 - (d > 0 ? d * 130 : -d * 70));
  }
  function browScore(brow) {
    // Ideal moderate gap, from the engine's own BROW_EYE_IDEAL 0.62 on the same
    // measured scale (frontal faces sit 0.44..0.65).
    const ideal = 0.62;
    return clamp100(92 - Math.abs(brow - ideal) * 120);
  }
`;
const HARNESS = `
(async (PHOTO_URL) => {
  const engine = await window.__e;
  const img = new Image(); img.src = PHOTO_URL; await img.decode();
  const a = await engine.analyzeFrontPhoto(img);
  const e = a.eyeArea;
  const inputs = {
    tiltDeg: a.canthalTilt.degrees,
    lidExp: e.upperLidExposure,
    brow: e.browEyeRatio,
    inter: e.intercanthalRatio,
    aperture: e.eyeAperture,
  };
  ${CANDIDATES}
  const c = canthalScore(inputs.tiltDeg);
  const el = eyelidScore(inputs.lidExp);
  const br = browScore(inputs.brow);
  const parts = [c, el, br];
  const weakest = Math.min(...parts);
  const blend = (c * 0.3 + el * 0.25 + br * 0.2) / 0.75;
  return { ...inputs, canthalC: c, eyelidC: el, browC: br, weakest, blend,
           current: e.score, noFace: a.noFace };
})`;

console.log(
  pad("photo", 24) +
    pad("tilt", 7) +
    pad("lidExp", 8) +
    pad("brow", 7) +
    pad("app", 7) +
    pad("cand", 7) +
    pad("eyel", 7) +
    pad("brw", 7) +
    pad("weak", 7) +
    pad("blend", 7) +
    "cur",
);
console.log("-".repeat(95));
for (const file of files) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
  const out = await evaluate(`(${HARNESS})(${JSON.stringify(url)})`).catch(
    (e) => ({ error: e.message }),
  );
  if (out.error) {
    console.log(pad(file.slice(0, 22), 24) + "-- " + out.error);
    continue;
  }
  console.log(
    pad(file.slice(0, 22), 24) +
      pad(f(out.tiltDeg), 7) +
      pad(f(out.lidExp, 3), 8) +
      pad(f(out.brow, 3), 7) +
      pad(f(out.aperture, 3), 7) +
      pad(f(out.canthalC), 7) +
      pad(f(out.eyelidC), 7) +
      pad(f(out.browC), 7) +
      pad(f(out.weakest), 7) +
      pad(f(out.blend), 7) +
      f(out.current) +
      (out.noFace ? "  NO-FACE" : ""),
  );
}
browser.close();
chrome.kill();
