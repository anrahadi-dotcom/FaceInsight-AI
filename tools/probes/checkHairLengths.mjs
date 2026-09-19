// Quick check of the haircut library by length + gender (pure logic, no browser).
import { recommendHairstyles } from "../../js/hairstyle.js";

for (const g of ["male", "female"]) {
  const base = {
    frontalMetricsMeasured: true,
    overallMeasured: true,
    noFace: false,
    gender: g,
    faceShape: "Oval",
    faceFat: { score: 80 },
  };
  console.log("=== " + g + " ===");
  for (const len of ["any", "veryshort", "short", "medium", "long"]) {
    const p = recommendHairstyles(base, { length: len });
    console.log(
      "  " +
        len.padEnd(9) +
        " -> " +
        p.cuts.length +
        ": " +
        p.cuts.map((c) => c.name).join(", "),
    );
  }
}
