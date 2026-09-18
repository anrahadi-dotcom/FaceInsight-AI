// Full verification of the model-failure path, using a file that actually
// reaches showPreview (so hasFrontPhoto becomes true and the scan proceeds).
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || e)));

  await page.waitForTimeout(1500);

  // Drive the REAL input the way a user does, and confirm the app accepted it.
  const fileAccepted = await page.evaluate(async () => {
    const res = await fetch("/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
    const input = document.getElementById("imageInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const btn = document.getElementById("analyze-btn");
    return {
      inputFiles: input.files.length,
      previewHasSrc: !!document.getElementById("preview").src,
      analyzeEnabled: !btn.disabled,
    };
  });

  if (!fileAccepted.analyzeEnabled) {
    return {
      reached: false,
      fileAccepted,
      note: "Photo never reached the app — test setup problem, not an app bug",
    };
  }

  await page.click("#analyze-btn");

  let outcome = null;
  for (let i = 0; i < 33; i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => {
      const btn = document.getElementById("analyze-btn");
      const status = document.getElementById("scan-status");
      return {
        disabled: btn.disabled,
        statusText: status.textContent.trim(),
        statusVisible: status.classList.contains("is-visible"),
        loadingHidden:
          getComputedStyle(document.getElementById("loading")).display ===
          "none",
      };
    });
    if (!s.disabled) {
      outcome = { recoveredAfterMs: i * 1000, ...s };
      break;
    }
  }

  return { reached: true, fileAccepted, outcome, errors };
}
