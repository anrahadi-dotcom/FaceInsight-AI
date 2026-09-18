// Screenshot the eye-area + verdict region of a full scan for one photo, so the
// "does the eye area now match the verdict" question is answered by looking.
export default async function run(page) {
  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
  const file = process.env.PHOTO || "alain_flick.jpg";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(
    async ({ ORIGIN, file }) => {
      const res = await fetch(
        ORIGIN + "/test_photos/" + encodeURIComponent(file),
      );
      const blob = await res.blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
      const input = document.querySelector("#imageInput");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { ORIGIN, file },
  );
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById("analyze-btn").click());
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
  const panel = await page.$("#scanEyePanel");
  if (panel) {
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await panel.screenshot({ path: "shot-eye.png" });
  }
  return { shot: "shot-eye.png" };
}
