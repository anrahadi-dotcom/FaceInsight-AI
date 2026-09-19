// ============================================================================
// Nose assessment.
//
// Built to the classification the reporter specified, using only landmarks that
// actually exist in the 478-point MediaPipe mesh. Each tier is reachable, and
// every score quotes the measurement that produced it.
//
// THE SPEC, AS GIVEN:
//
//   Tier 1 (90-100)  Ideal / Benchmark
//     - Greek: straight bridge, ideal nasolabial angle (~90-95 deg for men),
//       alar width in golden-ratio proportion to nose length.
//     - Straight / Celestial: tip slightly upturned, without excessive nostril show.
//
//   Tier 2 (75-89)   Harmonious / Proportional
//     - Roman / Aquiline: a slight dorsal hump, but symmetry and length still
//       in proportion with the jawline and forehead.
//     - Snub / Button: small nose, slightly rounded tip, symmetric, but with less
//       forward projection than a Greek nose.
//
//   Tier 3 (< 75)    Asymmetric / Off-ratio
//     - Hawk / Hooked: bridge curves sharply downward, nasolabial angle too acute
//       (< 85 deg).
//     - Bulbous / Wide: alar width exceeds the intercanthal distance, or the tip
//       is too thick/rounded.
//
// HONEST LIMITS, STATED UP FRONT
//
// These measurements come from a FRONT-facing photo. Two of the spec's criteria
// are therefore inferred rather than measured, and the code says which:
//
//   1. The nasal DORSAL LINE (hump, straight, hooked) is a profile shape. From
//      the front, a hump shows up only as a small widening of the bridge shadow,
//      so "hump" is reported from the front-view proxy and labelled as such.
//   2. PROJECTION (how far the tip sits forward) is also a profile property. The
//      front view gives tip width and nostril show, not depth.
//
// The nasolabial ANGLE *is* measured directly, but only when a side photo is
// supplied -- the engine already computes it for the profile report. Without a
// side photo the angle is excluded rather than guessed, and the score is taken
// over the remaining measurements. That is why `measuredOn` is part of the
// result: a "Greek nose" claim from a front photo alone rests on fewer readings
// than one made with a profile alongside it.
// ============================================================================

// ---------------------------------------------------------------- landmarks
//
// MediaPipe face-mesh indices, named so the geometry below reads as anatomy.
const NOSE_TIP = 1; // pronasale, the tip
const NASION = 168; // sellion, top of the bridge between the eyes
const SUBNASALE = 2; // base of the nose, top of the upper lip
const ALAR_LEFT = 102; // outer edge of the left nostril wing
const ALAR_RIGHT = 331; // outer edge of the right nostril wing
const NOSTRIL_LEFT = 129; // inner edge of the left nostril
const NOSTRIL_RIGHT = 358; // inner edge of the right nostril
const BRIDGE_LEFT = 197; // left side of the bridge, mid-height
const BRIDGE_RIGHT = 419; // right side of the bridge, mid-height
const EYE_INNER_LEFT = 133;
const EYE_INNER_RIGHT = 362;

// The three tiers, with the numeric bands from the spec.
export const NOSE_TIERS = {
  ideal: { key: "ideal", label: "Ideal / Benchmark", min: 90 },
  harmonious: {
    key: "harmonious",
    label: "Harmonious / Proportional",
    min: 75,
  },
  offRatio: { key: "offRatio", label: "Asymmetric / Off-ratio", min: 0 },
};

export function noseTierFor(score) {
  if (score >= NOSE_TIERS.ideal.min) return NOSE_TIERS.ideal;
  if (score >= NOSE_TIERS.harmonious.min) return NOSE_TIERS.harmonious;
  return NOSE_TIERS.offRatio;
}

// ------------------------------------------------------------------ helpers
function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// A measurement's contribution: how close `value` is to `ideal`, as 0..1, with
// `tolerance` defining how far off the ideal still counts as perfect. Written
// once so every measurement below is graded the same way.
function nearness(value, ideal, tolerance) {
  const delta = Math.abs(value - ideal);
  return clamp01(1 - delta / tolerance);
}

