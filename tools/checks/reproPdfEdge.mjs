// End-to-end PDF-button check over the WORKING Edge+CDP path: run a real scan
// through the UI, click "Download PDF", and confirm the print block is built and
// window.print() is called.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
const EDGE =
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
  "--remote-debugging-port=9335",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,1400",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9335/json/version");
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

// Stub print and capture the block.
await evaluate(`
  window.__printCalls = 0; window.__block = null;
  window.print = () => {
    window.__printCalls++;
    const pr = document.querySelector(".print-report");
    window.__block = pr ? {
      sections: [...pr.querySelectorAll("h2")].map(h => h.textContent.trim()),
      rows: pr.querySelectorAll(".print-dl dt").length,
      hasClass: document.body.classList.contains("printing-report"),
    } : "NO .print-report IN DOM";
  };
  true;
`);

// Warm the model (its lazy load returns noFace on a cold call).
await evaluate("window.__engine = import('/js/faceEngine.js')");
await evaluate(
  "(async()=>{await (await window.__engine).ensureLandmarker();})()",
);
await wait(1500);

// Upload + scan through the real UI.
await evaluate(`(async () => {
  const res = await fetch(${JSON.stringify(ORIGIN + "/test_photos/jordan_barrett.jpg")});
  const blob = await res.blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
  const input = document.querySelector("#imageInput");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
await wait(1500);
await evaluate("document.getElementById('analyze-btn').click()");
await wait(20000);

const state = await evaluate(`({
  scanResultsHidden: document.getElementById("scanResults").classList.contains("hidden"),
  overall: document.getElementById("scanOverallScore").textContent,
  tier: document.getElementById("scanTier").textContent,
  nose: document.getElementById("scanNose") ? document.getElementById("scanNose").textContent : null,
  btnDisplay: getComputedStyle(document.getElementById("downloadReportBtn")).display,
})`);

// Click Download PDF.
await evaluate("document.getElementById('downloadReportBtn').click()");
await wait(600);
const after = await evaluate(`({
  printCalls: window.__printCalls,
  block: window.__block,
  toast: (() => { const t = document.querySelector(".toast, #toast, [class*=toast]"); return t ? t.textContent.trim().slice(0,120) : null; })(),
})`);

console.log(JSON.stringify({ state, after }, null, 1));
browser.close();
edge.kill();
