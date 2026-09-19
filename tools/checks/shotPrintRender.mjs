// Force print-media emulation via CDP, build the report, and screenshot it — the
// real check that "Save as PDF" would produce the report and not a blank page.
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
  "--remote-debugging-port=9338",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1200,1600",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9338/json/version");
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
const evaluate = async (expr, timeoutMs = 60000) => {
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

// Populate a report and build the print block (print() stubbed).
const built = await evaluate(`(async () => {
  window.print = () => {};
  const results = document.getElementById("scanResults");
  results.classList.remove("hidden"); results.classList.add("is-visible"); results.style.display = "flex";
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set("scanOverallScore", "8.4 / 10"); set("scanTier", "Chad Lite");
  set("scanVerdictNote", "A strong, balanced front reading.");
  set("scanSymmetryScore", "72.4%"); set("scanGoldenScore", "88.1%");
  set("scanEyeAreaValue", "84%"); set("scanPotentialScore", "9.1 / 10");
  const cards = document.querySelectorAll("#scanResults .scan-detail-card");
  const labels = ["Nose", "Skin quality", "Jawline", "Canthal tilt"];
  const values = ["78 / 100 (Snub / Button)", "94%", "92.5%", "4.2 deg"];
  cards.forEach((c,i)=>{ const h=c.querySelector("h4"), p=c.querySelector("p");
    if(h&&labels[i])h.textContent=labels[i]; if(p&&values[i])p.textContent=values[i]; });
  const mod = await import('/js/report-export.js?ts=' + Date.now());
  const started = mod.printScanReport();
  return { started, bodyClass: document.body.classList.contains("printing-report"),
           blockPresent: !!document.querySelector("body > .print-report") };
})()`);

// Switch the page to print media and take a screenshot.
await page.send("Emulation.setEmulatedMedia", { media: "print" });
await wait(400);
const shot = await page.send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
});
const outPath = path.join(root, "tools", "_print_shot.png");
fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));

// Ask the DOM what is visible under print media.
const visible = await evaluate(`(() => {
  const block = document.querySelector(".print-report");
  const others = [...document.body.children].filter(el => !el.classList.contains("print-report") && getComputedStyle(el).display !== "none");
  return {
    blockDisplay: block ? getComputedStyle(block).display : null,
    blockChars: block ? block.textContent.replace(/\\s+/g,' ').trim().length : 0,
    blockHasNose: block ? /Nose/.test(block.textContent) : false,
    othersVisible: others.length,
  };
})()`);

console.log(JSON.stringify({ built, visible, shot: outPath }, null, 1));
browser.close();
edge.kill();
