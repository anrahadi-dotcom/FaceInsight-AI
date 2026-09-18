// Dev-only scoring check. Runs the REAL app pipeline (js/main.js analyzeFace ->
// the on-device MediaPipe landmarker -> the scorer in js/faceEngine.js) on every
// photo in test_photos/ and prints the sub-scores that decide the tier. This is
// how the face-fat / tier tuning is verified against real numbers instead of
// eyeballed -- see the note above computeFaceFat in js/faceEngine.js.
//
// Needs a local server plus a headless Chromium:
//   1. python -m http.server 5501
//   2. set CHROME_PATH to a chrome.exe (or Edge), then node tools/scoringCheck.mjs
// ORIGIN overrides the server URL, CHROME_PATH the browser binary.
//
// The page is the real index.html; the script loads each photo into it through
// the same code path the "Upload photo" button uses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// Minimal CDP client over the browser's remote-debugging WebSocket.
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else {
      events.push(msg);
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

const files = fs.readdirSync(path.join(root, "test_photos"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9222", "--no-first-run",
  "--disable-gpu", "--use-gl=swiftshader", "--window-size=1280,900", "about:blank"]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9222/json/version");
    target = (await r.json()).webSocketDebuggerUrl;
    break;
  } catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!target) throw new Error("could not reach headless Chrome on 9222");
const browser = cdpConnect(target);
await browser.ready;
process.on("exit", () => { try { chrome.kill(); } catch {} });
const { targetId } = await browser.send("Target.createTarget", { url: ORIGIN + "/index.html" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const page = {
  send: (m, p) => browser.send(m, p, sessionId),
  on: () => {},
};
await page.send("Runtime.enable");
await page.send("Page.enable");
page.on = (evt, cb) => { /* page errors surface as evaluate failures below */ };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expr, timeoutMs = 90000) => {
  const res = await page.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "evaluate failed");
  return res.result.value;
};
const goto = async (url) => {
  await page.send("Page.navigate", { url });
  for (let i = 0; i < 80; i++) {
    try {
      const rs = await evaluate("document.readyState");
      if (rs === "complete") return;
    } catch (e) { /* page still navigating */ }
    await wait(250);
  }
};

await goto(ORIGIN + "/index.html");
await evaluate("window.__check = import('/js/faceEngine.js').then(m => (window.__engine = m))");

// BASELINE=1 replays the PRE-CHANGE centering rules (face-fat penalties, its
// weight in the overall, and the tips' WEAK threshold) on top of the live
// adjudicator, so the before/after numbers can be compared without a git stash.
const BASELINE = process.env.BASELINE === "1";

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6) => (typeof v === "number" ? v.toFixed(n) : String(v));
console.log(
  (BASELINE ? "[BASELINE: pre-change rules]\n" : "") +
  pad("photo", 30) + pad("fat", 7) + pad("jaw", 7) + pad("sym", 7) +
  pad("gold", 7) + pad("eye", 7) + pad("skin", 7) + pad("overall", 8) +
  pad("tier", 24) + pad("potential", 20) + "conf"
);

