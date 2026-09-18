// Instrument the actual scan click: log every step so the hang is MEASURED
// rather than inferred from reading the source.
export default async function run(page) {
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push("PAGEERROR: " + (e.message || e)));

  await page.waitForTimeout(1500);

  // Instrument the engine + main internals from the page side.
  await page.evaluate(() => {
    window.__trace = [];
    const t = (m) => window.__trace.push(`${Date.now() % 100000} ${m}`);
    window.__t = t;

    // Wrap ensureLandmarker to see if it is even called.
    import("/js/faceEngine.js").then((engine) => {
      const orig = engine.analyzeFrontPhoto;
      window.__engineLoaded = true;
      t("engine module imported; analyzeFrontPhoto=" + typeof orig);
    });
  });

  // Set a file and click, then poll the DOM state over time.
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

  // Poll for 12s: is the button ever re-enabled?
  const timeline = [];
  for (let i = 0; i < 16; i++) {
    const s = await page.evaluate(() => {
      const btn = document.getElementById("analyze-btn");
      const loading = document.getElementById("loading");
      const status = document.getElementById("scan-status");
      return {
        disabled: btn.disabled,
        label: btn.textContent.trim().slice(0, 28),
        loadingDisplay: getComputedStyle(loading).display,
        statusLen: status.textContent.trim().length,
        statusHead: status.textContent.trim().slice(0, 50),
        progressWidth: document.querySelector("#loading .progress").style.width,
      };
    });
    timeline.push({ t: i * 800, ...s });
    if (!s.disabled) break;
    await page.waitForTimeout(800);
  }

  const trace = await page.evaluate(() => window.__trace || []);
  return { timeline, trace, logs: logs.slice(0, 15) };
}
