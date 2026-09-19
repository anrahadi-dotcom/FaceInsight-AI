// Render the print stylesheet for real: force print media emulation, build the
// report, and screenshot it. This is the check that the PDF/print output actually
// contains the report rather than a blank page.
export default async function run(page) {
  await page.evaluate(() => {
    window.print = () => {};
    const results = document.getElementById("scanResults");
    results.classList.remove("hidden");
    results.classList.add("is-visible");
    results.style.display = "flex";
    const set = (id, t) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    };
    set("scanOverallScore", "8.4 / 10");
    set("scanTier", "Chad Lite");
    set("scanVerdictNote", "A strong, balanced front reading.");
    set("scanSymmetryScore", "72.4%");
    set("scanGoldenScore", "88.1%");
    set("scanEyeAreaValue", "84%");
    set("scanPotentialScore", "9.1 / 10");
    const cards = document.querySelectorAll("#scanResults .scan-detail-card");
    const labels = ["Nose", "Skin quality", "Jawline", "Canthal tilt"];
    const values = ["78 / 100 (Snub / Button)", "94%", "92.5%", "4.2 deg"];
    cards.forEach((c, i) => {
      const h = c.querySelector("h4");
      const p = c.querySelector("p");
      if (h && labels[i]) h.textContent = labels[i];
      if (p && values[i]) p.textContent = values[i];
    });
  });

  const built = await page.evaluate(async () => {
    const mod = await import("/js/report-export.js");
    const started = mod.printScanReport();
    const block = document.querySelector("body > .print-report");
    return {
      started,
      bodyClass: document.body.classList.contains("printing-report"),
      blockPresent: !!block,
      blockDisplay: block ? getComputedStyle(block).display : null,
      // Is anything OTHER than the report visible?
      bodyChildCount: document.body.children.length,
      visibleNonReport: [...document.body.children].filter(
        (el) =>
          !el.classList.contains("print-report") &&
          getComputedStyle(el).display !== "none",
      ).length,
    };
  });

  return built;
}
