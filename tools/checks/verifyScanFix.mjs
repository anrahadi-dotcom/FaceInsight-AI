// Verify the two accessibility fixes:
//  A) With a HASH in the URL (the state that used to make an empty slot look
//     loaded), clicking Analyze with NO photo must show the friendly toast and
//     NOT run a scan.
//  B) The full front+side -> remove-side -> front-only sequence must always end
//     with progress back at 0%, overlay hidden, and the button re-enabled.
export default async function run(page, ui) {
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push("pageerror: " + (e.stack || e.message)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";

  const out = {};

  // --- A) hash + empty Analyze ---
  await page.goto(ORIGIN + "/index.html#features");
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById("analyze-btn").click());
  await page.waitForTimeout(800);
  out.hashEmptyClick = await page.evaluate(() => ({
    loadingDisplay: getComputedStyle(document.getElementById("loading"))
      .display,
    btnDisabled: document.getElementById("analyze-btn").disabled,
    toast: (document.querySelector(".toast")?.innerText || "").slice(0, 60),
  }));

  // --- B) front+side then front-only ---
  async function setFile(selector, photoUrl) {
    await page.evaluate(
      async ({ selector, photoUrl }) => {
        const res = await fetch(photoUrl);
        const blob = await res.blob();
        const dt = new DataTransfer();
        dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
        const input = document.querySelector(selector);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { selector, photoUrl },
    );
    await page.waitForTimeout(1500);
  }
  const state = () =>
    page.evaluate(() => ({
      bar: document.querySelector("#loading .progress")?.style.width,
      btn: (document.getElementById("analyze-btn")?.innerText || "")
        .trim()
        .slice(0, 22),
      dis: document.getElementById("analyze-btn")?.disabled,
      loadingDisplay: getComputedStyle(document.getElementById("loading"))
        .display,
    }));

  await setFile("#imageInput", ORIGIN + "/test_photos/jordan_barrett.jpg");
  await setFile(
    "#sideImageInput",
    ORIGIN + "/test_photos/JordanBarretSideProfile.jpg",
  );
  await page.evaluate(() => document.getElementById("analyze-btn").click());
  await page.waitForTimeout(13000);
  out.afterBoth = await state();

  await page.click("#clearSideImage");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById("analyze-btn").click());
  await page.waitForTimeout(13000);
  out.afterFrontOnly = await state();

  out.errors = errors;
  return out;
}
