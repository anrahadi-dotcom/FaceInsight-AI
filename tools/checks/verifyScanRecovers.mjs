// Does the scan now RECOVER when the model cannot load? Previously it parked at
// 95% forever with the button dead. With the timeout in place it must surface a
// clear error and re-enable the button. This is the check that decides whether
// the worst failure mode is actually gone.
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || e)));

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

  // Poll until the button comes back to life, or 32s passes (timeout is 25s).
  const timeline = [];
  let recovered = false;
  for (let i = 0; i < 33; i++) {
    const s = await page.evaluate(() => {
      const btn = document.getElementById("analyze-btn");
      const status = document.getElementById("scan-status");
      return {
        disabled: btn.disabled,
        loading: getComputedStyle(document.getElementById("loading")).display,
        status: status.textContent.trim().slice(0, 90),
        statusVisible: status.classList.contains("is-visible"),
      };
    });
    timeline.push({
      t: i * 1000,
      disabled: s.disabled,
      status: s.status.slice(0, 45),
    });
    if (!s.disabled) {
      recovered = true;
      return {
        recovered: true,
        recoveredAfterMs: i * 1000,
        finalStatus: s.status,
        statusVisible: s.statusVisible,
        loadingHidden: s.loading === "none",
        errors,
      };
    }
    await page.waitForTimeout(1000);
  }

  return {
    recovered: false,
    note: "Still disabled after 32s — the hang is NOT fixed",
    lastStatus: timeline[timeline.length - 1].status,
    errors,
  };
}
