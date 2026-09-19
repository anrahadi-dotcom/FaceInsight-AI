// Confirm the nose classification logic directly with synthetic meshes built to
// known ratios, so the branch behaviour can be read without browser caching or
// landmark noise. Prints the shape the code returns for each constructed case.
export default async function run(page) {
  await page.waitForTimeout(500);
  return page.evaluate(async () => {
    const nose = await import("/js/nose.js?ts=" + Date.now());

    // Build a mesh where only the nose landmarks matter.
    function makeMesh({ alarW, noseLen, tipW, bridgeW, nostrilW }, ic = 0.3) {
      const p = new Array(478).fill(null).map(() => ({ x: -9, y: -9, z: 0 }));
      const cx = 0.5;
      p[133] = { x: cx - ic / 2, y: 0.4, z: 0 };
      p[362] = { x: cx + ic / 2, y: 0.4, z: 0 };
      p[168] = { x: cx, y: 0.36, z: 0 };
      p[2] = { x: cx, y: 0.36 + noseLen, z: 0 };
      p[1] = { x: cx, y: 0.36 + noseLen * 0.8, z: 0 };
      p[102] = { x: cx - alarW / 2, y: 0.36 + noseLen * 0.9, z: 0 };
      p[331] = { x: cx + alarW / 2, y: 0.36 + noseLen * 0.9, z: 0 };
      p[129] = { x: cx - nostrilW / 2, y: 0.36 + noseLen * 0.9, z: 0 };
      p[358] = { x: cx + nostrilW / 2, y: 0.36 + noseLen * 0.9, z: 0 };
      p[197] = { x: cx - bridgeW / 2, y: 0.36 + noseLen * 0.45, z: 0 };
      p[419] = { x: cx + bridgeW / 2, y: 0.36 + noseLen * 0.45, z: 0 };
      return p;
    }

    const cases = [
      // ratios chosen to hit each branch the classification claims to support
      {
        name: "normal (alar ~1.15x, len ~0.82x, normalized)",
        alarW: 0.345,
        noseLen: 0.283,
        tipW: 0.2,
        bridgeW: 0.048,
        nostrilW: 0.352,
      },
      {
        name: "long slender (len ~1.1x, normalized)",
        alarW: 0.3,
        noseLen: 0.33,
        tipW: 0.175,
        bridgeW: 0.042,
        nostrilW: 0.306,
      },
      {
        name: "short/button (len ~0.68x, normalized)",
        alarW: 0.36,
        noseLen: 0.245,
        tipW: 0.21,
        bridgeW: 0.05,
        nostrilW: 0.367,
      },
      {
        name: "wide/bulbous (alar 1.5x)",
        alarW: 0.45,
        noseLen: 0.32,
        tipW: 0.28,
        bridgeW: 0.063,
        nostrilW: 0.459,
      },
      {
        name: "hump (bridge ~0.22x alar)",
        alarW: 0.345,
        noseLen: 0.283,
        tipW: 0.2,
        bridgeW: 0.076,
        nostrilW: 0.352,
      },
    ];
    return cases.map((c) => {
      const r = nose.assessNose(makeMesh(c), null);
      return {
        name: c.name,
        score: r ? r.score : null,
        shape: r ? r.shape : null,
        tier: r ? r.tier : null,
        alarToInter: r ? r.metrics.alarToIntercanthal : null,
        lenToWidth: r ? r.metrics.lengthToWidth : null,
      };
    });
  });
}
