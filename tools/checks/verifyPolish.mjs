// Verify the polish layer is actually applied (pseudo-element seam, contrast
// lift on stat labels, scanner frame, focus-visible rule present).
export default async function run(page) {
  return page.evaluate(() => {
    const seam = getComputedStyle(
      document.querySelector(".section-head"),
      "::after",
    );
    const dt = getComputedStyle(document.querySelector(".hero__stats dt"));
    const stack = document.querySelector(".scanner .upload-stack");
    const stackBefore = stack
      ? getComputedStyle(stack, "::before").borderTopColor
      : null;
    let hasFocusRule = false;
    for (const ss of document.styleSheets) {
      try {
        for (const r of ss.cssRules) {
          if (r.selectorText && r.selectorText.includes("focus-visible"))
            hasFocusRule = true;
        }
      } catch (e) {
        /* cross-origin sheet */
      }
    }
    return {
      sectionSeamWidth: seam.width,
      statLabelColor: dt.color,
      scannerFrameRadius: stack
        ? getComputedStyle(stack).borderTopLeftRadius
        : null,
      scannerBracket: stackBefore,
      hasFocusRule,
      uploadBoxes: document.querySelectorAll(".upload-box").length,
      featureCards: document.querySelectorAll(".feature-card").length,
    };
  });
}
