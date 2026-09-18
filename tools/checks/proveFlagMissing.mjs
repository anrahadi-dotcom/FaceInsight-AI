// Why is modelLoadFailure null? Measure what analyzeFrontPhoto actually returns
// through the SAME withTimeout path main.js uses.
export default async function run(page) {
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");

    const img = new Image();
    img.src = "/test_photos/jordan_barrett.jpg";
    await img.decode();

    let raw;
    let threw = null;
    try {
      raw = await engine.analyzeFrontPhoto(img);
    } catch (e) {
      threw = {
        name: e && e.name,
        kind: e && e.kind,
        msg: String((e && e.message) || e).slice(0, 80),
      };
    }

    return {
      threw,
      returnedSomething: raw !== undefined && raw !== null,
      keys: raw ? Object.keys(raw).slice(0, 20) : null,
      hasModelLoadErrorField: raw ? "modelLoadError" in raw : null,
      modelLoadErrorTruthy: raw && raw.modelLoadError ? true : false,
      modelLoadErrorKind:
        raw && raw.modelLoadError ? raw.modelLoadError.kind : null,
      modelLoadErrorMessage:
        raw && raw.modelLoadError
          ? String(raw.modelLoadError.message).slice(0, 90)
          : null,
      noFace: raw ? raw.noFace : null,
      landmarks: raw
        ? raw.landmarks === null
          ? "null"
          : typeof raw.landmarks
        : null,
    };
  });
}
