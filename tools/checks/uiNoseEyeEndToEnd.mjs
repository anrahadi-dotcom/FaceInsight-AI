// End-to-end UI check over Edge/CDP: upload a flagged photo, scan, and read the
// RENDERED nose card, eye panel, strengths card and overall — so the fixes are
// confirmed on screen, not just in the engine.
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
const PHOTO = process.env.PHOTO || "alain_flick.jpg";

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

const edge = spawn(EDGE, [
  "--headless=new",
  "--remote-debugging-port=9339",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,1600",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9339/json/version");
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
const evaluate = async (expr, timeoutMs = 120000) => {
  const res = await page.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
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
// Warm the model so the first detect is not a cold noFace.
await evaluate(
  "window.__engine = import('/js/faceEngine.js?ts=' + Date.now())",
);
await evaluate(
  "(async()=>{await (await window.__engine).ensureLandmarker();})()",
);
await wait(1500);

await evaluate(`(async () => {
  const res = await fetch(${JSON.stringify(ORIGIN + "/test_photos/" + encodeURIComponent(PHOTO))});
  const blob = await res.blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "p.jpg", { type: blob.type || "image/jpeg" }));
  const input = document.querySelector("#imageInput");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
await wait(1500);
await evaluate("document.getElementById('analyze-btn').click()");
await wait(20000);

const ui = await evaluate(`(() => {
  const t = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
  const cards = [...document.querySelectorAll("#scanResults .scan-detail-card")].map((c) => ({
    label: (c.querySelector("h4") || {}).textContent,
    value: (c.querySelector("p") || {}).textContent,
  }));
  const eye = [...document.querySelectorAll("#scanEyePanel .scan-eye-item")].map((i) => ({
    label: (i.querySelector(".scan-eye-item__label") || {}).textContent,
    value: (i.querySelector(".scan-eye-item__value") || {}).textContent,
  }));
  const strengths = [...document.querySelectorAll("#scanStrengthList .scan-strength-item")].map((i) => ({
    name: (i.querySelector(".scan-strength-item__name") || {}).textContent,
    score: (i.querySelector(".scan-strength-item__score") || {}).textContent,
  }));
  const tips = [...document.querySelectorAll("#scanTipsList li")].map((li) => li.textContent.trim());
  return {
    overall: t("scanOverallScore"), tier: t("scanTier"),
    nose: t("scanNose"), noseShape: t("scanNoseShape"),
    eyeAreaValue: t("scanEyeAreaValue"), cards, eye, strengths,
    potential: t("scanPotentialScore"),
    tipsHead: tips.slice(0, 3),
  };
})()`);

console.log(JSON.stringify({ photo: PHOTO, ui }, null, 1));
browser.close();
edge.kill();
