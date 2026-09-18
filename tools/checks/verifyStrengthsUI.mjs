// Verify "Your strengths" via the REAL UI only (the path that is known to work).
// Upload the photo, click Analyze, wait, then read the rendered card. No direct
// engine eval -- that path cannot initialise MediaPipe's WASM from a bare eval.
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push("pageerror: " + (e.stack || e.message)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";

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

  // Poll until the strengths card is populated (or time out).
  let rendered = null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    rendered = await page.evaluate(() => {
      const panel = document.getElementById("scanStrengthPanel");
      const items = [...document.querySelectorAll(".scan-strength-item")].map(
        (li) => ({
          rank: li.querySelector(".scan-strength-item__rank")?.textContent,
          name: li.querySelector(".scan-strength-item__name")?.textContent,
          score: li.querySelector(".scan-strength-item__score")?.textContent,
          bar: li.querySelector(".scan-strength-item__bar i")?.style.width,
          note: (
            li.querySelector(".scan-strength-item__note")?.textContent || ""
          ).slice(0, 46),
        }),
      );
      return {
        tier: document.getElementById("scanTierValue")?.textContent || null,
        cardEmpty: panel ? panel.classList.contains("is-empty") : null,
        cardDisplay: panel ? getComputedStyle(panel).display : null,
        count: document.getElementById("scanStrengthCount")?.textContent,
        items,
      };
    });
    if (rendered.items.length > 0 || (rendered.tier && rendered.tier !== ""))
      break;
  }
  return { rendered, errors };
}