for (const file of files) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
  const patch = BASELINE
    ? `a.faceFat = { ...a.faceFat, score: (() => {
         const lw = d(10, 152) / d(116, 345), jc = d(132, 361) / d(116, 345);
         let p = 0;
         if (lw < 1.27) p += (1.27 - lw) * 520;
         if (jc > 1.04) p += (jc - 1.04) * 420;
         return Math.max(0, Math.min(100, 100 - p));
       })() };
       const W = [0.22, 0.16, 0.15, 0.13, 0.13, 0.08, 0.13];
       const s = [a.symmetry, a.golden, a.faceFat.score, a.jawline.score, a.skinQuality,
                  a.skinAcne.score, a.eyeShape.score];
       a.overall = s.reduce((t, v, i) => t + v * W[i], 0);
       a.tier = engine.tierFor(a.overall, a.gender);
       a.tierGroup = engine.tierGroupFor(a.overall, a.gender);`
    : "";
  const src = `(async () => {
    const engine = await window.__engine;
    const img = new Image();
    img.src = ${JSON.stringify(url)};
    await img.decode();
    const a = await engine.analyzeFace(img);
    const P = (k) => ({ x: a.landmarks[k].x * img.naturalWidth, y: a.landmarks[k].y * img.naturalHeight });
    const d = (i, j) => Math.hypot(P(i).x - P(j).x, P(i).y - P(j).y);
    ${patch}
    // Landmark probes for the jaw/chin geometry: a wide smile opens the mouth
    // (13/14) and pushes the chin (152) down while the jaw corners (132/361)
    // stay put, so faceLength measures mostly jaw OPENING, not face shape.
    return {
      lenW: d(10, 152) / d(116, 345),
      jawCh: d(132, 361) / d(116, 345),
      chinAngle: (() => {
        const A = P(43), B = { x: a.landmarks[200].x * img.naturalWidth, y: a.landmarks[200].y * img.naturalHeight }, C = P(273);
        const ang = (p, q, r) => {
          const v1 = { x: p.x - q.x, y: p.y - q.y }, v2 = { x: r.x - q.x, y: r.y - q.y };
          const c = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
          return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
        };
        return ang(A, B, C);
      })(),
      mouthOpen: d(13, 14) / d(116, 345),
      gonion: (d(116, 132) + d(345, 361)) / 2 / d(116, 345),
      faceFat: a.faceFat, jawline: a.jawline, symmetry: a.symmetry, golden: a.golden,
      skin: a.skinQuality, eye: a.eyeArea, overall: a.overall,
      tier: a.tier === null ? "(n/a - not front-facing)" : a.tier,
      grou: a.tierGroup, overallMeasured: a.overallMeasured,
      isFallback: a.isFallback, noFace: a.noFace, isProfile: a.profile.isProfile,
      suspectedProfile: a.suspectedProfile, detectedBox: !!a.detectedBox,
      potential: a.potential.score === null ? "n/a" : (a.potential.score.toFixed(1) + " to " + a.potential.tier),
      headroom: a.potential.headroom.toFixed(1),
      conf: a.confidence.score.toFixed(0) + ' pct ' + a.confidence.label,
      light: a.lighting.measured ? a.lighting.label : 'n/a',
      softScore: a.faceFat.softTissue ? a.faceFat.softTissue.score : null,
      chinFill: a.faceFat.softTissue ? a.faceFat.softTissue.chinFill : null,
      bulge: a.faceFat.softTissue ? a.faceFat.softTissue.cheekBulge : null,
      boneScore: a.faceFat.boneScore,
      rowDebug: a.faceFat.softTissue ? a.faceFat.softTissue.rowDebug : null,
      jawHalf: (() => {
        const g = (k) => ({ x: a.landmarks[k].x * img.naturalWidth, y: a.landmarks[k].y * img.naturalHeight });
        return Math.hypot(g(132).x - g(361).x, g(132).y - g(361).y) / 2;
      })(),
    };
  })()`;
  const out = await evaluate(src).catch((e) => ({ error: e.message }));

  if (out.error) {
    console.log(pad(file.slice(0, 32), 34) + "-- " + out.error);
    continue;
  }
  console.log(
    pad(file.slice(0, 30), 32) + pad(num(out.faceFat.score, 1), 7) + pad(num(out.jawline.score, 1), 7) +
    pad(num(out.symmetry, 1), 7) + pad(num(out.golden, 1), 7) +
    pad(num(out.eye.score, 1), 7) + pad(num(out.skin, 1), 7) +
    pad(num(out.overall, 1), 8) +
    pad(out.tier + (out.grou ? " [" + out.grou + "]" : ""), 24) +
    pad(out.potential + " (" + out.headroom + ")", 20) +
    out.conf +
      (out.noFace ? (out.suspectedProfile ? " NO-MESH(profile?)" : " NO-FACE") : "") +
      (out.isProfile ? " PROFILE" : "")
  );
}

browser.close();
chrome.kill();

