// Simulate "WiFi off" as faithfully as the browser allows: kill every off-site
// request AND report navigator.onLine as false, then drive a real scan and a real
// hairstyle run and report EXACTLY what the user would see.
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || e)));

  // Off-site = anything not localhost. The app itself is served locally, so this
  // is precisely "the CDN is unreachable".
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http://localhost:5577") ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      return route.continue();
    }
    return route.abort("internetdisconnected");
  });

  // Report as offline, like a machine with WiFi switched off.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      get: () => false,
      configurable: true,
    });
  });
  await page.reload();
  await page.waitForTimeout(2500);

  const onLine = await page.evaluate(() => navigator.onLine);

  // ---- SCANNER -------------------------------------------------------------
  const fileSet = await page.evaluate(async () => {
    const res = await fetch("/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
    const input = document.getElementById("imageInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    return { enabled: !document.getElementById("analyze-btn").disabled };
  });

  let scan = null;
  if (fileSet.enabled) {
    await page.click("#analyze-btn");
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const s = await page.evaluate(() => ({
        disabled: document.getElementById("analyze-btn").disabled,
        status: document.getElementById("scan-status").textContent.trim(),
        statusVisible: document
          .getElementById("scan-status")
          .classList.contains("is-visible"),
        toasts: [...document.querySelectorAll(".toast")].map((t) =>
          t.textContent.trim().slice(0, 90),
        ),
      }));
      if (!s.disabled) {
        scan = { recoveredAfterMs: i * 1000, ...s };
        break;
      }
    }
    if (!scan) scan = { recovered: false, note: "still disabled after 30s" };
  }

  // ---- HAIRSTYLE -----------------------------------------------------------
  await page.evaluate(async () => {
    const res = await fetch("/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "h.jpg", { type: blob.type }));
    const input = document.getElementById("hairInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(600);
  await page.click("#hairAnalyzeBtn");

  let hair = null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => ({
      disabled: document.getElementById("hairAnalyzeBtn").disabled,
      status: document.getElementById("hairStatus").textContent.trim(),
      statusVisible: document
        .getElementById("hairStatus")
        .classList.contains("is-visible"),
      loadingVisible:
        getComputedStyle(document.getElementById("hairLoading")).display !==
        "none",
      resultsShown: !document
        .getElementById("hairResults")
        .classList.contains("hidden"),
    }));
    if (!s.disabled) {
      hair = { recoveredAfterMs: i * 1000, ...s };
      break;
    }
  }
  if (!hair) hair = { recovered: false, note: "still disabled after 30s" };

  return { onLine, fileSet, scan, hair, errors };
}
