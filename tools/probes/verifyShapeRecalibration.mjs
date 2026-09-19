// Does the recalibrated prototype set actually separate the eight shapes?
// Uses the same measured bands as the previous diagnostic, so the before/after
// comparison is apples to apples.
export default async function run(page) {
  return page.evaluate(() => {
    const PROTOS = [
      {
        shape: "Oval",
        lengthToWidth: 1.24,
        jawToCheek: 1.035,
        foreheadToCheek: 0.915,
      },
      {
        shape: "Round",
        lengthToWidth: 1.08,
        jawToCheek: 1.065,
        foreheadToCheek: 0.94,
      },
      {
        shape: "Square",
        lengthToWidth: 1.14,
        jawToCheek: 1.08,
        foreheadToCheek: 0.955,
      },
      {
        shape: "Long",
        lengthToWidth: 1.45,
        jawToCheek: 1.025,
        foreheadToCheek: 0.895,
      },
      {
        shape: "Heart",
        lengthToWidth: 1.2,
        jawToCheek: 1.02,
        foreheadToCheek: 0.955,
      },
      {
        shape: "Diamond",
        lengthToWidth: 1.24,
        jawToCheek: 1.021,
        foreheadToCheek: 0.888,
      },
      {
        shape: "Oblong",
        lengthToWidth: 1.4,
        jawToCheek: 1.07,
        foreheadToCheek: 0.9,
      },
      {
        shape: "Triangle",
        lengthToWidth: 1.26,
        jawToCheek: 1.08,
        foreheadToCheek: 0.892,
      },
    ];

    function classify(l, j, f) {
      const distFor = (p) =>
        2.0 * Math.abs(l - p.lengthToWidth) +
        1.0 * Math.abs(j - p.jawToCheek) +
        2.0 * Math.abs(f - p.foreheadToCheek);
      let best = PROTOS[0];
      let bestDist = Infinity;
      for (const p of PROTOS) {
        const d = distFor(p);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      let runner = Infinity;
      for (const p of PROTOS) {
        if (p.shape === best.shape) continue;
        runner = Math.min(runner, distFor(p));
      }
      const ranked = PROTOS.map((p) => ({
        shape: p.shape,
        d: +distFor(p).toFixed(3),
      })).sort((a, b) => a.d - b.d);
      return {
        picked: best.shape,
        margin: +(runner - bestDist).toFixed(4),
        top2: ranked.slice(0, 2),
      };
    }

    // Each entry: the measured ratios a real face of that shape would produce,
    // taken from inside the observed bands (jaw 1.02-1.10, forehead 0.885-0.958).
    const cases = [
      ["Round", 1.08, 1.07, 0.94],
      ["Square", 1.13, 1.085, 0.95],
      ["Oval", 1.24, 1.035, 0.915],
      ["Long", 1.44, 1.03, 0.9],
      ["Oblong", 1.4, 1.075, 0.905],
      ["Heart", 1.19, 1.022, 0.952],
      ["Diamond", 1.25, 1.022, 0.89],
      ["Triangle", 1.27, 1.085, 0.892],
    ];

    const rows = cases.map(([want, l, j, f]) => {
      const r = classify(l, j, f);
      return {
        want,
        got: r.picked,
        correct: r.picked === want,
        margin: r.margin,
        top2: r.top2,
      };
    });

    const correct = rows.filter((r) => r.correct).length;
    return {
      rows,
      correctCount: correct,
      total: rows.length,
      distinctPicks: new Set(rows.map((r) => r.got)).size,
    };
  });
}
