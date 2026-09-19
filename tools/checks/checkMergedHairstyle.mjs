// Verify the merged hairstyle panel: after a scan, #scanHairPanel should be
// visible INSIDE #scanResults and sit ABOVE #scanQualityPanel, the nav no longer
// links to #hairstyle, and the old standalone section is gone. Also reads the
// potential UI so the "MAX" fix is confirmed on screen.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ORIGIN = process.env.ORIGIN || "http://localhost:5502";
const EDGE =
  process.env.CHROME_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PHOTO = process.env.PHOTO || "robert pattinson.jpg";

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
  "--remote-debugging-port=9343",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,2000",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9343/json/version");
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

// Static checks that need no scan.
const staticChecks = await evaluate(`(() => ({
  navHasHairstyleLink: !!document.querySelector('a.nav-link[href="#hairstyle"]'),
  oldSectionGone: !document.getElementById("hairstyle"),
  scanHairPanelExists: !!document.getElementById("scanHairPanel"),
  // DOM order: hair panel must come before the quality panel.
  hairBeforeQuality: (() => {
    const hair = document.getElementById("scanHairPanel");
    const q = document.getElementById("scanQualityPanel");
    if (!hair || !q) return null;
    return hair.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false;
  })(),
}))()`);

// Warm + scan.
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

const afterScan = await evaluate(`(() => {
  const t = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
  const panel = document.getElementById("scanHairPanel");
  const cuts = [...document.querySelectorAll("#scanHairCutList .hair-cut")].map((li) => ({
    name: (li.querySelector(".hair-cut__name") || {}).textContent,
    why: ((li.querySelector(".hair-cut__why") || {}).textContent || "").slice(0, 60),
  }));
  return {
    faceShapeCard: t("scanFaceShape"),
    hairPanelHidden: panel ? panel.classList.contains("hidden") : null,
    hairPanelDisplay: panel ? getComputedStyle(panel).display : null,
    hairShape: t("scanHairShape"),
    hairSummary: (t("scanHairSummary") || "").slice(0, 70),
    cutCount: cuts.length,
    cuts: cuts.slice(0, 4),
    potentialScore: t("scanPotentialScore"),
    potentialTier: t("scanPotentialTier"),
    potentialNote: (t("scanPotentialNote") || "").slice(0, 90),
    overall: t("scanOverallScore"),
  };
})()`);

console.log(JSON.stringify({ photo: PHOTO, staticChecks, afterScan }, null, 1));
browser.close();
edge.kill();
