// Dev-only smoke test: loads the real app in a headless browser, feeds it a
// photo through the actual file-input the user uses, and reports what the UI
// ended up showing plus any console errors. This is the "did my change actually
// work in the page" check -- run it after touching the scorer.
//
//   python -m http.server 5501
//   node tools/uiSmoke.mjs            (CHROME_PATH / ORIGIN override as needed)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PHOTO = process.env.PHOTO || "test_photos\\Winter Haircuts for Plus Size Women 2025–2026 _ Natural Mid-Length Shine.jpeg";

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

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9223", "--no-first-run",
  "--disable-gpu", "--use-gl=swiftshader", "--window-size=1440,1000", "about:blank"]);
let wsUrl;
for (let i = 0; i < 40; i++) {
  try { wsUrl = (await (await fetch("http://127.0.0.1:9223/json/version")).json()).webSocketDebuggerUrl; break; }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
const browser = cdpConnect(wsUrl);
await browser.ready;
const { targetId } = await browser.send("Target.createTarget", { url: ORIGIN + "/index.html" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const send = (m, p) => browser.send(m, p, sessionId);
await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");

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

// Feed the photo through the real <input type="file"> the user clicks.
const fileInput = await evaluate(`(async () => {
  const el = document.querySelector('input[type=file]');
  if (!el) return 'NO FILE INPUT';
  const res = await fetch(${JSON.stringify(ORIGIN + "/" + PHOTO.replace(/\\/g, "/"))});
  const blob = await res.blob();
  const file = new File([blob], "photo.jpeg", { type: blob.type || "image/jpeg" });
  const dt = new DataTransfer();
  dt.items.add(file);
  el.files = dt.files;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "dispatched";
})()`);
console.log("file input:", fileInput);

// Loading the file only arms the button -- the scan runs on the click.
await wait(600);
const clicked = await evaluate(`(() => {
  const candidates = Array.from(document.querySelectorAll('button, a'));
  const btn = candidates.find((b) => /analyze/i.test(b.textContent || ""));
  if (!btn) return "NO ANALYZE BUTTON: " + candidates.map((b) => b.textContent.trim()).join(" | ");
  btn.click();
  return "clicked: " + btn.textContent.trim();
})()`);
console.log("analyze:", clicked);

let snapshot = null;
for (let i = 0; i < 60; i++) {
  await wait(500);
  snapshot = await evaluate(`(() => {
    const t = (id) => (document.getElementById(id) || {}).textContent;
    const results = document.getElementById('scanResults');
    return {
      visible: !!(results && results.classList.contains('is-visible')),
      overall: t('scanOverallScore'), tier: t('scanTier'),
      symmetry: t('scanSymmetryScore'), golden: t('scanGoldenScore'),
      harmony: t('scanHarmony'), skinQuality: t('scanSkinQuality'),
      clarity: t('scanSkinAcne'), faceFat: t('scanFaceFat'),
      jawline: t('scanJawline'), eye: t('scanEyeShape'), shape: t('scanFaceShape'),
      profile: t('scanProfile'),
      tips: Array.from(document.querySelectorAll('#scanTipsList li')).map((li) => li.textContent),
    };
  })()`);
  if (snapshot && snapshot.visible) break;
}

console.log(JSON.stringify(snapshot, null, 2));
const errs = await evaluate("window.__errs || 0");
console.log("page errors captured:", errs);

browser.close();
chrome.kill();
