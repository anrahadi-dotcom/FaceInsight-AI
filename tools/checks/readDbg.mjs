// Read the debug snapshot main.js stamps right after it has the analysis.
export default async function run(page) {
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    const res = await fetch("/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
    const input = document.getElementById("imageInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(800);
  await page.click("#analyze-btn");

  // Wait for the handler to actually finish rather than guessing a duration.
  // Reading too early is what made this look like a bug in the app.
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const done = await page.evaluate(() => !document.getElementById("analyze-btn").disabled);
    if (done) break;
  }

  return page.evaluate(() => ({
    dbg: window.__dbg || "NOT STAMPED — code never reached that line",
    status: document.getElementById("scan-status").textContent.trim(),
    statusVisible: document.getElementById("scan-status").classList.contains("is-visible"),
    disabled: document.getElementById("analyze-btn").disabled,
    loadingHidden: getComputedStyle(document.getElementById("loading")).display === "none",
  }));
}
