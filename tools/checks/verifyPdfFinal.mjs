// Final PDF verification with the ORDER corrected: read the button state AFTER
// revealing the report, not before. The previous script read it first and
// reported "display: none", which was simply the pre-scan state and not a bug.
export default async function run(page) {
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const results = document.getElementById("scanResults");

    const buttonState = () => {
      const b = document.getElementById("downloadReportBtn");
      return {
        display: getComputedStyle(b).display,
        height: Math.round(b.getBoundingClientRect().height),
      };
    };

    // 1. Before any scan: the button must be hidden (there is nothing to export).
    const beforeScan = buttonState();

    // 2. Populate a report the way a scan would.
    results.classList.remove("hidden");
    results.classList.add("is-visible");
    results.style.display = "flex";

    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set("scanOverallScore", "7.8 / 10");
    set("scanTier", "High");
    set("scanSymmetryScore", "72.4%");
    set("scanGoldenScore", "68.1%");
    set("scanEyeAreaValue", "64%");
    set("scanPotentialScore", "7.4");

    const cards = document.querySelectorAll("#scanResults .scan-detail-card");
    const labels = ["Face shape", "Skin quality", "Jawline", "Canthal tilt"];
    const values = ["Oval", "71%", "58.5%", "5.2 deg"];
    cards.forEach((card, i) => {
      const h = card.querySelector("h4");
      const p = card.querySelector("p");
      if (h && labels[i]) h.textContent = labels[i];
      if (p && values[i]) p.textContent = values[i];
    });

    document
      .querySelectorAll("#scanEyePanel .scan-eye-item")
      .forEach((item, i) => {
        const v = item.querySelector(".scan-eye-item__value");
        if (v) v.textContent = ["62%", "3.1 deg", "70%", "55%"][i] || "60%";
      });

    await new Promise((r) => setTimeout(r, 200));

    // 3. Now the button must be visible.
    const afterScan = buttonState();

    // 4. And it must produce a full report.
    const mod = await import("/js/report-export.js");
    window.print = () => {};
    const started = mod.printScanReport();
    const block = document.querySelector("body > .print-report");

    return {
      beforeScan,
      afterScan,
      started,
      sections: block
        ? [...block.querySelectorAll(".print-block h2")].map(
            (h) => h.textContent,
          )
        : [],
      dataRows: block ? block.querySelectorAll(".print-dl dt").length : 0,
      sampleValues: block
        ? [...block.querySelectorAll(".print-dl dd")]
            .slice(0, 6)
            .map((d) => d.textContent)
        : [],
      hasUndefined: block ? /undefined|null|NaN/.test(block.textContent) : null,
      disclaimer: block ? !!block.querySelector(".print-disclaimer") : false,
    };
  });
}
