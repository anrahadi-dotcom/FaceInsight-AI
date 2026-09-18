// Dev-only visual diagnostic: draws the soft-tissue scanner's measurement band
// (jaw corners -> chin) and the skin silhouette it finds, then screenshots the
// result. Looking at the overlay is the only reliable way to tell whether the
// scan is measuring the jaw or just finding hair/background.
//
//   python -m http.server 5501
//   node tools/softTissueOverlay.mjs "download (6).jpeg"
// Writes tools/out/<photo>.png
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PHOTO = process.argv[2] || "download (6).jpeg";
const OUT = path.join(here, "out");
fs.mkdirSync(OUT, { recursive: true });

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

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9226", "--no-first-run",
  "--disable-gpu", "--use-gl=swiftshader", "--window-size=1400,1100", "about:blank"]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try { wsUrl = (await (await fetch("http://127.0.0.1:9226/json/version")).json()).webSocketDebuggerUrl; break; }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
const browser = cdpConnect(wsUrl);
await browser.ready;
const { targetId } = await browser.send("Target.createTarget", { url: ORIGIN + "/index.html" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const send = (m, p) => browser.send(m, p, sessionId);
await send("Runtime.enable");
await send("Page.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression, timeout = 90000) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
};
for (let i = 0; i < 80; i++) {
  if ((await evaluate("document.readyState")) === "complete") break;
  await wait(250);
}

const url = ORIGIN + "/test_photos/" + encodeURIComponent(PHOTO);
const info = await evaluate(`(async () => {
  const engine = await import('/js/faceEngine.js');
  const img = new Image();
  img.src = ${JSON.stringify(url)};
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const a = await engine.analyzeFace(img);

  // Rebuild the same canvas the scorer uses and paint the measurement band.
  const K = {
    SCALE_LEFT: 33, SCALE_RIGHT: 263, JAW_LEFT: 132, JAW_RIGHT: 361,
    CHEEK_LEFT: 116, CHEEK_RIGHT: 345, MIDLINE_BOTTOM: 152,
  };
  const P = (k) => ({ x: a.landmarks[k].x * w, y: a.landmarks[k].y * h });
  const d = (i, j) => Math.hypot(P(i).x - P(j).x, P(i).y - P(j).y);

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const jawL = P(K.JAW_LEFT), jawR = P(K.JAW_RIGHT), chin = P(K.MIDLINE_BOTTOM);
  const jawHalf = d(K.JAW_LEFT, K.JAW_RIGHT) / 2;
  const cx = (jawL.x + jawR.x) / 2, jawY = (jawL.y + jawR.y) / 2;
  const chinX = chin.x, chinY = chin.y;

  // jaw corners + chin + cheek line
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ff2d55';
  ctx.beginPath(); ctx.arc(jawL.x, jawL.y, 12, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(jawR.x, jawR.y, 12, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#00e5ff';
  ctx.beginPath(); ctx.arc(chinX, chinY, 12, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#ffd400';
  for (const v of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, jawY); ctx.lineTo(cx + v * jawHalf * 1.8, chinY);
    ctx.stroke();
  }
  // sample rows
  ctx.strokeStyle = 'rgba(0,255,90,0.9)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const y = jawY + (chinY - jawY) * t;
    const predicted = jawHalf * (1 - t * 0.45);
    ctx.beginPath();
    ctx.moveTo(cx - predicted, y); ctx.lineTo(cx + predicted, y); ctx.stroke();
  }
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText('chinFill=' + (a.faceFat.softTissue ? a.faceFat.softTissue.chinFill.toFixed(3) : 'n/a') +
    '  soft=' + (a.faceFat.softTissue ? a.faceFat.softTissue.score.toFixed(0) : 'n/a') +
    '  bone=' + a.faceFat.boneScore.toFixed(0) + '  fat=' + a.faceFat.score.toFixed(0), 24, 44);
  ctx.fillText('overall=' + a.overall.toFixed(1) + '  ' + a.tier, 24, 84);
  return { dataUrl: cv.toDataURL('image/png'), soft: a.faceFat.softTissue, jawHalfPx: jawHalf, size: [w, h] };
})()`);

console.log("size:", info.size, "jawHalfPx:", info.jawHalfPx.toFixed(1));
console.log("soft:", JSON.stringify(info.soft));
const b64 = info.dataUrl.split(",")[1];
fs.writeFileSync(path.join(OUT, PHOTO.replace(/[^a-z0-9]+/gi, "_") + ".png"), Buffer.from(b64, "base64"));
console.log("wrote", path.join(OUT, PHOTO.replace(/[^a-z0-9]+/gi, "_") + ".png"));

browser.close();
chrome.kill();
