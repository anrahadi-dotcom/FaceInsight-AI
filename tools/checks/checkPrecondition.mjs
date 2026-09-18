// Confirm the test's own precondition: does setting input.files actually reach
// showPreview (i.e. does the app consider a front photo present)? Every previous
// run may have been failing at the guard clause instead of the model path, which
// would explain "NO STAMPED" while the button still recovered.
export default async function run(page) {
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => ({
    analyzeDisabled: document.getElementById("analyze-btn").disabled,
    previewSrc: document.getElementById("preview").src ? "set" : "empty",
  }));

  const after = await page.evaluate(async () => {
    const res = await fetch("/test_photos/jordan_barrett.jpg");
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "p.jpg", { type: blob.type }));
    const input = document.getElementById("imageInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return {
      inputFileCount: input.files.length,
      previewSrc: document.getElementById("preview").src ? "set" : "empty",
      analyzeDisabled: document.getElementById("analyze-btn").disabled,
      uploadBoxHasImage: document
        .getElementById("uploadBox")
        .classList.contains("has-image"),
    };
  });

  return { before, after, reachedTheApp: !after.analyzeDisabled };
}
