// Read the debug object main.js now stamps before its recovery timeout.
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

  await page.waitForTimeout(1000);
  await page.click("#analyze-btn");
  await page.waitForTimeout(6000);

  return page.evaluate(() => ({
    phases: window.__phase || ["no phase array — handler never started"],
    debug: window.__scanDebug || "NEVER REACHED — main.js did not get past the await",
    buttonDisabled: document.getElementById("analyze-btn").disabled,
    buttonLabel: document
      .getElementById("analyze-btn")
      .textContent.trim()
      .slice(0, 30),
    loadingDisplay: getComputedStyle(document.getElementById("loading"))
      .display,
  }));
}
