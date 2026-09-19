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
// `style` gates the cut to a presentation: "masc", "fem", or "any". Without it
// the shortlist mixed a Pompadour into the same list as a Blunt Bob -- advice for
// two different people arriving in one answer. The engine reports a gender, so a
// man's and a woman's results can now actually differ.
// `tags` MUST begin with exactly one length tag, from LENGTHS below -- the length
// filter reads tags[0], so a cut with no length tag would be invisible to every
// filter. Kept as the first tag so the old display code (which shows tags[0]
// first) reads naturally too.
const CUTS = [
  // ---------------------------------------------------------------- short masc
  {
    id: "textured-quiff",
    name: "Textured Quiff",
    style: "masc",
    tags: ["short", "modern"],
    fits: ["Round", "Square", "Triangle", "Oval"],
    why: "Adds height without bulk at the sides, which lengthens a wide or short face.",
  },
  {
    id: "crew-buzz",
    name: "Crew Cut / Buzz",
    style: "masc",
    tags: ["short", "low-maintenance"],
    fits: ["Oval", "Diamond", "Square"],
    why: "Keeps the face's own proportions on show — best when the underlying structure is already even.",
  },
  {
    id: "french-crop",
    name: "French Crop with Fringe",
    style: "masc",
    tags: ["short", "textured"],
    fits: ["Oblong", "Rectangle", "Diamond", "Heart"],
    why: "The fringe covers the upper forehead, which shortens a long face and narrows a wide brow.",
  },
  {
    id: "pompadour",
    name: "Pompadour",
    style: "masc",
    tags: ["medium", "volume"],
    fits: ["Round", "Square", "Triangle"],
    why: "Maximum height and swept-back volume; strongest tool against a wide lower face.",
  },
  {
    id: "slick-back",
    name: "Slick Back",
    style: "masc",
    tags: ["medium", "formal"],
    fits: ["Oval", "Square", "Diamond"],
    why: "Tight at the sides with controlled top volume — keeps a defined jaw as the focus.",
  },

  // --------------------------------------------------------- modern masc 2025
  // The current crop of styles: fades with texture on top, and the softer grown-
  // out looks that replaced the hard side-part. Each is here because it does the
  // same proportional job as a classic, but is what someone would actually ask
  // for at a barber right now.
  {
    id: "mid-taper-fringe",
    name: "Mid Taper Fade + Textured Fringe",
    style: "masc",
    tags: ["short", "2025"],
    fits: ["Round", "Oblong", "Rectangle", "Heart"],
    why: "Faded sides keep the width down while a loose fringe cuts the forehead height — the current answer to a long or round face.",
  },
  {
    id: "wolf-cut-masc",
    name: "Wolf Cut (grown-out)",
    style: "masc",
    tags: ["medium", "2025"],
    fits: ["Square", "Diamond", "Triangle", "Oblong"],
    why: "Layered length at the ears and nape adds width low down, which softens a jaw and fills a narrow lower face.",
  },
  {
    id: "brooklyn-fade",
    name: "Brooklyn Fade",
    style: "masc",
    tags: ["short", "2025"],
    fits: ["Oval", "Round", "Heart", "Square"],
    why: "A high, clean fade with length left on top — it lifts the whole silhouette without widening it.",
  },
  {
    id: "curly-taper",
    name: "Curly Taper Fade",
    style: "masc",
    tags: ["short", "2025"],
    fits: ["Round", "Square", "Triangle", "Diamond"],
    why: "Volume stays on top and the sides are faded, so natural curl reads as height rather than width.",
  },
  {
    id: "buzz-fade",
    name: "Buzz with Skin Fade",
    style: "masc",
    tags: ["veryshort", "2025"],
    fits: ["Oval", "Diamond", "Square"],
    why: "The most honest cut there is — it works only when the underlying proportions already carry the face.",
  },
  {
    id: "masc-buzz-classic",
    name: "Classic Buzz Cut",
    style: "masc",
    tags: ["veryshort", "low-maintenance"],
    fits: ["Oval", "Diamond", "Square", "Triangle"],
    why: "One even length keeps the jaw and cheekbones fully visible — best on a face whose structure already reads well.",
  },
  {
    id: "masc-caesar",
    name: "Caesar Crop",
    style: "masc",
    tags: ["veryshort", "textured"],
    fits: ["Oblong", "Rectangle", "Oval", "Diamond"],
    why: "A short, forward-cut fringe adds a little height and covers a high forehead without any side width.",
  },
  {
    id: "fem-buzz",
    name: "Cropped Buzz / Skinhead Fade",
    style: "fem",
    tags: ["veryshort", "2025"],
    fits: ["Oval", "Heart", "Diamond"],
    why: "Very short all over throws the focus onto the face and jawline — flattering only when they are already strong.",
  },
 {
    id: "curtain-masc",
    name: "Centre-Part Curtains",
    style: "masc",
    tags: ["medium", "2025"],
    fits: ["Heart", "Diamond", "Triangle", "Round"],
    why: "Length at the temples covers the widest points of the upper face and evens out a pointed chin.",
  },

  // ------------------------------------------------------ LONG masc (added)
  // Men wanting LONG hair was the biggest gap in the old library: the only
  // "long" cuts were fem-tagged, so a man who chose "long" got an empty list.
  // These do the same proportional jobs (width low down, soft edges) in a length
  // a man can actually grow into.
  {
    id: "masc-medium-flow",
    name: "Medium Flow (ear-to-collar)",
    style: "masc",
    tags: ["medium", "soft"],
    fits: ["Oval", "Square", "Diamond", "Heart"],
    why: "Grown-out length around the ears and neck broadens the lower third, which balances a narrow jaw or pointed chin.",
  },
  {
    id: "masc-shoulder-flow",
    name: "Shoulder-Length Flow",
    style: "masc",
    tags: ["long", "soft"],
    fits: ["Oval", "Square", "Heart", "Triangle"],
    why: "Weight at the shoulders adds width below the jaw, softening a strong or wide lower face without height on top.",
  },
  {
    id: "masc-man-bun",
    name: "Long Hair with Man Bun",
    style: "masc",
    tags: ["long", "2025"],
    fits: ["Oval", "Round", "Diamond", "Heart"],
    why: "Pulled-back length keeps the sides tight and lifts the silhouette from the crown, which lengthens a round face.",
  },
  {
    id: "masc-long-layered",
    name: "Long with Sharp Layers",
    style: "masc",
    tags: ["long", "textured"],
    fits: ["Oblong", "Rectangle", "Square", "Diamond"],
    why: "Angular layers add width at the temple-to-jaw line, which fills a narrow face and stops a long one reading as stretched.",
  },
  {
    id: "masc-tied-back",
    name: "Slicked-Back Long / Low Ponytail",
    style: "masc",
    tags: ["long", "formal"],
    fits: ["Oval", "Square", "Triangle"],
    why: "Hair worn back keeps the face fully exposed — a clean, formal way to wear length when the proportions already work.",
  },

  // ---------------------------------------------------------------- fem short
  {
    id: "bob-blunt",
    name: "Blunt Bob",
    style: "fem",
    tags: ["short", "structured"],
    fits: ["Oblong", "Triangle", "Oval"],
    why: "A straight line at the jaw adds width there and gives a long face a visual stop.",
  },
  {
    id: "fem-lob",
    name: "Lob (Long Bob)",
    style: "fem",
    tags: ["short", "2025"],
    fits: ["Oval", "Square", "Heart", "Triangle"],
    why: "Cut at the collarbone it softens a strong jaw while keeping enough length to frame the face.",
  },
  {
    id: "fem-shag-short",
    name: "Short Shag",
    style: "fem",
    tags: ["short", "textured"],
    fits: ["Round", "Square", "Oval", "Diamond"],
    why: "Choppy layered ends break up roundness and add movement, which stops the face reading as one solid shape.",
  },
  {
    id: "masc-crop-fade",
    name: "Textured Crop Fade",
    style: "masc",
    tags: ["short", "2025"],
    fits: ["Round", "Oval", "Square", "Heart"],
    why: "Short textured top with faded sides — keeps width off the sides while the texture adds a little height.",
  },
  {
    id: "pixie-crop",
    name: "Textured Pixie",
    style: "fem",
    tags: ["veryshort", "2025"],
    fits: ["Oval", "Heart", "Diamond"],
    why: "Very short at the sides with lift on top — flatters a face that is already balanced and has a clear jaw.",
  },
  {
    id: "french-bob",
    name: "French Bob with Fringe",
    style: "fem",
    tags: ["short", "2025"],
    fits: ["Oblong", "Rectangle", "Diamond", "Heart"],
    why: "Jaw-length with a soft fringe — the fringe shortens the face and the length squares off the jaw line.",
  },
  {
    id: "italian-bob",
    name: "Italian Bob",
    style: "fem",
    tags: ["medium", "2025"],
    fits: ["Oval", "Square", "Heart", "Diamond"],
    why: "Full, rounded volume at the jaw with no fringe — it balances a strong cheekbone or a wide jaw.",
  },

  // ---------------------------------------------------------------- fem medium
  {
    id: "side-part-classic",
    name: "Classic Side Part",
    style: "any",
    tags: ["medium", "formal"],
    fits: ["Oval", "Round", "Heart", "Rectangle"],
    why: "The asymmetric line breaks up roundness and reads as a deliberate, tidy silhouette.",
  },
  {
    id: "middle-part",
    name: "Middle Part (Curtain)",
    style: "any",
    tags: ["medium", "soft"],
    fits: ["Heart", "Diamond", "Oval", "Triangle"],
    why: "Frames the temples and adds width where a heart or diamond shape is narrowest.",
  },
  {
    id: "curly-volume",
    name: "Curly with Crown Volume",
    style: "any",
    tags: ["medium", "volume"],
    fits: ["Round", "Square", "Triangle", "Rectangle"],
    why: "Lift at the crown and softness at the edges lengthens the face and relaxes sharp lines.",
  },
  {
    id: "curly-shag",
    name: "Curly Shag",
    style: "fem",
    tags: ["medium", "2025"],
    fits: ["Round", "Square", "Triangle", "Oblong"],
    why: "Layers that release the curl away from the head — width at the jaw instead of the cheek, which is what a round face wants.",
  },
  {
    id: "butterfly-cut",
    name: "Butterfly Cut",
    style: "fem",
    tags: ["long", "2025"],
    fits: ["Round", "Oblong", "Rectangle", "Heart"],
    why: "Short layers at the crown with longer face-framing pieces — height up top and softness at the edges at once.",
  },
  {
    id: "octopus-cut",
    name: "Octopus Cut",
    style: "fem",
    tags: ["long", "2025"],
    fits: ["Diamond", "Heart", "Oblong", "Triangle"],
    why: "Round, layered shape with a lifted crown — adds width low down to fill a narrow jaw or pointed chin.",
  },

  // ------------------------------------------------------ LONG (added variety)
  // The user asked for real choices for people who will NOT go short. The four
  // originals (butterfly, octopus, long-layered, wavy, boho, face-frame) are kept
  // and joined by the classic long silhouettes so every shape has 2+ long options.
  {
    id: "long-layered",
    name: "Long, Layered",
    style: "any",
    tags: ["long", "soft"],
    fits: ["Square", "Rectangle", "Oblong", "Triangle"],
    why: "Soft layers soften hard angles and add the width a long face needs.",
  },
  {
    id: "wavy-shoulder",
    name: "Wavy Shoulder-Length",
    style: "any",
    tags: ["long", "volume"],
    fits: ["Oblong", "Rectangle", "Heart", "Diamond"],
    why: "Horizontal weight at the sides shortens a long face and balances a narrow jaw.",
  },
  {
    id: "boho-waves",
    name: "Loose Boho Waves",
    style: "fem",
    tags: ["long", "2025"],
    fits: ["Rectangle", "Oblong", "Square", "Diamond"],
    why: "Broad, unstructured waves at the widest point of the face — the softest way to break up straight lines.",
  },
  {
    id: "face-frame-layers",
    name: "Face-Framing Layers",
    style: "fem",
    tags: ["long", "2025"],
    fits: ["Square", "Round", "Oblong", "Heart"],
    why: "Slim layers either side of the face draw the eye inward, which narrows an over-wide or too-round silhouette.",
  },
  {
    id: "long-curtain",
    name: "Long Curtain Part",
    style: "any",
    tags: ["long", "soft"],
    fits: ["Heart", "Diamond", "Oval", "Round"],
    why: "Two long panels frame the face and add width at the temples, softening a pointed chin or a narrow brow.",
  },
  {
    id: "long-blunt-lob",
    name: "Long Blunt Collarbone Cut",
    style: "fem",
    tags: ["long", "structured"],
    fits: ["Oval", "Oblong", "Triangle", "Rectangle"],
    why: "One clean length past the collarbone adds a strong horizontal line low down, which shortens a long face.",
  },
  {
    id: "long-curly",
    name: "Long Curly (defined)",
    style: "any",
    tags: ["long", "volume"],
    fits: ["Round", "Oblong", "Rectangle", "Heart"],
    why: "Defined length with curl adds height and softness at once — the best long option for a round or long face.",
  },
  {
    id: "long-straight",
    name: "Long and Straight",
    style: "fem",
    tags: ["long", "sleek"],
    fits: ["Round", "Square", "Heart", "Triangle"],
    why: "Vertical length narrows the face visually — strongest on a round or wide-jawed face that wants a slimmer read.",
  },
  {
    id: "long-half-up",
    name: "Long, Half-Up",
    style: "fem",
    tags: ["long", "2025"],
    fits: ["Oval", "Square", "Round", "Diamond"],
    why: "Pulling the top half back adds height at the crown while length stays at the sides — balance with no cutting.",
  },
];

