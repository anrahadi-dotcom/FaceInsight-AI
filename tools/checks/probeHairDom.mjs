// Diagnose why #hairAnalyzeBtn is null: is the module loading, and does the
// element exist at all at the time the script runs?
export default async function run(page) {
  // Capture module-level failures.
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.waitForTimeout(2500);

  const probe = await page.evaluate(() => {
    // Ask the DOM directly, with no dependence on app code.
    const byId = document.getElementById("hairAnalyzeBtn");
    const byQuery = document.querySelector("#hairAnalyzeBtn");
    const section = document.getElementById("hairstyle");

    return {
      byIdFound: !!byId,
      byQueryFound: !!byQuery,
      sectionFound: !!section,
      // If the section exists but the button does not, the markup was mangled.
      sectionChildCount: section ? section.children.length : null,
      // Walk into the section to see what IS there.
      idsInSection: section
        ? [...section.querySelectorAll("[id]")].map((el) => el.id).slice(0, 40)
        : null,
      // Is there any button at all inside the section?
      buttonsInSection: section
        ? [...section.querySelectorAll("button")].map(
            (b) => b.id || b.className,
          )
        : null,
      // Did the module attach? hairstyle-ui sets this by calling reset().
      bodyHasNoJs: document.body.classList.contains("no-js"),
    };
  });

  return { probe, errors };
}
