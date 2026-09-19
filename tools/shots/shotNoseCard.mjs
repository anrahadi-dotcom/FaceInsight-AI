// Render the nose card with a real assessment and screenshot it, so the UI is
// verified visually and not just structurally.
export default async function run(page) {
  await page.waitForTimeout(1500);

  const rendered = await page.evaluate(async () => {
    const nose = await import("/js/nose.js");

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

    const r = nose.assessNose(
      mesh({
        alarWidth: 0.3,
        noseLength: 0.155,
        tipWidth: 0.18,
        bridgeWidth: 0.108,
        nostrilSpan: 0.19,
      }),
      93,
    );

    // Reveal the report panel and write the nose cells exactly as main.js does.
    const results = document.getElementById("scanResults");
    results.classList.remove("hidden");
    results.classList.add("is-visible");
    results.style.display = "flex";

    const cell = document.getElementById("scanNose");
    const shape = document.getElementById("scanNoseShape");
    cell.textContent = r.score + " \u00B7 " + r.tierLabel;
    shape.textContent =
      r.shape + " \u2014 " + r.why + " (" + r.measuredOn + ")";

    // Populate a couple of neighbours so the grid looks real.
    const set = (id, t) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    };
    set("scanOverallScore", "7.8 / 10");
    set("scanTier", "High");
    set("scanJawline", "72%");
    set("scanEyeShape", "Almond (68%)");

    await new Promise((r) => setTimeout(r, 200));
    return {
      score: r.score,
      tier: r.tierLabel,
      shape: r.shape,
      evidence: r.evidence,
      cellText: cell.textContent,
      shapeText: shape.textContent.slice(0, 120),
    };
  });

  await page.evaluate(() => {
    const el = document.getElementById("scanNose");
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 300);
  });
  await page.waitForTimeout(700);
  await page.screenshot({
    path: "tools/shots/_nose-card.png",
    fullPage: false,
  });

  return rendered;
}
