// One-off diagnostic for a single photo: prints the orientation classifier
// result, whether the mesh locked on, and (when it did) the recessed-jaw depth
// readings. Uses the REAL pipeline so the numbers are what the app would show.
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
  "--remote-debugging-port=9233",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1440,1000",
  "about:blank",
]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try {
    wsUrl = (await (await fetch("http://127.0.0.1:9233/json/version")).json())
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

const file = process.argv[2] || "reccesed.jpg";
const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
const out = await evaluate(`(async (PHOTO_URL) => {
  const engine = await window.__e;
  const img = new Image(); img.src = PHOTO_URL; await img.decode();
  // Can face-api.js (the free 350kb library already loaded for gender) find a
  // face here, when the MediaPipe landmarker could not? TinyFaceDetector on the
  // full-frame detector plus the 68-point landmark net are the free option.
  let faceapiProbe = null;
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/+esm');
    faceapiProbe = { loaded: typeof mod.detectSingleFace };
  } catch (e) { faceapiProbe = { error: String(e) }; }
  const front = await engine.analyzeFrontPhoto(img);
  const side = await engine.analyzeSidePhoto(img);
  const combo = engine.combineAnalysis(front, side);
  return {
    front: {
      noFace: front.noFace, isFallback: front.isFallback, tier: front.tier,
      orientation: front.orientation, profileYaw: front.profile.yaw,
      isProfile: front.profile.isProfile, frontalMeasured: front.frontalMetricsMeasured,
      suspectedProfile: front.suspectedProfile, confidence: front.confidence.score,
      message: front.message, detectedBox: front.detectedBox, scleral: front.eyeArea && front.eyeArea.scleralShow, scleralSource: front.eyeArea && front.eyeArea.scleralSource,
    },
    faceapiProbe,
    side: {
      noFace: side.noFace, faceFound: side.faceFound, orientation: side.orientation,
      isProfileish: side.isProfileish, depthAvailable: side.depthAvailable,
      chinRecession: side.chinRecession, jawRecession: side.jawRecession,
      jawRecessionLabel: side.jawRecessionLabel, profileVectorAngle: side.profileVectorAngle,
      gonialAngle: side.gonialAngle, gonialLabel: side.gonialLabel,
      mandibleRatio: side.mandibleRatio, mandibleLabel: side.mandibleLabel,
      ramusRatio: side.ramusRatio, ramusLabel: side.ramusLabel,
      eyeProjectionLabel: side.eyeProjectionLabel, noseLabel: side.noseLabel,
      profileConfidence: side.profileConfidence, message: side.message,
    },
    combo: { combinedScore: combo && combo.combinedScore, combinedTier: combo && combo.combinedTier },
  };
})(${JSON.stringify(url)})`);
console.log(JSON.stringify(out, null, 2));
browser.close();
chrome.kill();
