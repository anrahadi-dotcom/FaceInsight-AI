// Verify the nose assessment: every tier from the spec must be REACHABLE, and the
// classification must move with the measurements. Synthetic meshes are built here
// with known geometry, so the expected outcome is stated before it is checked.
export default async function run(page) {
  return page.evaluate(async () => {
    const nose = await import("/js/nose.js");

    // A minimal 478-point mesh. Only the indices the nose module reads matter;
    // everything else is parked far off-screen so a stray read is obvious.
    function makeMesh({
      alarWidth,
      noseLength,
      tipWidth,
      bridgeWidth,
      nostrilSpan,
      tipOffset,
    }) {
      const pts = new Array(478)
        .fill(null)
        .map(() => ({ x: -99, y: -99, z: 0 }));

      const cx = 0.5;
      const alarHalf = alarWidth / 2;
      // Eyes 0.30 apart, which is the realistic intercanthal span.
      pts[133] = { x: cx - 0.15, y: 0.4, z: 0 }; // inner corner left
      pts[362] = { x: cx + 0.15, y: 0.4, z: 0 }; // inner corner right

      pts[168] = { x: cx, y: 0.38, z: 0 }; // nasion
      pts[2] = { x: cx, y: 0.38 + noseLength, z: 0 }; // subnasale
      pts[1] = { x: cx + tipOffset, y: 0.38 + noseLength * 0.78, z: 0 }; // tip

      pts[102] = { x: cx - alarHalf, y: 0.38 + noseLength * 0.9, z: 0 }; // alar L
      pts[331] = { x: cx + alarHalf, y: 0.38 + noseLength * 0.9, z: 0 }; // alar R

      pts[129] = { x: cx - nostrilSpan / 2, y: 0.38 + noseLength * 0.9, z: 0 };
      pts[358] = { x: cx + nostrilSpan / 2, y: 0.38 + noseLength * 0.9, z: 0 };

      pts[197] = { x: cx - bridgeWidth / 2, y: 0.38 + noseLength * 0.45, z: 0 };
      pts[419] = { x: cx + bridgeWidth / 2, y: 0.38 + noseLength * 0.45, z: 0 };

      return pts;
    }

    // Cases chosen to land in each named shape from the spec, by construction.
    //
    // IMPORTANT -- SCALE. This mesh is in NORMALIZED 0..1 space (intercanthal is
    // 0.30), and the nose module's ratios are read on THAT scale. The earlier
    // version of these cases used a DIFFERENT scale (alar 0.3, bridge 0.108 ->
    // bridgeToAlar 0.36) that does not occur on real photos (measured 0.13-0.15),
    // so it was asserting behaviour against ratios the scorer never actually sees.
    // The numbers below are taken from the real normalized distribution:
    //   alarToIntercanthal 1.07-1.29, lengthToWidth 0.69-1.22, bridgeToAlar 0.13-0.15.
    // With intercanthal = 0.30: alarWidth = 0.30 * alarRatio, and so on.
    const cases = [
      {
        // Greek ideal: alar ~1.15x eyes, length ~0.82x width, straight bridge.
        name: "Greek: ideal proportions",
        mesh: makeMesh({
          alarWidth: 0.345,
          noseLength: 0.283,
          tipWidth: 0.2,
          bridgeWidth: 0.048, // bridgeToAlar ~0.14 = straight
          nostrilSpan: 0.352,
          tipOffset: 0,
        }),
        angle: 121, // the mesh's own neutral (its scale, not the textbook 92)
        expectTier: "ideal",
      },
      {
        // Celestial: same ideal proportions, tip lifted, no excessive nostril show.
        name: "Celestial: upturned, open nostrils",
        mesh: makeMesh({
          alarWidth: 0.345,
          noseLength: 0.3,
          tipWidth: 0.2,
          bridgeWidth: 0.048,
          nostrilSpan: 0.352,
          tipOffset: 0.01,
        }),
        angle: 135,
        expectTier: "ideal",
      },
      {
        // Roman: a real dorsal hump -- bridgeToAlar ~0.22, well above the 0.15 norm.
        name: "Roman: bridge hump",
        mesh: makeMesh({
          alarWidth: 0.345,
          noseLength: 0.283,
          tipWidth: 0.2,
          bridgeWidth: 0.076, // bridgeToAlar ~0.22 = hump proxy
          nostrilSpan: 0.352,
          tipOffset: 0,
        }),
        angle: 121,
        expectShape: "Roman / Aquiline",
      },
      {
        // Button: short AND broad base together (length ~0.75x, alar ~1.25x).
        name: "Button: short and rounded",
        mesh: makeMesh({
          alarWidth: 0.375,
          noseLength: 0.281,
          tipWidth: 0.22,
          bridgeWidth: 0.053,
          nostrilSpan: 0.383,
          tipOffset: 0,
        }),
        angle: 121,
        expectShape: "Snub / Button",
      },
      {
        // Bulbous: alar span clearly past the intercanthal distance (~1.6x).
        name: "Bulbous: alar wider than the eyes",
        mesh: makeMesh({
          alarWidth: 0.48,
          noseLength: 0.394,
          tipWidth: 0.3,
          bridgeWidth: 0.067,
          nostrilSpan: 0.49,
          tipOffset: 0,
        }),
        angle: 121,
        expectTier: "offRatio",
      },
      {
        name: "Hawk: acute nasolabial angle",
        mesh: makeMesh({
          alarWidth: 0.345,
          noseLength: 0.283,
          tipWidth: 0.2,
          bridgeWidth: 0.048,
          nostrilSpan: 0.352,
          tipOffset: 0,
        }),
        angle: 78, // < 85 -> hooked
        expectShape: "Hawk / Hooked",
        expectTier: "offRatio",
      },
    ];

    const results = cases.map((c) => {
      const r = nose.assessNose(c.mesh, c.angle);
      return {
        name: c.name,
        score: r ? r.score : null,
        tier: r ? r.tier : null,
        shape: r ? r.shape : null,
        expectTier: c.expectTier || null,
        expectShape: c.expectShape || null,
        tierOk: c.expectTier ? r && r.tier === c.expectTier : null,
        shapeOk: c.expectShape ? r && r.shape === c.expectShape : null,
        alarRatio: r ? r.metrics.alarToIntercanthal : null,
        measuredOn: r ? r.measuredOn : null,
      };
    });

    // Gates that must refuse rather than guess.
    const gates = {
      nullLandmarks: nose.assessNose(null, 90),
      shortArray: nose.assessNose([{ x: 0, y: 0 }], 90),
      noAngle: nose.assessNose(
        makeMesh({
          alarWidth: 0.3,
          noseLength: 0.15,
          tipWidth: 0.18,
          bridgeWidth: 0.11,
          nostrilSpan: 0.19,
          tipOffset: 0,
        }),
        null,
      ),
    };

    const tiersSeen = new Set(results.map((r) => r.tier).filter(Boolean));
    const shapesSeen = new Set(results.map((r) => r.shape).filter(Boolean));

    return {
      results,
      tiersReachable: [...tiersSeen].sort(),
      shapesReachable: [...shapesSeen].sort(),
      gates: {
        nullRefused: gates.nullLandmarks === null,
        shortRefused: gates.shortArray === null,
        noAngleStillScored: gates.noAngle ? gates.noAngle.score : null,
        noAngleLabel: gates.noAngle ? gates.noAngle.measuredOn : null,
      },
      allTierChecksPass: results.every((r) => r.tierOk !== false),
      allShapeChecksPass: results.every((r) => r.shapeOk !== false),
    };
  });
}
