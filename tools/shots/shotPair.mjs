// Drive a real scan and screenshot the results region so the new Potential +
// Strengths pair and the scan animation can be eyeballed.
export default async function run(page) {
  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
  await page.setViewportSize({ width: 1440, height: 1000 });
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

  // Wait for the report to be visible.
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const done = await page.evaluate(() => {
      const r = document.getElementById("scanResults");
      return (
        r &&
        (r.classList.contains("is-visible") || r.classList.contains("visible"))
      );
    });
    if (done) break;
  }
  await page.waitForTimeout(1500);

  // Scroll the Potential/Strengths pair into view and shoot just that region.
  const el = await page.$(".scan-pair");
  if (el) {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await el.screenshot({ path: "shot-pair.png" });
  }
  return { shot: "shot-pair.png" };
}
