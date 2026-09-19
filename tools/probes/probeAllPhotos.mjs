// Run every test photo through the hairstyle engine and report, per photo: the
// measured face shape and the recommended cuts. This is the evidence for the
// "all photos give the same haircut" report.
export default async function run(page) {
  await page.waitForTimeout(2000);

  return page.evaluate(async () => {
    const engine = await import("/js/faceEngine.js");
    const hair = await import("/js/hairstyle.js");

    const files = [
      "adriana_lima.jpg",
      "alain_flick.jpg",
      "chico_frontal.jpg",
      "Doutzen Kroes.jpg",
      "EliasDePoot.jpg",
      "FatGirl.jpeg",
      "FatGuy.jpeg",
      "jordan_barrett.jpg",
      "MarlonTexeira.jpg",
      "reccesed.jpg",
      "sean_opry.jpg",
      "SimonNessman.jpg",
    ];

    const out = [];
    for (const f of files) {
      const img = new Image();
      img.src = "/test_photos/" + encodeURIComponent(f);
      try {
        await img.decode();
      } catch (e) {
        out.push({ file: f, error: "decode failed" });
        continue;
      }

      let analysis;
      try {
        analysis = await engine.analyzeFrontPhoto(img);
      } catch (e) {
        out.push({ file: f, error: String(e && e.message).slice(0, 50) });
        continue;
      }

      const plan = hair.recommendHairstyles(analysis);
      out.push({
        file: f,
        noFace: analysis.noFace,
        measured: analysis.frontalMetricsMeasured,
        rawShape: analysis.faceShape || null,
        shape: plan ? plan.shape : null,
        conf: plan ? plan.confidence : null,
        // The three ratios that decide the shape, so a wrong call is diagnosable.
        lt: analysis.faceShapeDetail
          ? analysis.faceShapeDetail.lengthToWidth
          : null,
        late: analysis.faceShapeDetail
          ? analysis.faceShapeDetail.jawToCheek
          : null,
        ftc: analysis.faceShapeDetail
          ? analysis.faceShapeDetail.foreheadToCheek
          : null,
        cuts: plan ? plan.cuts.map((c) => c.name) : [],
      });
    }
    return out;
  });
}
