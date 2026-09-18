// Call analyzeFrontPhoto directly (not through the UI) and see exactly what it
// returns / throws when the model cannot load. This pins the blame to the engine
// or to main.js -- no more inference from reading source.
export default async function run(page) {
  await page.waitForTimeout(1500);

  const direct = await page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");

    const img = new Image();
    img.src = "/test_photos/jordan_barrett.jpg";
    await img.decode();

    const started = Date.now();
    try {
      // Race a clock so a hang is visible as TIMED_OUT rather than a dangling await.
      const out = await Promise.race([
        engine
          .analyzeFrontPhoto(img)
          .then((r) => ({ kind: "returned", result: r })),
        new Promise((r) => setTimeout(() => r({ kind: "TIMED_OUT" }), 7000)),
      ]);

      if (out.kind === "TIMED_OUT") {
        return {
          outcome: "hung inside analyzeFrontPhoto",
          elapsedMs: Date.now() - started,
        };
      }

      const r = out.result || {};
      return {
        outcome: "returned",
        elapsedMs: Date.now() - started,
        hasModelLoadError: !!r.modelLoadError,
        modelLoadErrorName: r.modelLoadError ? r.modelLoadError.name : null,
        modelLoadErrorKind: r.modelLoadError ? r.modelLoadError.kind : null,
        noFace: r.noFace,
        landmarksNull: r.landmarks === null,
        frontalMeasured: r.frontalMetricsMeasured,
      };
    } catch (error) {
      return {
        outcome: "threw",
        elapsedMs: Date.now() - started,
        name: error && error.name,
        kind: error && error.kind,
        message: String((error && error.message) || error).slice(0, 120),
      };
    }
  });

  return direct;
}
