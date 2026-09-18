// Prove the hang: does ensureLandmarker() ever settle when the model cannot load?
export default async function run(page) {
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");
    const started = Date.now();

    // Race the load against a 6s clock. If the timer wins, the load promise
    // never settled -- which is the hang, expressed as a measurement.
    const outcome = await Promise.race([
      engine
        .ensureLandmarker()
        .then((lm) => ({ settled: "resolved", hasModel: !!lm }))
        .catch((e) => ({
          settled: "rejected",
          name: e && e.name,
          kind: e && e.kind,
          message: String((e && e.message) || e).slice(0, 100),
        })),
      new Promise((r) => setTimeout(() => r({ settled: "TIMED_OUT" }), 6000)),
    ]);

    return {
      outcome,
      elapsedMs: Date.now() - started,
      navigatorOnline: navigator.onLine,
    };
  });

  return result;
}
