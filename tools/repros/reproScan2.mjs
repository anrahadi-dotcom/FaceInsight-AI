// Aggressive repro: simulate the real user sequence that produced the "stuck at
// 95%" report -- scan front+side, then remove the side and rescan, including
// clicking Analyze again while the first scan may still be settling. Captures
// every page error, console error, AND failed request with full detail.
export default async function run(page, ui) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.stack || e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("requestfailed", (r) => errors.push("reqfail: " + r.url()));

  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";
  async function setFile(selector, photoUrl) {
    await page.evaluate(async ({ selector, photoUrl }) => {
      const res = await fetch(photoUrl);
      const blob = await res.blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
      const input = document.querySelector(selector);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, { selector, photoUrl });
    await page.waitForTimeout(1500);
  }
  const snap = () => page.evaluate(() => ({
    bar: document.querySelector("#loading .progress")?.style.width,
    loadTxt: (document.querySelector("#loading")?.innerText || "").replace(/\s+/g, " ").slice(0, 50),
    btn: (document.getElementById("analyze-btn")?.innerText || "").trim().slice(0, 22),
    dis: document.getElementById("analyze-btn")?.disabled,
    sideSrcIsEmpty: (() => { const s = document.getElementById("sidePreview"); return !s || !s.src || s.src === window.location.href; })(),
  }));

  const out = { steps: [] };
  await setFile("#imageInput", ORIGIN + "/test_photos/jordan_barrett.jpg");
  await setFile("#sideImageInput", ORIGIN + "/test_photos/JordanBarretSideProfile.jpg");

  // 1) first scan, let it finish
  await page.evaluate(() => document.getElementById("analyze-btn").click());
  await page.waitForTimeout(12000);
  out.steps.push({ phase: "scan1(front+side)", ...(await snap()) });

  // 2) remove side, then IMMEDIATELY rescan (user impatience)
  await page.click("#clearSideImage");
  await page.waitForTimeout(300);
  out.steps.push({ phase: "sideRemoved", ...(await snap()) });
  await page.evaluate(() => document.getElementById("analyze-btn").click());
  await page.waitForTimeout(12000);
  out.steps.push({ phase: "scan2(frontOnly)", ...(await snap()) });

  out.errors = errors;
  return out;
}
