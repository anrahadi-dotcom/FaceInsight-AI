// Verify the connectivity strip in all three states: online (hidden), offline
// with no model (warn), and offline with the model cached (info).
export default async function run(page) {
  await page.waitForTimeout(1500);

  const read = () =>
    page.evaluate(() => {
      const strip = document.getElementById("connectivityStrip");
      return {
        hidden: strip.hidden,
        visible: strip.classList.contains("is-visible"),
        warn: strip.classList.contains("is-warn"),
        text: strip
          .querySelector(".conn-strip__text")
          .textContent.trim()
          .slice(0, 95),
        bodyHasClass: document.body.classList.contains("has-conn-strip"),
      };
    });

  // 1. Online at load -> nothing shown.
  const online = await read();

  // 2. Go offline with NO cached model -> warn.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      get: () => false,
      configurable: true,
    });
    window.dispatchEvent(new Event("offline"));
  });
  await page.waitForTimeout(500);
  const offlineNoModel = await read();

  // 3. Mark the model ready, then bounce offline again -> info, not a warning.
  await page.evaluate(async () => {
    const conn = await import("/js/connectivity.js");
    conn.markModelReady();
  });
  await page.waitForTimeout(500);
  const offlineCached = await read();

  // 4. Back online -> strip clears.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      get: () => true,
      configurable: true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await page.waitForTimeout(600);
  const backOnline = await read();

  return { online, offlineNoModel, offlineCached, backOnline };
}
