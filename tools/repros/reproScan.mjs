// Repro: drive the REAL scan UI end-to-end and capture console errors so the
// "stuck at 95%" and post-refresh upload error can be reproduced (not guessed).
//   node tools/reproScan.mjs
export default async function run(page, ui) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";

  // Helper: set a file input from the server by fetching the blob in-page.
  async function setFile(selector, photoUrl) {
    await page.evaluate(
      async ({ selector, photoUrl }) => {
        const res = await fetch(photoUrl);
        const blob = await res.blob();
        const file = new File([blob], "p.jpg", { type: blob.type });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.querySelector(selector);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { selector, photoUrl },
    );
    await page.waitForTimeout(1200);
  }

  const result = {};
  // 1) front + side scan
  await setFile("#imageInput", ORIGIN + "/test_photos/jordan_barrett.jpg");
  await setFile(
    "#sideImageInput",
    ORIGIN + "/test_photos/JordanBarretSideProfile.jpg",
  );
  await page.click("#analyze-btn");
  await page.waitForTimeout(14000);
  result.afterBoth = await page.evaluate(() => ({
    loadingDisplay: getComputedStyle(document.getElementById("loading"))
      .display,
    progress: document.querySelector(".progress")?.style.width,
    analyzeDisabled: document.getElementById("analyze-btn").disabled,
    resultsVisible: document.getElementById("scanResults")?.className,
  }));

  // 2) remove the side photo, keep only front, scan again
  await page.click("#clearSideImage");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById("analyze-btn").click());
  // Sample the loading text/bar over the second scan so a hang is visible as a
  // stopped percentage rather than a final snapshot.
  const samples = [];
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(() => ({
      t: document.getElementById("loading")?.querySelector(".progress")?.style.width,
      txt: document.querySelector("#loading")?.innerText?.replace(/\s+/g, " ").slice(0, 60),
      btn: document.getElementById("analyze-btn").innerText.trim().slice(0, 24),
      dis: document.getElementById("analyze-btn").disabled,
    })));
  }
  result.secondScanSamples = samples;
  result.afterFrontOnly = await page.evaluate(() => ({
    loadingDisplay: getComputedStyle(document.getElementById("loading"))
      .display,
    progress: document.querySelector(".progress")?.style.width,
    analyzeDisabled: document.getElementById("analyze-btn").disabled,
    analyzeText: document.getElementById("analyze-btn").innerText,
    resultsVisible: document.getElementById("scanResults")?.className,
    statusText: document.getElementById("scanStatus")?.textContent || null,
  }));

  result.errors = errors;
  return result;
}
