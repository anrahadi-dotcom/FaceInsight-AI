// ============================================================================
// Hairstyle recommendations, derived from the face shape the engine measured.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// This is a RULE-BASED advisor, not a trained model. The measurement underneath
// it is genuinely automatic (MediaPipe's 478-point mesh, reduced to the width
// ratios in faceEngine.js), but the hair advice on top is hand-written stylist
// logic: `if the lower face is wide, add height on top and keep the sides
// tight`. That is the same reasoning a barber uses, and it is testable -- each
// rule cites the measurement that triggered it.
//
// It is deliberately NOT labelled as an AI prediction anywhere in the UI,
// because claiming a generative model's insight for an if/else would be a lie
// the first time a user asked how it works.
//
// WHY SHAPE DRIVES THE RECOMMENDATION
//
// Hair's job on a face is proportion: it changes the apparent width of the top
// third and the height of the silhouette. So the useful inputs are exactly the
// three ratios computeFaceShape already measures -- length/width, jaw/cheek and
// forehead/cheek -- plus the derived shape label. Nothing here re-measures the
// photo; it consumes the engine's numbers so the two can never disagree.
// ============================================================================

// ---------------------------------------------------------------- shape table
//
// `wants` is the goal in plain language; `avoid` is the failure mode. Both are
// shown to the user, so they have to be readable on their own, without the
// numbers behind them.
//
// Keys match the `shape` strings computeFaceShape can return. Note it can also
// return "Oval (balanced)" or "Oval · wide brow · tapered jaw" as a display
// label -- normalizeShape() below maps all of those back to a base key.
const SHAPE_PROFILE = {
  Oval: {
    wants: "Gentle length and balance — an oval can carry most cuts.",
    avoid: "Heavy horizontal fringes that flatten the forehead.",
  },
  Round: {
    wants:
      "Height on top and tightness at the sides — lengthen the silhouette.",
    avoid: "Rounded, voluminous sides and a blunt full fringe; both add width.",
  },
  Square: {
    wants: "Soft, textured edges that break the strong jaw line.",
    avoid: "A flat, blocky top or a perfectly straight hairline edge.",
  },
  Heart: {
    wants: "Volume from the temples down, and a softer upper silhouette.",
    avoid: "Extra height at the crown, which widens the forehead further.",
  },
  Diamond: {
    wants: "Width at the forehead and jaw to offset the cheekbones.",
    avoid:
      "Shaved or very tight sides, which expose the cheekbone widest point.",
  },
  Oblong: {
    wants: "Width and horizontal weight — shorten the apparent face length.",
    avoid: "Tall pompadours and long straight styles; they stretch the face.",
  },
  Triangle: {
    wants: "Volume on top and at the temples to balance a wide jaw.",
    avoid: "Tight sides with no top volume — it exaggerates the lower face.",
  },
  Rectangle: {
    wants: "Softening curves and medium length to ease a long, straight face.",
    avoid: "Severe straight lines and very short crops.",
  },
};

