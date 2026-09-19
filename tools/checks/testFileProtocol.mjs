// The decisive test: open the page over file:// (double-clicking index.html) and
// see whether the app's JS runs at all. If ES modules are blocked, main.js never
// executes and NO error handler can ever fire -- which would explain "no error"
// without the app being at fault.
export default async function run(page) {
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push(m.text().slice(0, 120));
  });
  page.on("pageerror", (e) =>
    logs.push("pageerror: " + String(e.message || e).slice(0, 120)),
  );

  return {
    protocol: "file://",
    appAlive: await page.evaluate(() => ({
      // main.js removes this class; if it is still there, main.js never ran.
      bodyStillHasNoJs: document.body.classList.contains("no-js"),
      hasAnalyzeBtn: !!document.getElementById("analyze-btn"),
      hasHairstyle: !!document.getElementById("hairstyle"),
      // Any module-driven behaviour at all?
      hairstyleWired: document.getElementById("hairAnalyzeBtn")
        ? document.getElementById("hairAnalyzeBtn").disabled
        : "no button",
    })),
    consoleErrors: logs.slice(0, 6),
  };
}
