// Verify the new "Your strengths" feature end-to-end: run a real analysis and
// print the four strengths the engine picks, then confirm the card renders in
// the DOM after a real scan through the UI.
export default async function run(page, ui) {
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push("pageerror: " + (e.stack || e.message)),
  );
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  const ORIGIN = process.env.ORIGIN || "http://localhost:5501";

  // 1) engine-level: what strengths does a real photo produce?
  // Warm the landmarker up FIRST: analyzeFrontPhoto loads it lazily, and a
  // cold call returns noFace (no mesh yet) which would make every strength list
  // empty and look like an engine bug when it is just model-load latency.
  const engineStrengths = await page.evaluate(async (ORIGIN) => {
    const engine = await import("/js/faceEngine.js");
    await engine.ensureLandmarker();
    // Give the GPU delegate a beat to settle before the first real detect.
    await new Promise((r) => setTimeout(r, 1500));
    const out = {};
    for (const file of [
      "jordan_barrett.jpg",
      "adriana_lima.jpg",
      "FatGuy.jpeg",
      "reccesed.jpg",
    ]) {
      const img = new Image();
      img.src = ORIGIN + "/test_photos/" + file;
      await img.decode();
      const a = await engine.analyzeFrontPhoto(img);
      out[file] = (a.strengths || []).map(
        (s) => s.key + ":" + Math.round(s.score),
      );
    }
    return out;
  }, ORIGIN);

  // 2) UI-level: drive a real scan and read the rendered card.
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
  await page.waitForTimeout(14000);

  const rendered = await page.evaluate(() => {
    const panel = document.getElementById("scanStrengthPanel");
    const items = [...document.querySelectorAll(".scan-strength-item")].map(
      (li) => ({
        rank: li.querySelector(".scan-strength-item__rank")?.textContent,
        name: li.querySelector(".scan-strength-item__name")?.textContent,
        score: li.querySelector(".scan-strength-item__score")?.textContent,
        barWidth: li.querySelector(".scan-strength-item__bar i")?.style.width,
        note: li
          .querySelector(".scan-strength-item__note")
          ?.textContent?.slice(0, 40),
      }),
    );
    return {
      cardHidden: panel ? panel.classList.contains("is-empty") : null,
      count: document.getElementById("scanStrengthCount")?.textContent,
      items,
      pairColumns: getComputedStyle(document.querySelector(".scan-pair"))
        .gridTemplateColumns,
    };
  });

  return { engineStrengths, rendered, errors };
}
