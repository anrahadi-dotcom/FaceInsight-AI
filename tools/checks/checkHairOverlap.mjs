// Screenshot the SCAN RESULT region at a normal desktop viewport so the reported
// haircut-panel overlap is visible, and report any element that overflows its box.
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
const PHOTO = process.env.PHOTO || "EliasDePoot.jpg";

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
  "--remote-debugging-port=9370",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,1000",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9370/json/version");
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
const evaluate = async (expr, t = 120000) => {
  const res = await page.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: t,
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

await evaluate(
  `window.__engine = import(${JSON.stringify(ORIGIN + "/js/faceEngine.js")})`,
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
await wait(18000);

// Scroll hair panel to top of the viewport and screenshot the visible screen.
await evaluate(
  "document.getElementById('scanHairPanel').scrollIntoView({block:'start'})",
);
await wait(700);
const shot = await page.send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});
fs.writeFileSync(
  path.join(root, "tools", "_hairui.png"),
  Buffer.from(shot.data, "base64"),
);

// Detector: elements whose scrollWidth exceeds clientWidth (horizontal overflow)
// or whose children extend past their own box -- both read as "overlapping" to a
// user. Scanned within the hair panel.
const overflow = await evaluate(`(() => {
  const panel = document.getElementById("scanHairPanel");
  const out = [];
  panel.querySelectorAll("*").forEach((el) => {
    const cs = getComputedStyle(el);
    const overX = el.scrollWidth > el.clientWidth + 1;
    const overY = el.scrollHeight > el.clientHeight + 1;
    if ((overX || overY) && cs.overflow === "visible") {
      out.push({ tag: el.tagName, cls: (typeof el.className === "string" ? el.className : "").slice(0,40), overX, overY, sw: el.scrollWidth, cw: el.clientWidth });
    }
  });
  return out.slice(0, 15);
})()`);

console.log(JSON.stringify({ shot: "tools/_hairui.png", overflow }, null, 1));
browser.close();
edge.kill();
