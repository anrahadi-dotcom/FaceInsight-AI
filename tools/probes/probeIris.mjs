// Dev-only probe: for every photo in test_photos/, print the IRIS geometry and
// the vertical position of every lower-lid candidate landmark relative to the
// iris, so an iris-based scleral-show reading can be built on measured numbers
// instead of a guessed landmark index.
//
// The exact question this answers: which mesh point is the true geometric
// LOWEST point of the lower eyelid? The previous iris-based attempt used 145/374
// (the lid's outer corner, not its lowest point) and was reverted because it
// returned the maximum on nearly every photo. This probe scans every plausible
// lower-lid ring point and reports its depth below the iris bottom, so the
// winner is chosen from data.
//
//   python -m http.server 5501   (or any static server on ORIGIN)
//   node tools/probeIris.mjs
// CHROME_PATH / ORIGIN override the defaults.
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
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9231",
  "--no-first-run", "--disable-gpu", "--use-gl=swiftshader",
  "--window-size=1440,1000", "about:blank"]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try { wsUrl = (await (await fetch("http://127.0.0.1:9231/json/version")).json()).webSocketDebuggerUrl; break; }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!wsUrl) throw new Error("could not reach headless browser on 9231");
const browser = cdpConnect(wsUrl);
await browser.ready;
process.on("exit", () => { try { chrome.kill(); } catch {} });
const { targetId } = await browser.send("Target.createTarget", { url: ORIGIN + "/index.html" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const send = (m, p) => browser.send(m, p, sessionId);
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression, timeout = 120000) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
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
const f = (v, n = 3) => (typeof v === "number" ? v.toFixed(n) : String(v));

// Candidate lower-lid ring points for each eye plus the iris indices. These are
// the standard MediaPipe mesh indices for the lower lid (the eye ring between the
// two corners, going through the bottom). The probe measures every one of them so
// the true lowest point is picked from data, not from memory.
const PROBE = `
(async (PHOTO_URL) => {
  const engine = await window.__e;
  const img = new Image();
  img.src = PHOTO_URL;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const a = await engine.analyzeFace(img);
  const lm = a.landmarks;
  if (!lm || lm.length < 478) return { error: "no iris" };
  const P = (k) => ({ x: lm[k].x * w, y: lm[k].y * h, z: lm[k].z });

  // iris centres + rings
  const li = { c: 468, ring: [469,470,471,472] };
  const ri = { c: 473, ring: [474,475,476,477] };
  // Full lower-lid ring (every point from outer corner to inner corner through
  // the bottom), so the truly lowest point cannot be missed by a short candidate
  // list. MediaPipe's eye ring runs 33->133 (left) / 263->362 (right) along the
  // lower edge through these indices.
  const leftLid  = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
  const rightLid = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
  const leftUpper  = [33, 246, 161, 160, 159, 158, 157, 173];
  const rightUpper = [263, 466, 388, 387, 386, 385, 384, 398];

  const iod = Math.hypot(P(33).x - P(263).x, P(33).y - P(263).y) || 1;

  function irisMetrics(iris, lid, corners) {
    const c = P(iris.c);
    // iris bottom = lowest (max y) of its ring, top = min y; iris height
    const ringY = iris.ring.map((i) => P(i).y);
    const irisTop = Math.min(...ringY, c.y);
    const irisBot = Math.max(...ringY, c.y);
    const irisH = irisBot - irisTop || 1;
    // the geometric lowest lower-lid point in THIS photo
    let lowIdx = lid[0], lowY = P(lid[0]).y;
    for (const i of lid) if (P(i).y > lowY) { lowY = P(i).y; lowIdx = i; }
    // the current implementation's point
    const cur = lid.includes(145) ? 145 : 374;
    // Eye-corner span (outer->inner) as the scale, which is measurable and
    // eyelid-clipped, unlike the synthetic iris ring.
    const eyeWidth = Math.hypot(P(corners[0]).x - P(corners[1]).x, P(corners[0]).y - P(corners[1]).y) || 1;
    // upper lid lowest point
    const upper = lid === leftLid ? leftUpper : rightUpper;
    let upY = P(upper[0]).y;
    for (const i of upper) if (P(i).y > upY) upY = P(i).y;
    // Is the lowest lower-lid point BELOW the iris bottom? (sanity of the
    // iris-anchored approach: should be positive if the iris ring is clipped by
    // the lid; the probe shows it is not.)
    const gapOverIris = (lowY - irisBot) / irisH;
    const curOverIris = (P(cur).y - irisBot) / irisH;
    // Scleral proxy from the eye's own geometry: how far the lowest lower-lid
    // point sits below the IRIS BOTTOM, expressed as a fraction of eye width --
    // a zero-iris alternative scale.
    const gapOverEye = (lowY - irisBot) / eyeWidth;
    const curOverEye = (P(cur).y - irisBot) / eyeWidth;
    return {
      irisH: irisH / iod, eyeW: eyeWidth / iod,
      lowIdx, cur,
      gapLowest: gapOverIris, gapCurrent: curOverIris,
      gapEye: gapOverEye, curEye: curOverEye,
      aperture: (lowY - upY) / eyeWidth,
    };
  }

  return {
    size: [w, h],
    left: irisMetrics(li, leftLid, [33, 133]),
    right: irisMetrics(ri, rightLid, [263, 362]),
    eyeArea: a.eyeArea.score,
    scleral: a.eyeArea.scleralShow,
    irisAvailable: a.eyeArea.irisAvailable,
  };
})`;

console.log("photo                     | eye | lowIdx | cur | gapIris | curIris | gapEye | aperture");
console.log("------------------------------------------------------------------------------------");
for (const file of files) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(file);
  const out = await evaluate(`(${PROBE})(${JSON.stringify(url)})`)
    .catch((e) => ({ error: e.message }));
  if (out.error) { console.log(pad(file.slice(0, 28), 30) + "-- " + out.error); continue; }
  for (const [name, m] of [["L", out.left], ["R", out.right]]) {
    console.log(
      pad(file.slice(0, 26), 27) + "| " + pad(name, 4) + "| " + pad(m.lowIdx, 7) + "| " +
      pad(m.cur, 4) + "| " + pad(f(m.gapLowest), 8) + "| " + pad(f(m.gapCurrent), 8) + "| " +
      pad(f(m.gapEye), 7) + "| " + f(m.aperture)
    );
  }
}

browser.close();
chrome.kill();
