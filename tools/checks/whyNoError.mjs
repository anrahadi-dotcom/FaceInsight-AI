// Why does the reporter see NO error with the CDN down, when this harness does?
//
// Two candidates, and they need separating:
//   (a) the app swallows the failure on some path this harness has never driven
//   (b) the harness has been testing a code path the real page does not take
//
// This drives BOTH features the way a person does -- pick a photo, click the
// button -- with cache disabled and every off-site request failing, and reports
// the exact visible text.
export default async function run(page) {
  const errors = [];
  const failed = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || e)));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.startsWith("http://localhost:5577")) failed.push(u.slice(0, 70));
  });

  // Kill the network, including anything the browser might have cached.
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

  await page.reload();
  await page.waitForTimeout(2000);

  const pickFile = async (id, name) => {
    await page.evaluate(
      async ({ id, name }) => {
        const res = await fetch("/test_photos/jordan_barrett.jpg");
        const blob = await res.blob();
        const dt = new DataTransfer();
        dt.items.add(new File([blob], name, { type: blob.type }));
        const input = document.getElementById(id);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { id, name },
    );
    await page.waitForTimeout(700);
  };

  const waitFor = async (btnId, readFn, label) => {
    for (let i = 0; i < 32; i++) {
      const s = await page.evaluate(readFn);
      if (!s.disabled) return { label, recoveredAfterMs: i * 1000, ...s };
      await page.waitForTimeout(1000);
    }
    return { label, recovered: false, note: "still busy after 32s" };
  };

  // ---- FACE RATER ----------------------------------------------------------
  await pickFile("imageInput", "front.jpg");
  const analyzeReady = await page.evaluate(
    () => !document.getElementById("analyze-btn").disabled,
  );
  let faceRate = { analyzeReady };
  if (analyzeReady) {
    await page.click("#analyze-btn");
    faceRate = await waitFor(
      "analyze-btn",
      () => ({
        disabled: document.getElementById("analyze-btn").disabled,
        banner: document.getElementById("scan-status").textContent.trim(),
        bannerVisible: document
          .getElementById("scan-status")
          .classList.contains("is-visible"),
        toasts: [...document.querySelectorAll(".toast")].map((t) =>
          t.textContent.trim(),
        ),
        loadingHidden:
          getComputedStyle(document.getElementById("loading")).display ===
          "none",
      }),
      "faceRate",
    );
  }

  // ---- HAIRSTYLE -----------------------------------------------------------
  await pickFile("hairInput", "hair.jpg");
  const hairReady = await page.evaluate(
    () => !document.getElementById("hairAnalyzeBtn").disabled,
  );
  let hairstyle = { hairReady };
  if (hairReady) {
    await page.click("#hairAnalyzeBtn");
    hairstyle = await waitFor(
      "hairAnalyzeBtn",
      () => ({
        disabled: document.getElementById("hairAnalyzeBtn").disabled,
        banner: document.getElementById("hairStatus").textContent.trim(),
        bannerVisible: document
          .getElementById("hairStatus")
          .classList.contains("is-visible"),
        loadingActive: document
          .getElementById("hairLoading")
          .classList.contains("is-active"),
        loadingFailed: document
          .getElementById("hairLoading")
          .classList.contains("is-failed"),
        loadingHidden:
          getComputedStyle(document.getElementById("hairLoading")).display ===
          "none",
      }),
      "hairstyle",
    );
  }

  return {
    faceRate,
    hairstyle,
    failedRequests: [...new Set(failed)].slice(0, 6),
    errors,
  };
}
