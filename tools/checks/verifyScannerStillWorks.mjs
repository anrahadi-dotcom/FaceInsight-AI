// Regression: did rewriting faceEngine's CDN imports break the SCANNER?
//
// This is the highest-stakes check of the session -- the import refactor touched
// 12 references across the engine, and a mistake there takes down the app's main
// feature. Checks the whole chain: module loads, every exported symbol is a
// function, the model actually initialises, and a real scan completes.
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.waitForTimeout(2000);

  // 1. Does the app's own JS still run at all? (body:not(.no-js) is set by main.js)
  const appAlive = await page.evaluate(() => ({
    noJsClassRemoved: !document.body.classList.contains("no-js"),
    navWiredUp: !!document.getElementById("navToggle"),
    analyzeBtnFound: !!document.getElementById("analyze-btn"),
  }));

  // 2. Every symbol main.js imports from the engine must still exist. A typo in
  //    the refactor would surface here as undefined rather than at click time.
  const symbols = await page.evaluate(async () => {
    try {
      const engine = await import("/js/faceEngine.js");
      const expected = [
        "analyzeFrontPhoto",
        "analyzeSidePhoto",
        "combineAnalysis",
        "tierFor",
        "tiersFor",
        "ModelLoadError",
      ];
      const report = {};
      for (const name of expected) {
        const value = engine[name];
        report[name] =
          typeof value === "function" ? "ok" : "MISSING:" + typeof value;
      }
      return { loaded: true, report };
    } catch (error) {
      return {
        loaded: false,
        error: String(error && (error.message || error)),
      };
    }
  });

  // 3. Does the model actually initialise through the NEW dynamic imports?
  //    This is the part the refactor could most plausibly have broken.
  const modelInit = await page.evaluate(async () => {
    try {
      const engine = await import("/js/faceEngine.js");
      const lm = await engine.ensureLandmarker();
      return { ok: !!lm, threw: false };
    } catch (error) {
      return {
        ok: false,
        threw: true,
        isModelLoad: error instanceof Error && error.name === "ModelLoadError",
        kind: error && error.kind ? error.kind : null,
        message: String((error && error.message) || error).slice(0, 120),
      };
    }
  });

  // 4. End-to-end: drive the REAL scan UI with a real photo and see it through.
  const scan = await page.evaluate(async () => {
    const res = await fetch("/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
    const input = document.getElementById("imageInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { fileSet: input.files.length === 1 };
  });

  await page.waitForTimeout(1200);
  await page.click("#analyze-btn");
  // The engine is warm by now, so a full scan should finish well inside this.
  await page.waitForTimeout(9000);

  const scanResult = await page.evaluate(() => {
    const status = document.getElementById("scan-status");
    const results = document.getElementById("scanResults");
    const btn = document.getElementById("analyze-btn");
    return {
      statusText: status ? status.textContent.trim().slice(0, 150) : null,
      statusVisible: status ? status.classList.contains("is-visible") : null,
      resultsShown: results ? !results.classList.contains("hidden") : null,
      resultsDisplay: results ? getComputedStyle(results).display : null,
      buttonReEnabled: btn ? !btn.disabled : null,
      buttonLabel: btn ? btn.textContent.trim() : null,
      loadingHidden:
        getComputedStyle(document.getElementById("loading")).display === "none",
    };
  });

  return { appAlive, symbols, modelInit, scan, scanResult, errors };
}