// --------------------------------------------------------------- cuts library
//
// Each cut declares which shapes it flatters and why. `why` is written to be
// quoted directly in the UI next to a real measurement, so it should explain the
// mechanic (what the cut does to proportion), not just assert a preference.
const CUTS = [
  {
    id: "textured-quiff",
    name: "Textured Quiff",
    tags: ["short", "modern"],
    fits: ["Round", "Square", "Triangle", "Oval"],
    why: "Adds height without bulk at the sides, which lengthens a wide or short face.",
  },
  {
    id: "side-part-classic",
    name: "Classic Side Part",
    tags: ["short", "formal"],
    fits: ["Oval", "Round", "Heart", "Rectangle"],
    why: "The asymmetric line breaks up roundness and reads as a deliberate, tidy silhouette.",
  },
  {
    id: "crew-buzz",
    name: "Crew Cut / Buzz",
    tags: ["short", "low-maintenance"],
    fits: ["Oval", "Diamond", "Square"],
    why: "Keeps the face's own proportions on show — best when the underlying structure is already even.",
  },
  {
    id: "french-crop",
    name: "French Crop with Fringe",
    tags: ["short", "textured"],
    fits: ["Oblong", "Rectangle", "Diamond", "Heart"],
    why: "The fringe covers the upper forehead, which shortens a long face and narrows a wide brow.",
  },
  {
    id: "pompadour",
    name: "Pompadour",
    tags: ["medium", "volume"],
    fits: ["Round", "Square", "Triangle"],
    why: "Maximum height and swept-back volume; strongest tool against a wide lower face.",
  },
  {
    id: "middle-part",
    name: "Middle Part (Curtain)",
    tags: ["medium", "soft"],
    fits: ["Heart", "Diamond", "Oval", "Triangle"],
    why: "Frames the temples and adds width where a heart or diamond shape is narrowest.",
  },
  {
    id: "slick-back",
    name: "Slick Back",
    tags: ["medium", "formal"],
    fits: ["Oval", "Square", "Diamond"],
    why: "Tight at the sides with controlled top volume — keeps a defined jaw as the focus.",
  },
  {
    id: "long-layered",
    name: "Long, Layered",
    tags: ["long", "soft"],
    fits: ["Square", "Rectangle", "Oblong", "Triangle"],
    why: "Soft layers soften hard angles and add the width a long face needs.",
  },
  {
    id: "wavy-shoulder",
    name: "Wavy Shoulder-Length",
    tags: ["long", "volume"],
    fits: ["Oblong", "Rectangle", "Heart", "Diamond"],
    why: "Horizontal weight at the sides shortens a long face and balances a narrow jaw.",
  },
  {
    id: "bob-blunt",
    name: "Blunt Bob",
    tags: ["medium", "structured"],
    fits: ["Oblong", "Triangle", "Oval"],
    why: "A straight line at the jaw adds width there and gives a long face a visual stop.",
  },
  {
    id: "curly-volume",
    name: "Curly with Crown Volume",
    tags: ["volume", "textured"],
    fits: ["Round", "Square", "Triangle", "Rectangle"],
    why: "Lift at the crown and softness at the edges lengthens the face and relaxes sharp lines.",
  },
];

// ------------------------------------------------------------------- helpers

// computeFaceShape returns either a bare shape ("Round") or a display string
// with observations appended ("Oval · wide brow · tapered jaw"). This strips it
// back to the base key so the table lookup can never miss.
export function normalizeShape(faceShape) {
  if (!faceShape) return "Oval";
  const base = String(faceShape).split("·")[0].trim();
  if (/^oval/i.test(base)) return "Oval";
  return SHAPE_PROFILE[base] ? base : "Oval";
}

// The observations computeFaceShape appended, as structured flags. Used to bias
// the pick (a wide jaw pushes toward top volume) rather than only to decorate.
function readModifiers(faceShape) {
  const text = String(faceShape || "").toLowerCase();
  return {
    wideJaw: text.includes("wide jaw"),
    taperedJaw: text.includes("tapered jaw"),
    wideBrow: text.includes("wide brow"),
    narrowBrow: text.includes("narrow brow"),
    balanced: text.includes("balanced"),
  };
}

function trim(text) {
  const i = String(text || "").indexOf("·");
  return (i === -1 ? text : text.slice(0, i)).trim();
}

// ------------------------------------------------------------------ the engine

/**
 * Build hairstyle recommendations from a completed front-photo analysis.
 *
 * Returns null when the analysis cannot support a recommendation -- a missing
 * face, or frontal metrics that were substituted rather than measured. Returning
 * null (and letting the UI say so) is deliberate: guessing a hairstyle from an
 * unmeasured face would be inventing the most confident-sounding part of the app
 * from the least reliable input.
 *
 * @param {object} analysis - the object from analyzeFrontPhoto / combineAnalysis
 * @returns {null | {shape, shapeLabel, summary, avoid, cuts, confidence}}
 */
