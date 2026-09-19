// Test the PDF export module in isolation: populate a minimal report DOM (the
// ids it reads), call printScanReport() and see whether it builds a block and
// calls window.print(). This isolates the export logic from model loading.
export default async function run(page) {
  await page.evaluate(() => {
    window.__printCalls = 0;
    window.__block = null;
    window.print = () => {
      window.__printCalls++;
      const pr = document.querySelector(".print-report");
      window.__block = pr
        ? {
            sections: [...pr.querySelectorAll("h2")].map((h) =>
              h.textContent.trim(),
            ),
            dlCount: pr.querySelectorAll(".print-dl dt").length,
            bodyHasClass: document.body.classList.contains("printing-report"),
            html: pr.outerHTML.length,
          }
        : null;
    };

    // Minimal DOM the exporter reads: a visible #scanResults with the ids.
    const results = document.getElementById("scanResults");
    if (results) results.classList.remove("hidden");
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set("scanOverallScore", "8.4");
    set("scanTier", "chad lite");
    set("scanVerdictNote", "A strong, balanced front reading.");

    // A fake measurement card inside #scanResults.
    if (results) {
      const card = document.createElement("div");
      card.className = "scan-detail-card";
      card.innerHTML = "<h4>Nose</h4><p>75 / 100</p>";
      results.appendChild(card);
    }
  });

  const out = await page.evaluate(async () => {
    const mod = await import("/js/report-export.js");
    const started = mod.printScanReport();
    return {
      started,
      printCalls: window.__printCalls,
      block: window.__block,
      hasPrintClass: document.body.classList.contains("printing-report"),
      // The failure mode: is the report element actually in the DOM at all?
      reportElsNow: document.querySelectorAll(".print-report").length,
    };
  });
  return out;
}
