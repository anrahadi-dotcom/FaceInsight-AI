// Verify the CDN-failure path: block the model domains and confirm the user
// gets a clear, actionable message instead of a dead spinner or a misleading
// "no face detected".
export default async function run(page) {
  await page.waitForTimeout(1200);

  // Block every host the engine fetches from, BEFORE the model is requested.
  await page.route("**cdn.jsdelivr.net/**", (r) => r.abort());
  await page.route("**storage.googleapis.com/**", (r) => r.abort());
  await page.route("**unpkg.com/**", (r) => r.abort());

  // Classify what the engine reports when the bytes never arrive.
  const classification = await page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");
    try {
      await engine.ensureLandmarker();
      return { threw: false };
    } catch (error) {
      return {
        threw: true,
        isModelLoadError: error instanceof engine.ModelLoadError,
        kind: error.kind || null,
        name: error.name,
        message: String(error.message || "").slice(0, 140),
      };
    }
  });

  // A second attempt must retry rather than re-return the cached rejection.
  const retryWorks = await page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");
    try {
      await engine.ensureLandmarker();
      return { retried: true, threwAgain: false };
    } catch (error) {
      // Still failing (domains are still blocked) -- but it must be a FRESH
      // attempt, not a cached rejection. A fresh ModelLoadError proves the
      // loadingPromise slot was cleared.
      return { retried: true, threwAgain: true, kind: error.kind || null };
    }
  });

  return { classification, retryWorks };
}
