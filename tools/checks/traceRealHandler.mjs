// Instrument the REAL handler: capture what main.js sees at each stage, by
// observing the DOM state and re-deriving the engine result in parallel.
//
// The previous attempts all instrumented the wrong scope. This one watches the
// actual click through to the actual DOM, and separately asks the engine what it
// returns for the same preview element the handler used.
export default async function run(page) {
  const trace = [];
  page.on("console", (m) =>
    trace.push(`${m.type()}: ${m.text().slice(0, 100)}`),
  );
  page.on("pageerror", (e) => trace.push("PAGEERROR: " + (e.message || e)));

  await page.waitForTimeout(1500);

  // Set the file the normal way.
  await page.evaluate(async () => {
    const res = await fetch("/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
    const input = document.getElementById("imageInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(800);

  // Ask the engine directly, using the SAME preview element main.js will use.
  const engineOnPreview = await page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");
    const preview = document.getElementById("preview");
    try {
      const r = await engine.analyzeFrontPhoto(preview);
      return {
        threw: false,
        hasModelLoadError:
          r && "modelLoadError" in r ? !!r.modelLoadError : "NO FIELD",
        noFace: r ? r.noFace : null,
        landmarksIsNull: r ? r.landmarks === null : null,
        frontalMeasured: r ? r.frontalMetricsMeasured : null,
        overallMeasured: r ? r.overallMeasured : null,
        keyCount: r ? Object.keys(r).length : null,
      };
    } catch (e) {
      return { threw: true, name: e && e.name, kind: e && e.kind };
    }
  });

  // Now click and watch.
  await page.click("#analyze-btn");
  const states = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(700);
    const snap = await page.evaluate(() => {
      const status = document.getElementById("scan-status");
      const btn = document.getElementById("analyze-btn");
      return {
        disabled: btn.disabled,
        statusLen: status.textContent.length,
        status: status.textContent.trim().slice(0, 70),
        classes: status.className,
        loading: getComputedStyle(document.getElementById("loading")).display,
      };
    });
    states.push({ t: i, ...snap });
    if (!snap.disabled) break;
  }

  return { engineOnPreview, states, trace: trace.slice(0, 10) };
}
