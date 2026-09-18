// Verify the hairstyle section: does it exist, is it wired, does the engine
// produce a plan, and does the section stay independent of the scanner?
export default async function run(page) {
  await page.waitForTimeout(1400);

  // 1. Structure present and isolated from the scanner.
  const structure = await page.evaluate(() => {
    const section = document.getElementById("hairstyle");
    const scanner = document.getElementById("scanner");
    return {
      sectionExists: !!section,
      sectionParentIsMain: section ? section.parentElement.tagName : null,
      insideScanner: section && scanner ? scanner.contains(section) : null,
      // The two must not share any element.
      sharesInput:
        document.getElementById("hairInput") ===
        document.getElementById("imageInput"),
      hasOwnButton: !!document.getElementById("hairAnalyzeBtn"),
      navLink: !!document.querySelector('a.nav-link[href="#hairstyle"]'),
      cssLoaded: [...document.styleSheets].some((s) =>
        (s.href || "").includes("hairstyle.css"),
      ),
      // hair-* elements must not be reachable from the scanner subtree.
      hairElsInsideScanner: scanner
        ? scanner.querySelectorAll('[id^="hair"]').length
        : null,
    };
  });

  // 2. Default state.
  const initial = await page.evaluate(() => {
    const btn = document.getElementById("hairAnalyzeBtn");
    const ph = document.getElementById("hairPlaceholder");
    const res = document.getElementById("hairResults");
    return {
      analyzeDisabled: btn.disabled,
      placeholderVisible: !ph.hidden && getComputedStyle(ph).display !== "none",
      resultsHidden: res.classList.contains("hidden"),
      statusText: document.getElementById("hairStatus").textContent.trim(),
    };
  });

  // 3. The engine path, driven directly with a real photo from test_photos/.
  const engine = await page.evaluate(async () => {
    try {
      const engine = await import("/js/faceEngine.js");
      const hair = await import("/js/hairstyle.js");

      const img = new Image();
      img.src = "/test_photos/jordan_barrett.jpg";
      await img.decode();

      const analysis = await engine.analyzeFrontPhoto(img);
      const plan = hair.recommendHairstyles(analysis);

      return {
        ok: true,
        noFace: !!analysis.noFace,
        frontalMeasured: analysis.frontalMetricsMeasured,
        overallMeasured: analysis.overallMeasured,
        rawFaceShape: analysis.faceShape || null,
        plan: plan
          ? {
              shape: plan.shape,
              label: plan.shapeLabel,
              confidence: plan.confidence,
              cutCount: plan.cuts.length,
              cutNames: plan.cuts.map((c) => c.name),
              hasSummary: !!plan.summary,
              hasAvoid: !!plan.avoid,
            }
          : null,
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error && (error.message || error)),
        name: error && error.name,
      };
    }
  });

  // 4. The pure function, with hand-built analyses. This is the part that must
  //    be right regardless of whether the model loaded in this environment.
  const rules = await page.evaluate(async () => {
    const hair = await import("/js/hairstyle.js");
    const mk = (faceShape, extra = {}) => ({
      faceShape,
      frontalMetricsMeasured: true,
      overallMeasured: true,
      noFace: false,
      ...extra,
    });
    const top = (shape, extra) => {
      const p = hair.recommendHairstyles(mk(shape, extra));
      return p
        ? {
            shape: p.shape,
            cuts: p.cuts.map((c) => c.name),
            conf: p.confidence,
          }
        : null;
    };
    return {
      round: top("Round"),
      oblong: top("Oblong"),
      square: top("Square"),
      heart: top("Heart"),
      diamond: top("Diamond"),
      ovalBalanced: top("Oval · balanced"),
      ovalWideBrow: top("Oval · wide brow"),
      wideJaw: top("Square · wide jaw"),
      // Gates that must return null rather than guess.
      noFaceGate: hair.recommendHairstyles(mk("Round", { noFace: true })),
      unmeasuredGate: hair.recommendHairstyles(
        mk("Round", { frontalMetricsMeasured: false }),
      ),
      nullGate: hair.recommendHairstyles(null),
      normalize: [
        hair.normalizeShape("Oval (balanced)"),
        hair.normalizeShape("Oval · wide brow · tapered jaw"),
        hair.normalizeShape("Nonsense"),
        hair.normalizeShape(undefined),
      ],
    };
  });

  return { structure, initial, engine, rules };
}