export function recommendHairstyles(analysis) {
  if (!analysis) return null;
  // Same gate computeStrengths uses, for the same reason.
  if (analysis.noFace) return null;
  if (
    analysis.frontalMetricsMeasured === false ||
    analysis.overallMeasured === false
  ) {
    return null;
  }
  if (!analysis.faceShape) return null;

  const shape = normalizeShape(analysis.faceShape);
  const profile = SHAPE_PROFILE[shape];
  const mods = readModifiers(analysis.faceShape);

  // Score every cut: a base hit for fitting the shape, then adjustments for the
  // specific structural observations. The adjustments are small (they reorder
  // within a shape, they do not override it) so the output stays explainable:
  // "these suit a Round face, and the top pick leans on your wide jaw."
  const scored = CUTS.map((cut) => {
    let score = cut.fits.includes(shape) ? 100 : 0;
    if (!cut.fits.includes(shape)) {
      // A cut that does not fit can still be suggested if the structure it
      // addresses is the face's actual measured feature. Kept low on purpose.
      score = 10;
    }

    const has = (...tags) => tags.every((t) => cut.tags.includes(t));
    const isShort = cut.tags.includes("short");

    if (mods.wideJaw) {
      if (has("volume")) score += 14;
      if (isShort) score += 6;
      if (cut.id === "crew-buzz") score -= 18; // exposes the widest point
    }
    if (mods.taperedJaw) {
      if (cut.id === "curly-volume" || cut.id === "wavy-shoulder") score += 8;
      if (cut.id === "crew-buzz") score += 6;
    }
    if (mods.wideBrow) {
      if (cut.id === "french-crop") score += 16; // the fringe is the whole point
      if (cut.id === "slick-back" || cut.id === "pompadour") score -= 10;
    }
    if (mods.narrowBrow) {
      if (cut.id === "middle-part" || cut.id === "pompadour") score += 10;
    }
    if (mods.balanced) {
      // A balanced face supports the clean, low-intervention cuts.
      if (cut.id === "crew-buzz" || cut.id === "side-part-classic") score += 8;
    }

    return { cut, score };
  });

  scored.sort(
    (a, b) => b.score - a.score || a.cut.name.localeCompare(b.cut.name),
  );

  // Four is the useful number: enough that one of them will appeal, few enough
  // that the list reads as a shortlist rather than a catalogue.
  const cuts = scored
    .filter((s) => s.score > 0)
    .slice(0, 4)
    .map(({ cut }) => ({
      id: cut.id,
      name: cut.name,
      tags: cut.tags,
      why: cut.why,
    }));

  // Confidence follows the engine's own honesty about the shape call. An
  // ambiguous classification means the width ratios were near a tie, so the
  // recommendations are "worth trying" rather than "made for you".
  const ambiguous = /·/.test(String(analysis.faceShape)) || mods.balanced;
  const faceFatScore =
    analysis.faceFat && typeof analysis.faceFat.score === "number"
      ? analysis.faceFat.score
      : null;
  // A full lower face makes the "add height" advice more valuable, so it is
  // surfaced as a note rather than fed back into the ranking (which would
  // double-count the jaw signal already handled above).
  const note =
    faceFatScore !== null && faceFatScore < 45
      ? "Your lower face reads fuller, so lean toward the cuts that add height on top."
      : null;

  return {
    shape,
    shapeLabel: trim(analysis.faceShape),
    summary: profile.wants,
    avoid: profile.avoid,
    cuts,
    note,
    confidence: ambiguous ? "shape-near-oval" : "shape-clear",
  };
}

/**
 * The one-line reason a specific cut was shortlisted, for the UI to show under
 * its name. Kept separate from recommendHairstyles so the copy can be reused
 * without re-running the ranking.
 */
export function reasonForCut(cut, analysis) {
  const shapeLabel = trim(analysis && analysis.faceShape);
  return `Suits a ${shapeLabel || "balanced"} face — ${(cut && cut.why) || ""}`;
}
