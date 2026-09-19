// Probe several candidate "cheekbone" landmark pairs to find which one actually
// reads widest at the mid-face (the definition of a diamond/zygomatic face).
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

const files = [
  "robert pattinson.jpg",
  "Alain Delon.jpg",
  "adriana_lima.jpg",
  "FatGuy.jpeg",
];
const edge = spawn(EDGE, [
  "--headless=new",
  "--remote-debugging-port=9342",
  "--no-first-run",
  "--disable-gpu",
  "--use-gl=swiftshader",
  "--window-size=1280,900",
  "about:blank",
]);
let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9342/json/version");
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
const evaluate = async (expr, t = 90000) => {
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
  "window.__engine = import('/js/faceEngine.js?ts=' + Date.now())",
);
await evaluate(
  "(async()=>{await (await window.__engine).ensureLandmarker();})()",
);
await wait(1500);

const rows = [];
for (const f of files) {
  const url = ORIGIN + "/test_photos/" + encodeURIComponent(f);
  const src = `(async () => {
    const engine = await window.__engine;
    const img = new Image(); img.src = ${JSON.stringify(url)}; await img.decode();
    const a = await engine.analyzeFace(img);
    if (a.noFace) return { file: ${JSON.stringify(f)}, skip: true };
    const w = img.naturalWidth, h = img.naturalHeight;
    const P = (i) => ({ x: a.landmarks[i].x * w, y: a.landmarks[i].y * h });
    const d = (i, j) => Math.hypot(P(i).x - P(j).x, P(i).y - P(j).y);
    const pairs = {
      "116/345": d(116,345), "123/352": d(123,352), "205/425": d(205,425),
      "50/280": d(50,280), "234/454": d(234,454), "132/361": d(132,361),
      "70/300": d(70,300), "93/323": d(93,323), "147/376": d(147,376),
    };
    // Normalise each by the temple span so they can be compared across photos.
    const temple = d(234,454);
    const norm = {};
    for (const k in pairs) norm[k] = +(pairs[k]/temple).toFixed(3);
    return { file: ${JSON.stringify(f)}, y116: P(116).y.toFixed(0), y345: P(345).y.toFixed(0),
             y234: P(234).y.toFixed(0), y205: P(205).y.toFixed(0), y132: P(132).y.toFixed(0),
             faceTop: P(10).y.toFixed(0), faceBot: P(152).y.toFixed(0), norm };
  })()`;
  rows.push(await evaluate(src).catch((e) => ({ file: f, error: e.message })));
}
console.log(JSON.stringify(rows, null, 1));
browser.close();
edge.kill();
