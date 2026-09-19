// Reproduce the "Download PDF does nothing" report: run a real scan through the
// UI, then click the button and observe what actually happens (print called? any
// exception? did the print block get built?).
export default async function run(page, ui) {
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push("pageerror: " + (e.stack || e.message)),
  );

  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";

  // Stub window.print so the headless browser doesn't hang on a native dialog,
  // and record whether it was called.
  await page.evaluate(() => {
    window.__printCalls = 0;
    window.__printBlockSeen = null;
    window.print = () => {
      window.__printCalls++;
      window.__printBlockSeen = {
        hasClass: document.body.classList.contains("printing-report"),
        reportEls: document.querySelectorAll(".print-report").length,
        sections: [...document.querySelectorAll(".print-report h2")].map((h) =>
          h.textContent.trim(),
        ),
      };
    };
  });

  // Upload a photo and scan.
  await page.evaluate(async (ORIGIN) => {
    const res = await fetch(ORIGIN + "/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
    const input = document.querySelector("#imageInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, ORIGIN);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById("analyze-btn").click());
  await page.waitForTimeout(16000);

  const beforeClick = await page.evaluate(() => {
    const sr = document.getElementById("scanResults");
    const btn = document.getElementById("downloadReportBtn");
    return {
      scanResultsHidden: sr ? sr.classList.contains("hidden") : null,
      scanResultsDisplay: sr ? getComputedStyle(sr).display : null,
      btnExists: !!btn,
      btnVisible: btn ? getComputedStyle(btn).display : null,
    };
  });

  // Click the button for real.
  let clickErr = null;
  try {
    await page.evaluate(() =>
      document.getElementById("downloadReportBtn").click(),
    );
  } catch (e) {
    clickErr = String(e && e.message);
  }
  await page.waitForTimeout(500);

  const afterClick = await page.evaluate(() => ({
    printCalls: window.__printCalls,
    printBlockSeen: window.__printBlockSeen,
    toast: (() => {
      const t = document.querySelector(".toast, #toast, [class*=toast]");
      return t ? t.textContent.trim().slice(0, 120) : null;
    })(),
  }));

  return { beforeClick, clickErr, afterClick, errors };
}