// ------------------------------------------------------------------- lengths
//
// The length a user is willing to wear. This was the reported gap: the shortlist
// was always drawn from the whole library, so a man who would never go short kept
// getting fades, and a woman wanting to keep her length kept getting bobs. The
// engines CONTENT is unchanged -- length is now a FILTER the user controls.
//
// "any" returns a SPREAD across lengths (see pickCuts) rather than the top four
// overall, so the default list is varied instead of clustering on one length.
export const LENGTHS = ["any", "veryshort", "short", "medium", "long"];

// The length tag of a cut, read from its first tag (see the note on CUTS).
function cutLength(cut) {
  const first = (cut.tags || [])[0];
  return LENGTHS.includes(first) && first !== "any" ? first : "medium";
}

// ------------------------------------------------------------------- helpers

// computeFaceShape returns either a bare shape ("Round") or a display string
// with observations appended ("Oval · wide brow · tapered jaw"). This strips it
// back to the base key so the table lookup can never miss.
// Which presentation a cut belongs to. "any" suits both. Kept as a separate
// function so the intent is explicit at the call site rather than buried in a
// filter expression.
function suitsStyle(cut, gender) {
  if (cut.style === "any") return true;
  // An unknown or absent gender must not silently drop every gendered cut, so it
  // falls back to showing both sets.
  if (gender !== "male" && gender !== "female") return true;
  return cut.style === (gender === "male" ? "masc" : "fem");
}

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
 * @param {object} [options]
 * @param {string} [options.length] - one of LENGTHS ("any" | "veryshort" |
 *   "short" | "medium" | "long"). Filters the library to that length; "any"
 *   (the default) keeps the whole library but returns a SPREAD across lengths so
 *   the default shortlist is varied rather than four variations on one cut.
 * @returns {null | {shape, shapeLabel, summary, avoid, cuts, confidence, length}}
 */
