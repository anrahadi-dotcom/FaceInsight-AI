// Screenshot the photo scan overlay WHILE it is animating, so the new face-scan
// effect (mesh grid + beam + readout) can be eyeballed. Forcing the overlay on
// without running the real scan keeps the shot deterministic.
export default async function run(page) {
  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Load a photo into the front slot so there is something to "scan".
  await page.evaluate(async (ORIGIN) => {
    const res = await fetch(ORIGIN + "/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
    const input = document.querySelector("#imageInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, ORIGIN);
  await page.waitForTimeout(1200);

  // Reveal the overlay the way the app does, then let the beam animate a beat.
  await page.evaluate(() => {
    const ov = document.getElementById("photoScanOverlay");
    ov.classList.remove("hidden");
    ov.style.opacity = "1";
  });
  await page.waitForTimeout(900);

  const box = await page.$(".upload-preview");
  if (box) {
    await box.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await box.screenshot({ path: "shot-scanfx.png" });
  }
  return { shot: "shot-scanfx.png" };
}
