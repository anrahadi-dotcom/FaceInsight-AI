// Verify the detail grid tiles cleanly with the nose card added. A hole in the
// grid is the specific thing being checked: cards must fill whole rows.
export default async function run(page) {
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const nose = await import("/js/nose.js");

    function mesh() {
      const pts = new Array(478)
        .fill(null)
        .map(() => ({ x: -99, y: -99, z: 0 }));
      const cx = 0.5;
      pts[133] = { x: cx - 0.15, y: 0.4, z: 0 };
      pts[362] = { x: cx + 0.15, y: 0.4, z: 0 };
      pts[168] = { x: cx, y: 0.38, z: 0 };
      pts[2] = { x: cx, y: 0.535, z: 0 };
      pts[1] = { x: cx, y: 0.5009, z: 0 };
      pts[102] = { x: cx - 0.15, y: 0.5195, z: 0 };
      pts[331] = { x: cx + 0.15, y: 0.5195, z: 0 };
      pts[129] = { x: cx - 0.095, y: 0.5195, z: 0 };
      pts[358] = { x: cx + 0.095, y: 0.5195, z: 0 };
      pts[197] = { x: cx - 0.054, y: 0.44975, z: 0 };
      pts[419] = { x: cx + 0.054, y: 0.44975, z: 0 };
      return pts;
    }

    const r = nose.assessNose(mesh(), 93);
    const results = document.getElementById("scanResults");
    results.classList.remove("hidden");
    results.classList.add("is-visible");
    results.style.display = "flex";

    document.getElementById("scanNose").textContent =
      r.score + " \u00B7 " + r.tierLabel;
    document.getElementById("scanNoseShape").textContent =
      r.shape + " \u2014 " + r.why;

    // Give the other cells content so heights are realistic.
    const set = (id, t) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    };
    set("scanSkinAcne", "82%");
    set("scanEyeShape", "Almond (68%)");
    set("scanFaceFat", "71%");
    set("scanFaceFatWhy", "Lean lower face — the cheek and jaw stay defined.");

    await new Promise((res) => setTimeout(res, 250));

    const grid = document.querySelector("#scanResults .scan-detail-grid");
    const gridRect = grid.getBoundingClientRect();
    const cards = [...grid.querySelectorAll(".scan-detail-card")].map((c) => {
      const b = c.getBoundingClientRect();
      return {
        title: c.querySelector("h4").textContent.trim(),
        left: Math.round(b.left - gridRect.left),
        top: Math.round(b.top - gridRect.top),
        width: Math.round(b.width),
        height: Math.round(b.height),
      };
    });

    // Group into rows by rounded top position.
    const rows = {};
    cards.forEach((c) => {
      const key = Math.round(c.top / 12) * 12;
      (rows[key] = rows[key] || []).push(c);
    });

    // A clean grid has every row's cards collectively spanning the full width.
    const gridWidth = Math.round(gridRect.width);
    const rowReport = Object.keys(rows)
      .sort((a, b) => a - b)
      .map((k) => ({
        top: Number(k),
        count: rows[k].length,
        titles: rows[k].map((c) => c.title),
        widths: rows[k].map((c) => c.width),
        // Total span of the row versus the grid width. A shortfall means a hole.
        spansFullWidth:
          Math.abs(rows[k].reduce((s, c) => s + c.width, 0) - gridWidth) < 6,
      }));

    // And is the nose card's text actually fitting (not clipped)?
    const noseCard = document.getElementById("scanNoseShape");
    const noseFits =
      noseCard.scrollWidth <= noseCard.clientWidth + 2 &&
      noseCard.scrollHeight <= noseCard.clientHeight + 2;

    return {
      gridWidth,
      cardCount: cards.length,
      rows: rowReport,
      everyRowFull: rowReport.every((r) => r.spansFullWidth),
      noseTextFits: noseFits,
      noseText: noseCard.textContent.slice(0, 90),
      noseScore: r.score,
      noseShape: r.shape,
    };
  });
}