export function recommendHairstyles(analysis, options = {}) {
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
  // Only consider cuts for the user's presentation. The engine always reports a
  // gender, so this is what stops a Pompadour appearing in the same shortlist as
  // a Blunt Bob -- advice for two different people in one answer.
  const gender = analysis.gender || null;
  // Length preference. "any" means "no restriction" and is handled at the PICK
  // step (a spread across lengths); a concrete length restricts the library here.
  const wantedLength = LENGTHS.includes(options.length) ? options.length : "any";
  const styleEligible = CUTS.filter((cut) => suitsStyle(cut, gender));
  const eligible =
    wantedLength === "any"
      ? styleEligible
      : styleEligible.filter((cut) => cutLength(cut) === wantedLength);

  const scored = eligible.map((cut) => {
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

  // PICK THE SHORTLIST.
  //
  // The old version was `slice(0, 4)`, which is exactly the reported "every
  // result looks the same": the top four by score clustered on one or two
  // lengths (usually short/masc), so the list never offered a genuinely
  // different choice. Two changes fix that:
  //   * when length is "any", the shortlist is drawn as a SPREAD -- at most two
  //     cuts per length -- so the four (or six) come from different lengths;
  //   * six are returned rather than four, so there is real choice.
  const pool = scored.filter((s) => s.score > 0);
  const cuts = pickCuts(pool, wantedLength);

  // If a length filter was chosen and nothing in the library fits the shape at
  // that length, fall back to the whole length regardless of shape fit, so the
  // user is never handed an empty list for a length they asked for.
  const finalCuts = cuts.length
    ? cuts
    : pickCuts(
        styleEligible
          .filter((cut) => wantedLength === "any" || cutLength(cut) === wantedLength)
          .map((cut) => ({ cut, score: 1 })),
        wantedLength,
      );

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
    cuts: finalCuts,
    note,
    gender,
    length: wantedLength,
    // Counted after the style filter, so the UI can say "how many options were
    // actually considered" rather than how many exist in the library.
    considered: eligible.length,
    confidence: ambiguous ? "shape-near-oval" : "shape-clear",
  };
}

// -------------------------------------------------------------- shortlist pick
//
// Turn a scored pool into the shortlist the user sees.
//
// `maxPerLength` is what makes the result VARIED. With one length chosen the
// limit is disabled (the user asked for that length, so show the best of it);
// with "any" it caps each length at two, so an "any" shortlist reads across the
// library instead of listing four near-identical short cuts.
const MAX_CUTS = 6;
function pickCuts(pool, wantedLength) {
  const perLength = wantedLength === "any" ? 2 : Infinity;
  const usedByLength = new Map();
  const out = [];
  for (const entry of pool) {
    const len = cutLength(entry.cut);
    const used = usedByLength.get(len) || 0;
    if (used >= perLength) continue;
    usedByLength.set(len, used + 1);
    out.push(entry);
    if (out.length >= MAX_CUTS) break;
  }
  return out.map(({ cut }) => ({
    id: cut.id,
    name: cut.name,
    tags: cut.tags,
    why: cut.why,
    length: cutLength(cut),
  }));
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
