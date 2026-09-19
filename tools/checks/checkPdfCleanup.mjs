// Verify the PDF cleanup change: the report block must still be present right
// after print() returns (i.e. while a dialog could still be open) and must be
// removed once afterprint fires.
export default async function run(page) {
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = true;
    };
    window.__afterprint = 0;
    window.addEventListener("afterprint", () => {
      window.__afterprint++;
    });
    const results = document.getElementById("scanResults");
    results.classList.remove("hidden");
    results.classList.add("is-visible");
    results.style.display = "flex";
    const set = (id, t) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    };
    set("scanOverallScore", "8.0 / 10");
    set("scanTier", "Chad");
  });

  const afterPrint = await page.evaluate(async () => {
    const mod = await import("/js/report-export.js?ts=" + Date.now());
    mod.printScanReport();
    return {
      printed: !!window.__printed,
      blockStillPresentRightAfterPrint: !!document.querySelector(
        "body > .print-report",
      ),
      classStillSetRightAfterPrint:
        document.body.classList.contains("printing-report"),
    };
  });

  // Wait well past the OLD 8s timer to prove the block does NOT vanish on a timer.
  await page.waitForTimeout(10000);
  const afterWait = await page.evaluate(() => ({
    blockStillPresentAfter10s: !!document.querySelector("body > .print-report"),
    classStillSetAfter10s: document.body.classList.contains("printing-report"),
  }));

  // Now fire afterprint (what a real browser does when the dialog closes).
  const afterEvent = await page.evaluate(() => {
    window.dispatchEvent(new Event("afterprint"));
    return {
      blockPresentAfterprint: !!document.querySelector("body > .print-report"),
      classSetAfterprint: document.body.classList.contains("printing-report"),
    };
  });

  return { afterPrint, afterWait, afterEvent };
}
