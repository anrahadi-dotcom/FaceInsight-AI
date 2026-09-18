// The one question that settles this: what does analyzeFrontPhoto's RESULT
// actually contain on the failing path? Every previous attempt assumed the shape
// of this object. Measure it instead.
export default async function run(page) {
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");
    const res = await fetch("/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();

    const r = await engine.analyzeFrontPhoto(img);
    return {
      allKeys: r ? Object.keys(r) : null,
      isFallback: r ? r.isFallback : "NO KEY",
      isFallbackType: r ? typeof r.isFallback : null,
      noFace: r ? r.noFace : "NO KEY",
      noFaceType: r ? typeof r.noFace : null,
      hasModelLoadErrorKey: r ? "modelLoadError" in r : null,
      modelLoadErrorVALUE: r ? String(r.modelLoadError) : null,
      modelLoadErrorIsNull: r ? r.modelLoadError === null : null,
      modelLoadErrorType: r ? typeof r.modelLoadError : null,
      landmarksType: r
        ? r.landmarks === null
          ? "null"
          : Array.isArray(r.landmarks)
            ? "array"
            : typeof r.landmarks
        : null,
      frontalMetricsMeasured: r ? r.frontalMetricsMeasured : "NO KEY",
      overallMeasured: r ? r.overallMeasured : "NO KEY",
    };
  });
}
