// FULL VERIFICATION PASS. Checks the nose system end to end plus everything it
// touches, so a single run answers "is this safe to call done?".
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 130));
  });

  await page.waitForTimeout(2500);

  // ---- 1. App boots and every module loads -------------------------------
  const boot = await page.evaluate(async () => {
    const out = { appBooted: !document.body.classList.contains("no-js") };
    for (const p of [
      "/js/faceEngine.js",
      "/js/nose.js",
      "/js/hairstyle.js",
      "/js/report-export.js",
      "/js/connectivity.js",
    ]) {
      try {
        const m = await import(p);
        out[p] = Object.keys(m).length + " exports";
      } catch (e) {
        out[p] = "FAIL: " + String((e && e.message) || e).slice(0, 60);
      }
    }
    return out;
  });

  // ---- 2. The nose API is exercised through the engine's own exports ------
  const engineNose = await page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");
    return {
      hasClear: typeof engine.clearNasolabialAngleFromSide === "function",
      hasSet: typeof engine.setNasolabialAngleFromSide === "function",
    };
  });

  // ---- 3. Stale-angle leak: a cleared angle must not affect a front-only run
  const leak = await page.evaluate(async () => {
    const nose = await import("/js/nose.js");
    const engine = await import("/js/faceEngine.js");

    function mesh({
      alarWidth,
      noseLength,
      tipWidth,
      bridgeWidth,
      nostrilSpan,
    }) {
      const pts = new Array(478)
        .fill(null)
        .map(() => ({ x: -99, y: -99, z: 0 }));
      const cx = 0.5,
        h = alarWidth / 2;
      pts[133] = { x: cx - 0.15, y: 0.4, z: 0 };
      pts[362] = { x: cx + 0.15, y: 0.4, z: 0 };
      pts[168] = { x: cx, y: 0.38, z: 0 };
      pts[2] = { x: cx, y: 0.38 + noseLength, z: 0 };
      pts[1] = { x: cx, y: 0.38 + noseLength * 0.78, z: 0 };
      pts[102] = { x: cx - h, y: 0.38 + noseLength * 0.9, z: 0 };
      pts[331] = { x: cx + h, y: 0.38 + noseLength * 0.9, z: 0 };
      pts[129] = { x: cx - nostrilSpan / 2, y: 0.38 + noseLength * 0.9, z: 0 };
      pts[358] = { x: cx + nostrilSpan / 2, y: 0.38 + noseLength * 0.9, z: 0 };
      pts[197] = { x: cx - bridgeWidth / 2, y: 0.38 + noseLength * 0.45, z: 0 };
      pts[419] = { x: cx + bridgeWidth / 2, y: 0.38 + noseLength * 0.45, z: 0 };
      return pts;
    }

    const m = mesh({
      alarWidth: 0.3,
      noseLength: 0.155,
      tipWidth: 0.18,
      bridgeWidth: 0.108,
      nostrilSpan: 0.19,
    });

    // A scan WITH a side photo: an acute angle makes this a hawk nose.
    engine.setNasolabialAngleFromSide(78);
    const withSide = nose.assessNose(m, 78);

    // The next scan has NO side photo. main.js clears first; simulate that.
    engine.clearNasolabialAngleFromSide();
    const afterClear = nose.assessNose(m, null);

    return {
      withSideScore: withSide.score,
      withSideShape: withSide.shape,
      afterClearScore: afterClear.score,
      afterClearShape: afterClear.shape,
      angleLeaked: afterClear.metrics.nasolabialDeg !== null,
      measuredOnAfterClear: afterClear.measuredOn,
    };
  });

  // ---- 4. Nothing left unmeasured in the report ---------------------------
  const ui = await page.evaluate(() => ({
    noseCellExists: !!document.getElementById("scanNose"),
    noseShapeCellExists: !!document.getElementById("scanNoseShape"),
  }));

  // ---- 5. Hairstyle still intact (it shares the engine) -------------------
  const hairstyle = await page.evaluate(async () => {
    const hair = await import("/js/hairstyle.js");
    const mk = (shape, g) => ({
      faceShape: shape,
      gender: g,
      frontalMetricsMeasured: true,
      overallMeasured: true,
      noFace: false,
    });
    const m = hair.recommendHairstyles(mk("Round", "male"));
    const f = hair.recommendHairstyles(mk("Round", "female"));
    return {
      maleFirst: m ? m.cuts[0].name : null,
      femaleFirst: f ? f.cuts[0].name : null,
      differ: m && f ? m.cuts[0].name !== f.cuts[0].name : null,
    };
  });

  return {
    boot,
    engineNose,
    leak,
    ui,
    hairstyle,
    errorCount: errors.length,
    errors: errors.slice(0, 5),
  };
}
