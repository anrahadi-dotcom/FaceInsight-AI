// Find the DEAD interactivity the user reported: scan a photo, then click every
// interactive element in the haircut panel and report which ones do anything.
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
  "--remote-debugging-port=9347",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,2400",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9347/json/version");
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
const errs = [];
page.send("Runtime.enable");
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

// List every interactive element inside the hair panel + its current state.
const inventory = await evaluate(`(() => {
  const panel = document.getElementById("scanHairPanel");
  if (!panel) return { error: "no panel" };
  const els = [...panel.querySelectorAll("button, a, input, select, [role=button], [tabindex]")];
  return {
    panelHidden: panel.classList.contains("hidden"),
    cutCount: panel.querySelectorAll(".hair-cut").length,
    interactive: els.map((e) => ({
      tag: e.tagName.toLowerCase(),
      id: e.id || null,
      cls: e.className || null,
      text: (e.textContent || "").trim().slice(0, 30),
      disabled: !!e.disabled,
      pointerEvents: getComputedStyle(e).pointerEvents,
      cursor: getComputedStyle(e).cursor,
      inDom: document.body.contains(e),
    })),
  };
})()`);

// Click each length button and confirm the list changes.
const before = await evaluate(
  `[...document.querySelectorAll("#scanHairCutList .hair-cut__name")].map(n=>n.textContent)`,
);
await evaluate(
  `document.querySelector('.scan-hair__len-btn[data-length="long"]').click()`,
);
await wait(500);
const after = await evaluate(
  `[...document.querySelectorAll("#scanHairCutList .hair-cut__name")].map(n=>n.textContent)`,
);

// Click the FIRST haircut card and confirm it now OPENS (the reported dead click).
const cardBefore = await evaluate(`(() => {
  const c = document.querySelector("#scanHairCutList .hair-cut");
  const d = c.querySelector(".hair-cut__detail");
  return { detailHidden: d.hidden, isOpen: c.classList.contains("is-open"), aria: c.getAttribute("aria-expanded"), cursor: getComputedStyle(c).cursor };
})()`);
await evaluate(`document.querySelector("#scanHairCutList .hair-cut").click()`);
await wait(300);
const cardAfter = await evaluate(`(() => {
  const c = document.querySelector("#scanHairCutList .hair-cut");
  const d = c.querySelector(".hair-cut__detail");
  return { detailHidden: d.hidden, isOpen: c.classList.contains("is-open"), aria: c.getAttribute("aria-expanded"), detailText: (d.textContent || "").slice(0, 60) };
})()`);

console.log(
  JSON.stringify(
    {
      inventory,
      before,
      after,
      lengthChanged: JSON.stringify(before) !== JSON.stringify(after),
      cardBefore,
      cardAfter,
    },
    null,
    1,
  ),
);
browser.close();
edge.kill();
