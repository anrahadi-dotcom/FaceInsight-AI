// Which ModelLoadError kind does the engine actually produce with every off-site
// request blocked? The message depends on it, and getting "offline" wrong means
// telling the user to reconnect when the real problem is a firewall.
export default async function run(page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http://localhost:5577") ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      return route.continue();
    }
    return route.abort("internetdisconnected");
  });

  await page.reload();
  await page.waitForTimeout(2000);

  const real = await page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");
    try {
      await engine.ensureLandmarker();
      return { threw: false };
    } catch (e) {
      return {
        name: e && e.name,
        kind: e && e.kind,
        message: String((e && e.message) || "").slice(0, 130),
      };
    }
  });

  // And with onLine forced false, to see the offline wording.
  const forced = await page.evaluate(async () => {
    Object.defineProperty(navigator, "onLine", {
      get: () => false,
      configurable: true,
    });
    const engine = await import("/js/faceEngine.js");
    // Reach the classifier through a fresh failure.
    const img = new Image();
    img.src = "/test_photos/jordan_barrett.jpg";
    await img.decode();
    const r = await engine.analyzeFrontPhoto(img);
    return {
      reportedKind: r && r.modelLoadError ? r.modelLoadError.kind : null,
      reportedMessage:
        r && r.modelLoadError
          ? String(r.modelLoadError.message).slice(0, 130)
          : null,
    };
  });

  return { blockedOnly: real, withOnLineFalse: forced };
}