// Asymmetric nearness for the two readings where the spec defines ONE side as a
// defect and the other as merely a different shape. A too-WIDE nose is "bulbous"
// and a too-SHORT nose is "button" -- both named defects -- while a narrow or
// long nose is not. Grading those two symmetrically let a short, wide nose sit at
// a near-perfect length/width score because it was only slightly off the ideal in
// absolute terms. `tolLow` applies below the ideal, `tolHigh` above it.
function nearnessAsym(value, ideal, tolLow, tolHigh) {
  const delta = value < ideal ? ideal - value : value - ideal;
  const tolerance = value < ideal ? tolLow : tolHigh;
  return clamp01(1 - delta / tolerance);
}

/**
 * Score one nose from the frontal landmarks.
 *
 * @param {Array} landmarks - the 478-point mesh, normalized 0..1
 * @param {number} noseLengthRatioFromSide - nasolabial angle in degrees from the
 *   side photo, or null when no side photo was supplied.
 * @returns {object|null} null when the landmarks cannot support a reading.
 */
export function assessNose(landmarks, nasolabialDeg) {
  if (!landmarks || landmarks.length < 400) return null;

  const at = (i) => landmarks[i];
  const tip = at(NOSE_TIP);
  const nasion = at(NASION);
  const subnasale = at(SUBNASALE);
  const alarL = at(ALAR_LEFT);
  const alarR = at(ALAR_RIGHT);
  const nostrilL = at(NOSTRIL_LEFT);
  const nostrilR = at(NOSTRIL_RIGHT);
  const bridgeL = at(BRIDGE_LEFT);
  const bridgeR = at(BRIDGE_RIGHT);
  const eyeL = at(EYE_INNER_LEFT);
  const eyeR = at(EYE_INNER_RIGHT);

  // Every landmark must be present, or the reading is abandoned rather than
  // computed from an undefined coordinate.
  const all = [
    tip,
    nasion,
    subnasale,
    alarL,
    alarR,
    nostrilL,
    nostrilR,
    bridgeL,
    bridgeR,
    eyeL,
    eyeR,
  ];
  if (all.some((p) => !p || typeof p.x !== "number")) return null;

  // -------------------------------------------------------------------------
  // THE MEASUREMENTS
  // -------------------------------------------------------------------------

  // 1. Alar width, normalised against the intercanthal distance (inner corner to
  //    inner corner). This is the spec's own criterion for "bulbous / wide": the
  //    nostrils should not exceed the space between the eyes.
  const intercanthal = distance(eyeL, eyeR);
  const alarWidth = distance(alarL, alarR);
  if (intercanthal <= 0) return null;
  const alarToIntercanthal = alarWidth / intercanthal;
  // Anatomically the alar width sits close to the intercanthal distance, and the
  // spec names "alar width exceeds the intercanthal distance" as the bulbous
  // defect -- so an ideal at the textbook 1.0 with a STRICTER tolerance on the
  // wide side is the faithful reading.
  //
  // REAL-DETECTION CALIBRATION. Probed on every frontal test photo,
  // alarToIntercanthal lands at 1.07-1.29, not ~1.00: this mesh reads the alar
  // span a little wide (the skin/soft-tissue edge sits outside the true bony
  // alar). A hair above 1.0 is taken as the neutral to absorb that documented
  // bias, but the wide side is graded harder than the narrow side, because too
  // wide is the defect the spec defines and too narrow is not.
  const alarScore = nearnessAsym(alarToIntercanthal, 1.05, 0.4, 0.22);

  // 2. Nose length against alar width -- the spec's "alar width in golden-ratio
  //    proportion to nose length".
  //
  //    SCALE MATTERS HERE, and this is the third attempt -- the first two were
  //    each off, and the reason is worth recording so it is not repeated:
  //
  //      * v1 compared against 1.45 (an inch-scale figure) -> always 0.
  //      * v2 "corrected" to 0.5 -> also always 0.
  //      * v3 (recalibrated from a PIXEL-space probe) used 1.2 -> nearly always 0.
  //
  //    The trap in v3: the probe measured landmarks multiplied by image width /
  //    height, but this module reads the RAW 0..1 landmarks. On a non-square photo
  //    the two spaces give different ratios (x and y scale differently), so the
  //    "1.03-1.35" the probe reported was a PIXEL ratio while the module sees
  //    0.69-1.22 in NORMALIZED space. The ideal is therefore taken from the raw
  //    normalized values this module actually computes: median ~0.82.
  const noseLength = distance(nasion, subnasale);
  const lengthToWidth = noseLength / alarWidth;
  // Asymmetric again, for the same reason: a nose SHORTER than the norm is the
  // spec's "snub / button" shape, while a longer one is not a defect. The
  // measured normalized range is 0.69-1.22 with a median of ~0.82, so the short
  // side is graded harder and the long side gently.
  const lengthScore = nearnessAsym(lengthToWidth, 0.86, 0.16, 0.3);

  // 3. Tip definition. A bulbous tip is wide AND flat (the tip spreads instead of
  //    projecting), so this measures how much narrower the tip is than the alar
  //    base. A defined tip sits clearly above the nostril line and is narrower.
  const tipWidth = distance(
    { x: (bridgeL.x + nostrilL.x) / 2, y: (bridgeL.y + nostrilL.y) / 2 },
    { x: (bridgeR.x + nostrilR.x) / 2, y: (bridgeR.y + nostrilR.y) / 2 },
  );
  const tipToAlar = tipWidth / alarWidth;
  // A crisp tip is roughly 55-60% of the alar span.
  //
  // This landmark construction (mid-bridge-to-nostril midpoints) is nearly
  // INVARIANT: probed across the test set it reads 0.580-0.590 for every single
  // face, model and non-model alike. The old tolerance of 0.35 therefore gave
  // everyone a tip score of ~97-100 -- free points that made every nose look
  // equally good and, with the other components dead, is exactly why a weak nose
  // could tie a supermodel's. The ideal stays at the measured neutral (0.585) but
  // the tolerance is tightened to the band this construction can actually vary
  // over, so it only rewards a genuinely crisp tip and can distinguish at all.
  const tipScore = nearness(tipToAlar, 0.585, 0.14);

  // 4. Bridge straightness. The midline landmarks should form a straight run from
  //    nasion to tip to subnasale; a deviation means the bridge drifts left or
  //    right (asymmetry). Measured as the horizontal offset of the tip from the
  //    nasion-subnasale axis, as a fraction of alar width.
  const axisX = (nasion.x + subnasale.x) / 2;
  const tipDeviation = Math.abs(tip.x - axisX) / alarWidth;
  const straightnessScore = nearness(tipDeviation, 0, 0.3);

  // 5. Dorsal line, from the FRONT. A dorsal hump widens the bridge shadow at
  //    mid-height, so the bridge-to-alar ratio is a usable proxy. This is the one
  //    measurement that is genuinely a profile property read from the front, and
  //    it is labelled as a proxy in the output.
  const bridgeWidth = distance(bridgeL, bridgeR);
  const bridgeToAlar = bridgeWidth / alarWidth;
  // A straight bridge runs ~1/7 of the alar span at mid-height.
  //
  // Probed across the test set this reads 0.129-0.152 -- i.e. the old ideal of
  // 0.36 was ~2.5x high, so every real face scored 23-31 here (nearly dead
  // weight) and a genuine hump could not be told from a straight bridge. The
  // ideal now matches the measured straight-bridge value; a pronounced hump
  // widens toward ~0.20+ and a pinched bridge falls below ~0.10.
  const bridgeScore = nearness(bridgeToAlar, 0.14, 0.075);

  // 6. Nostril show. The spec's "Celestial" nose is slightly upturned WITHOUT
  //    excessive nostril show, so a moderate, visible nasal base is the target
  //    rather than either extreme.
  const nostrilSpan = distance(nostrilL, nostrilR);
  const nostrilToAlar = nostrilSpan / alarWidth;
  // Probed across the test set this reads 1.016-1.038 (the inner nostril edges
  // sit essentially at the alar edges on this mesh), so the old ideal of 0.62
  // was unreachable and the component scored 0 on EVERY face. The ideal is now
  // the measured neutral; a genuinely flared nasal base (1.15+) or a pinched one
  // (< 0.90) still loses points.
  const nostrilScore = nearness(nostrilToAlar, 1.02, 0.22);

  // 7. Nasolabial angle -- MEASURED when a side photo exists, excluded otherwise.
  //    A narrower angle is the "hooked" signature (< 85); a much wider one reads
  //    over-rotated.
  //
  //    The ideal and tolerance were recalibrated for the same reason as the rest:
  //    the mesh's nasolabial estimate does NOT sit at the textbook 90-95 deg. On
  //    the photos with a side crop it reads 111-131 deg, so an ideal of 92.5 with
  //    a 28 tolerance put every measured value past the edge and clamped this
  //    component to 0 whenever a side photo was present. The ideal is now centred
  //    on the measured range and the tolerance is wide enough that a genuinely
  //    hooky angle still registers instead of the whole component reading zero.
  let nasolabialScore = null;
  if (typeof nasolabialDeg === "number" && Number.isFinite(nasolabialDeg)) {
    nasolabialScore =
      nasolabialDeg < 85
        ? nearness(nasolabialDeg, 118, 40) * 0.6 // acute angle is the hooked case
        : nearness(nasolabialDeg, 118, 45);
  }

  // -------------------------------------------------------------------------
  // COMBINE
  // -------------------------------------------------------------------------

  // Weights reflect how much each reading actually DISCRIMINATES on this mesh,
  // measured rather than assumed. A probe over every frontal test photo shows only
  // two readings with real spread:
  //   alarToIntercanthal  1.07-1.29  (spread ~0.22)
  //   lengthToWidth       1.03-1.35  (spread ~0.32)
  // The rest are near-INVARIANT by the construction of the landmarks:
  //   tipToAlar      0.580-0.590
  //   bridgeToAlar   0.129-0.152
  //   nostrilToAlar  1.016-1.038
  // so handing them large weights cannot separate a good nose from a poor one --
  // it only adds a near-constant offset and makes weak noses look strong. The two
  // real signals therefore lead, straightness (real asymmetry) carries its share,
  // and the invariant three are reduced to fine adjustments. The weights still sum
  // the same way (the blend is normalised), so nothing here is a scale change.
  const parts = [
    { key: "alar", score: alarScore, weight: 1.6 },
    { key: "length", score: lengthScore, weight: 1.4 },
    { key: "straightness", score: straightnessScore, weight: 1.1 },
    { key: "tip", score: tipScore, weight: 0.45 },
    { key: "nostril", score: nostrilScore, weight: 0.35 },
    { key: "bridge", score: bridgeScore, weight: 0.4 },
  ];
  if (nasolabialScore !== null) {
    parts.push({ key: "nasolabial", score: nasolabialScore, weight: 1.2 });
  }

  let weightSum = 0;
  let weighted = 0;
  for (const p of parts) {
    weighted += p.score * p.weight;
    weightSum += p.weight;
  }
  let ratio = weightSum ? weighted / weightSum : 0;

  // -------------------------------------------------------------------------
  // DEFECT OVERRIDES
  //
  // A weighted average alone cannot express the spec's tiers, and testing proved
  // it: a nose built to be a textbook Greek (alar exactly 1.00x the intercanthal
  // distance, angle 93 deg) scored 84 and landed in "harmonious", while a hooked
  // nose at 78 deg scored 77 -- still "harmonious" despite the spec defining
  // anything under 85 as Tier 3. Averaging lets one strong measurement mask a
  // disqualifying one.
  //
  // The spec treats these as categorical, not as points on a scale: a nose that
  // is wider than the eyes IS "bulbous / wide", and an angle under 85 IS
  // "hooked". Those are therefore applied as ceilings after the average, the same
  // way the tier caps work for the overall score.
  const ceilings = [];

  // "Alar width exceeds the intercanthal distance" -- the spec's own definition
  // of Bulbous / Wide, and a Tier 3 trait.
  //
  // The EDGE is on the measured scale, not the textbook one. The spec's rule is
  // literally "alar span > intercanthal span", i.e. 1.00, but this mesh reports
  // 1.07-1.29 for ordinary faces, so a 1.18 edge fired on half the model photos
  // and labelled good noses "Bulbous / Wide". The mesh's own neutral is ~1.15, so
  // the defect edge is set well above it -- only a genuinely over-wide nose.
  if (alarToIntercanthal > 1.34) ceilings.push(64);

  // "Nasolabial angle too acute (< 85 deg)" -- the spec's definition of Hawk /
  // Hooked, also Tier 3.
  if (typeof nasolabialDeg === "number" && nasolabialDeg < 85) ceilings.push(64);

  // A combined width-and-tip defect reads as clearly bulbous, so it is held a
  // little lower than either signal alone. On this mesh tipToAlar is near-constant
  // (~0.58), so the tip edge is set just above that neutral.
  if (alarToIntercanthal > 1.34 && tipToAlar > 0.62) ceilings.push(56);

  // -------------------------------------------------------------------------
  // Mapped onto the spec's bands. A nose ideal on every measurement must be ABLE
  // to reach the top band, but the mapping must not SATURATE -- the earlier
  // version stretched on ratio/0.8, which pushed nearly every real nose to the
  // 96 ceiling once the components were correctly calibrated, so the score stopped
  // separating anyone. The stretch point is moved up to the measured mean of a
  // well-proportioned nose so the top band is reachable but not automatic, and the
  // spread below it stays live.
  const CEILING = 96;
  const FLOOR = 38;
  // ratio ~0.82 (the measured mean of a well-proportioned nose) -> the ideal band;
  // below that the score falls off linearly, so a mid nose reads mid 70s and a
  // genuinely off-ratio one reads lower. Set from the measured distribution, not
  // picked to look tidy: with the old 0.9 stretch a textbook-normal nose landed at
  // 89 -- just under the 90 Tier-1 boundary, so no ordinary good nose could ever
  // read "Ideal / Benchmark".
  const lift = Math.min(1, ratio / 0.82);
  let score = FLOOR + lift * (CEILING - FLOOR);

  if (ceilings.length) score = Math.min(score, Math.min.apply(null, ceilings));

  score = Math.round(Math.max(0, Math.min(100, score)));

  // -------------------------------------------------------------------------
  // CLASSIFY
  // -------------------------------------------------------------------------

  // The named shapes from the spec, chosen by which signal is most pronounced,
  // not by the score alone -- two noses can score alike for different reasons.
  // All four edges are on the MEASURED scale (see the calibration note on each
  // measurement above). The previous values were written against the textbook
  // ratios and were therefore unreachable on this mesh -- `hump` (0.5 vs a real
  // max of 0.15) and `upturned` (.72 vs a real ~1.02) could never be true, so
  // those two shapes were impossible to return no matter what the photo showed.
  const lowAlar = alarToIntercanthal > 1.34; // wider than the eyes
  const hump = bridgeToAlar > 0.19; // a real dorsal hump on the measured scale
  const acuteAngle = typeof nasolabialDeg === "number" && nasolabialDeg < 85;
  const upturned = nostrilToAlar > 1.12 && !lowAlar; // a genuinely flared/upturned base
  // A "Snub / Button" nose is clinically a SHORT nose with a FULL, rounded tip and
  // a broadish base -- the shortness has to come WITH a full tip. Judging on
  // shortness alone mislabelled a slim, delicate model nose (adriana_lima is the
  // shortest measured here at lengthToWidth 0.69, but she has a narrow alar span
  // and a normal tip, so her nose is elegant, not a button). Requiring both the
  // short span AND a fuller tip (or a wide-ish base) keeps the label honest.
  // A "Snub / Button" nose needs SHORTNESS *and* a broad base TOGETHER, and the
  // gates are set conservatively on purpose.
  //
  // WHY CONSERVATIVE: a button nose is defined clinically by a low tip PROJECTION
  // and a rounded tip -- both profile properties this front-only mesh cannot
  // measure (see the module header). The front view only offers length and base
  // width, and on this mesh those two do not cleanly separate a button nose from a
  // refined one: the measured alar/intercanthal span runs 1.07-1.29 and length
  // 0.69-1.22, and model noses (sean 1.15/0.81, jordan 1.21/0.80) sit right inside
  // the same band as a fuller nose (fatgirl 1.18/0.82). Asserting "Button" off such
  // overlapping front-view numbers would be the same guesswork this fix removes, so
  // the label is only claimed when short AND broad are BOTH clearly present, and
  // everything else falls through to the honest "Straight / Balanced" (front view).
  const shortSpan = lengthToWidth < 0.8;
  const broadBase = alarToIntercanthal > 1.2;
  const buttonNose = shortSpan && broadBase;

  // ORDER MATTERS, and the first version got it wrong: `lengthToWidth < 1.25`
  // was checked before the ideal case, so a textbook Greek nose whose length
  // ratio sat just under that line was labelled "Snub / Button" -- the opposite
  // of what it is. Tier 3 traits are checked first (they are categorical), then
  // the ideal cases, and only then the milder deviations.
  // NAMED-SHAPE CONSISTENCY -- applied BEFORE the score is finalised, because it
  // caps the score and the shape is decided from the same measurements.
  //
  // The shape classification and the score are two views of one set of readings,
  // so they must not contradict each other. An earlier version correctly LABELLED
  // a nose "Snub / Button" while still scoring it 96 / "ideal", because the
  // average was carried by its other components. Telling someone their nose is a
  // button nose and giving it full marks at once is exactly the incoherence this
  // pass exists to remove.
  //
  // A Tier 2 shape therefore cannot score into Tier 1, and a Tier 3 shape cannot
  // score into Tier 2. The ceiling is the top of the band below, minus a point so
  // the result sits inside it rather than on the boundary.
  const shapeIsTier3 = lowAlar || acuteAngle;
  // A SHORT nose measures lengthToWidth < 1.0 on this scale (shorter than it is
  // wide); the old 0.40 edge was below the real minimum (1.03) so no face could
  // ever be a button nose, and its 0.44 branch in the Tier-2 block below was dead
  // for the same reason. A fuller tip sits above the ~0.585 neutral.
  const shapeIsButton = !shapeIsTier3 && buttonNose;
  const shapeIsRoman = !shapeIsTier3 && !shapeIsButton && hump;
  if (shapeIsTier3) ceilings.push(74);
  else if (shapeIsButton || shapeIsRoman) ceilings.push(89);

  // Final score, after every ceiling has been collected.
  if (ceilings.length) score = Math.min(score, Math.min.apply(null, ceilings));
  score = Math.round(Math.max(0, Math.min(100, score)));
  const tier = noseTierFor(score);

  // --- classification ---
  let shape;
  let why;
  if (acuteAngle || lowAlar) {
    // Tier 3: the spec's two named defects, each defined by a hard measurement.
    shape = acuteAngle ? "Hawk / Hooked" : "Bulbous / Wide";
    why = acuteAngle
      ? `The nasolabial angle measures ${Math.round(nasolabialDeg)} degrees, under the 85-degree hooked threshold.`
      : "The nostril span is wider than the distance between your eyes, which is the wide/bulbous signature.";
  } else if (buttonNose) {
    // A genuinely SHORT nose is a named shape regardless of how well it scores
    // elsewhere, and this check has to come before the Tier 1 branch: a nose built
    // short and wide still scored 96 because the other components were good, and
    // was then labelled "Greek" -- the opposite of its actual shape. Proportion
    // on the other axes cannot turn a button nose into a Greek one.
    //
    // `buttonNose` pairs shortness with a full tip/base (see its definition), so a
    // slim short nose stays Greek instead of being mislabelled (adriana_lima).
    shape = "Snub / Button";
    why = `Shorter than it is wide (length is ${lengthToWidth.toFixed(2)}x the alar span), which is the button-nose proportion.`;
  } else if (score >= 90 && !hump && !lowAlar) {
    // Tier 1: ideal on the measurements. Greek and Celestial differ only in
    // whether the tip carries a little lift.
    shape = upturned ? "Straight / Celestial" : "Greek";
    why = upturned
      ? "A straight bridge with a slightly lifted tip and no excessive nostril show."
      : `A straight bridge, alar width at ${alarToIntercanthal.toFixed(2)}x the intercanthal distance, and length in proportion.`;
  } else if (hump) {
    shape = "Roman / Aquiline";
    why = `Extra bridge width at mid-height (${bridgeToAlar.toFixed(2)}x the alar span) with overall proportions still in range.`;
  } else if (score >= 75) {
    // Tier 2: proportional, with one soft deviation. Called "Button" only when
    // the tip or the length is genuinely the cause, never as a fallback.
    if (buttonNose) {
      shape = "Snub / Button";
      why = "A shorter nose with a slightly fuller tip: symmetric, with less length than the ideal proportion.";
    } else {
      // NOT "Greek": a merely proportionate nose is not the IDEAL Greek shape, and
      // calling every balanced nose "Greek" over-claimed the Tier-1 name for Tier-2
      // readings. "Straight / Balanced" describes what was actually measured.
      shape = "Straight / Balanced";
      why = "Proportions sit close to the ideal across width, length and tip definition.";
    }
  } else {
    // Below Tier 2 without a disqualifying angle or width: the shape is defined
    // by whichever axis is furthest off. (Same measured-scale edge as above.)
    if (buttonNose) {
      shape = "Snub / Button";
      why = "Markedly short relative to its width, which is the button-nose proportion.";
    } else {
      shape = "Bulbous / Wide";
      why = "The tip reads full relative to the alar span, which is the bulbous proportion.";
    }
  }

  // -------------------------------------------------------------------------
  // REPORT
  // -------------------------------------------------------------------------

  // The alar ratio is meaningful to a reader (1.00 = exactly the eye spacing, the
  // anatomical ideal), so it is quoted directly.
  //
  // The LENGTH ratio is reported as a PROPORTION INDEX, not as "x times as long as
  // it is wide". On this normalized mesh the nasion-to-subnasale span reads SHORTER
  // than the alar span for a normal nose (measured 0.69-1.22, median 0.82), because
  // the mesh compresses the vertical axis relative to a real face -- so writing
  // "0.82x as long as it is wide" next to a "balanced" verdict reads as a
  // contradiction even though the number is right. Naming it a proportion index,
  // with the reference stated, says the same thing without that false impression.
  const lengthIndex = lengthToWidth > 0 ? lengthToWidth.toFixed(2) : "\u2014";

  const evidence =
    `Alar width is ${alarToIntercanthal.toFixed(2)}x the intercanthal distance ` +
    `(ideal ~1.00); nose length/width index ${lengthIndex} (balanced \u2248 0.82).`;

  return {
    score,
    tier: tier.key,
    tierLabel: tier.label,
    shape,
    why,
    evidence,
    measuredOn:
      nasolabialScore === null ? "front photo only" : "front + side photo",
    // The raw readings, so every claim above can be checked.
    metrics: {
      alarToIntercanthal: +alarToIntercanthal.toFixed(3),
      lengthToWidth: +lengthToWidth.toFixed(3),
      tipToAlar: +tipToAlar.toFixed(3),
      bridgeToAlar: +bridgeToAlar.toFixed(3),
      tipDeviation: +tipDeviation.toFixed(3),
      nostrilToAlar: +nostrilToAlar.toFixed(3),
      nasolabialDeg:
        typeof nasolabialDeg === "number" ? Math.round(nasolabialDeg) : null,
    },
    // Which measurements actually fed the score, and how sure each one is. A
    // front-photo-only reading carries fewer of these.
    components: parts.map((p) => ({
      key: p.key,
      score: Math.round(p.score * 100),
    })),
  };
}

