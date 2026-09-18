// Curated tip copy shown next to a scan result.
//
// Two tiers of advice: "glowup" for the three lower tiers (Low/Mid/High Tier)
// and "maintain" for the three upper ones (Chad Lite..True Adam / Stacy
// Lite..Eve). See tierGroupFor() in faceEngine.js for how a score maps to a
// group.
//
// Why tagged pools instead of two flat lists: a flat list meant every scan of
// the same group showed the SAME tips, in the same order -- it read like a
// template, not like advice for the photo in front of you. Each tip is now
// tagged with the metric it targets, and tipsForAnalysis() picks the ones
// relevant to that scan (weak skin -> skin tips, weak structure -> jaw/bloat
// tips, a profile shot -> profile tips), then fills the rest from the pool. Two
// different faces now get two different sets.
//
// Focus tags, kept in sync with the analysis fields in faceEngine.js:
//   skin      - skinQuality is low
//   structure - golden / face shape (jaw definition, bone structure, bloat)
//   symmetry  - left/right balance, grooming, brow/beard lines
//   profile   - canthal tilt / side profile / posture
//   lifestyle - sleep, hydration, diet (help everything a little)
//   styling   - hair, brows, framing (universal polish)

const POOLS = {
  glowup: {
    male: [
      { focus: "skin", text: "Start a simple AM/PM skincare routine: gentle cleanser, moisturizer, and SPF 30+ every morning." },
      { focus: "skin", text: "Add a niacinamide or vitamin C serum to even out tone and fade post-acne marks." },
      { focus: "skin", text: "Exfoliate gently 2-3x a week — dead skin dulls the whole face, not just the surface." },
      { focus: "acne", text: "For active breakouts, use a benzoyl peroxide or salicylic acid spot treatment at night, not a whole-face scrub." },
      { focus: "acne", text: "Change your pillowcase every few days and stop touching your face — contact is a top breakout driver." },
      { focus: "acne", text: "Don't pick or pop spots — it turns a 3-day pimple into a 3-month mark worth of hyperpigmentation." },
      { focus: "structure", text: "Lower your body fat percentage a bit — it's the single fastest way to sharpen your jawline and cheekbones." },
      { focus: "structure", text: "Practice mewing (proper tongue posture) consistently for gradual jaw definition over months." },
      { focus: "structure", text: "Cut late-night salty snacks and alcohol — facial bloat hides your bone structure worse than fat does." },
      { focus: "structure", text: "Chew hard foods or use a jaw trainer to build masseter definition along the jawline." },
      { focus: "eye", text: "Get 7-8 hours of sleep and cut late-night salt — puffiness is what flattens the lid crease and hides the eye area." },
      { focus: "eye", text: "Tidy the under-brow line and keep brow length in check; a cleaner brow frame makes the whole eye area read sharper." },
      { focus: "eye", text: "If your lower lids show a lot of white in photos, keep your gaze relaxed and slightly down rather than wide-eyed at the camera." },
      { focus: "eye", text: "Drop body fat slowly and keep hydration up — a leaner face exposes more of the upper lid instead of hooding it." },
      { focus: "symmetry", text: "Clean up your eyebrows and facial hair edges; a sharp lineup instantly reads as more symmetrical." },
      { focus: "symmetry", text: "Stop habitual one-sided chewing and sleeping on one side — over years both visibly skew the face." },
      { focus: "symmetry", text: "Keep your beard or stubble symmetrical and edged — a lopsided trim exaggerates any real asymmetry." },
      { focus: "profile", text: "Fix your posture — a forward neck flattens your jawline and shortens your side profile." },
      { focus: "profile", text: "Work your neck and traps; a thicker neck makes the jaw look sharper from every angle." },
      { focus: "profile", text: "Most photos are frontal — pick haircuts that read well head-on, not just in profile." },
      { focus: "lifestyle", text: "Sleep 7-8 hours. Puffiness and dark circles are the #1 fixable downgrade on any face." },
      { focus: "lifestyle", text: "Drink more water and cut back on sodium to reduce overnight facial puffiness." },
      { focus: "lifestyle", text: "Reduce smoking and alcohol — both age the skin faster than almost anything else." },
      { focus: "styling", text: "Get a haircut that suits your face shape — ask your barber for texture on top and a tighter fade." },
      { focus: "styling", text: "Grow and shape a short beard if your jaw is weak — it adds structure you can't train overnight." },
      { focus: "styling", text: "Wear glasses or sunglasses that fit your face width — the wrong width shrinks or widens your face." },
    ],
    female: [
      { focus: "skin", text: "Build a consistent skincare routine: gentle cleanser, hydrating serum, and SPF every day." },
      { focus: "skin", text: "Add a vitamin C or retinol step to even out tone and smooth texture over time." },
      { focus: "skin", text: "Double-cleanse at night and never sleep in makeup — congestion shows on the cheeks first." },
      { focus: "acne", text: "Spot-treat breakouts with a salicylic acid or benzoyl peroxide product instead of scrubbing — scrubbing spreads them." },
      { focus: "acne", text: "Switch to a non-comedogenic moisturizer and clean your phone screen; both are common hidden breakout triggers." },
      { focus: "acne", text: "If breakouts are hormonal and persistent, a dermatologist is worth it — some things a routine can't fix alone." },
      // Leanness tips come FIRST in the structure pool. The pool used to open with
      // puffiness/gua-sha/contour advice, which is cosmetic and does nothing for a
      // face whose reading is genuinely full -- so a user whose tier was capped by
      // face fat was told to try gua sha. Body composition is the real lever, and
      // it leads now; the styling tips follow as the finishing touch.
      { focus: "structure", text: "Lowering body fat is the single biggest change for facial definition — it reveals cheekbones and jaw the quickest of anything here." },
      { focus: "structure", text: "Lift weights 3-4x a week and keep protein high; recomposition sharpens the jawline far more than any topical product." },
      { focus: "structure", text: "Cut back on alcohol and late-night salt — both hold water in the face and flatten your bone structure overnight." },
      { focus: "structure", text: "Stay hydrated and cut back on sodium; puffiness hides your natural bone structure." },
      { focus: "structure", text: "Try facial massage or gua sha to reduce puffiness and define your cheekbones and jawline." },
      { focus: "structure", text: "Contour subtly along the cheekbone and jaw — placement matters more than intensity." },
      { focus: "eye", text: "Shape and fill your brows to frame the eye area — it is the highest-impact 10-minute change you can make." },
      { focus: "eye", text: "Curl your lashes and keep the lid clean; a visible lid crease reads more open and awake in photos." },
      { focus: "eye", text: "Sleep and hydration matter most here — dark circles and puffiness widen the look of the lower lid." },
      { focus: "symmetry", text: "Shape your eyebrows to frame your eyes — it's the highest-impact 10-minute glow up." },
      { focus: "symmetry", text: "Aim for brows that are balanced, not identical — perfectly even brows look off." },
      { focus: "symmetry", text: "Switch your hair part to whichever side balances your features rather than always the same." },
      { focus: "profile", text: "Practice good posture — an aligned neck and jaw improve your side profile instantly." },
      { focus: "profile", text: "A touch of highlighter on the cheekbone peak sharpens the profile in photos." },
      { focus: "lifestyle", text: "Sleep 7-8 hours consistently — under-eye circles read as fatigue instantly." },
      { focus: "lifestyle", text: "Cut back on sugar and dairy if you're breakout-prone; both are common triggers." },
      { focus: "styling", text: "Try a hairstyle that adds volume or soft layers to frame your face shape." },
      { focus: "styling", text: "A tinted moisturizer and light blush even out tone and highlight your cheekbones." },
      { focus: "styling", text: "Match blush placement to your face shape — higher for long faces, outward for round." },
    ],
  },
  maintain: {
    male: [
      { focus: "skin", text: "Stick to your skincare routine — consistency is what keeps results. Don't skip SPF." },
      { focus: "skin", text: "Add an antioxidant (vitamin C) if you haven't — it defends the results you already have." },
      { focus: "structure", text: "Maintain your physique — body composition still affects facial definition." },
      { focus: "structure", text: "Keep body fat stable; the sharpest jawline is easy to lose and slow to rebuild." },
      { focus: "symmetry", text: "Keep your grooming (hair, beard, eyebrows) sharp and regularly maintained." },
      { focus: "symmetry", text: "A consistent barber beats a trendy one — same shape, kept clean, reads best." },
      { focus: "eye", text: "Keep the eye area rested — puffiness and lid creasing are the first things to blunt a strong eye area." },
      { focus: "profile", text: "Hold your posture — the jawline you earned disappears with a forward neck." },
      { focus: "lifestyle", text: "Keep sleep and hydration consistent — they're the easiest habits to lose and the cheapest to keep." },
      { focus: "lifestyle", text: "Protect your skin from long-term sun damage to avoid early aging." },
      { focus: "styling", text: "Don't get complacent — small daily habits compound. Keep refining your routine." },
      { focus: "styling", text: "Refresh your hairstyle every few months — a style that suited you at 20 may not now." },
    ],
    female: [
      { focus: "skin", text: "Keep your skincare consistent, especially SPF — sun damage is the #1 way to lose your glow." },
      { focus: "skin", text: "Introduce a gentle retinol at night if you haven't — it protects long-term texture." },
      { focus: "structure", text: "Stay hydrated and keep a balanced diet — it shows directly on your skin and under-eyes." },
      { focus: "structure", text: "Keep facial massage or gua sha in your routine to maintain cheek and jaw definition." },
      { focus: "symmetry", text: "Maintain regular brow and hair upkeep so your features stay framed." },
      { focus: "symmetry", text: "Keep a consistent part and brow shape — consistency is what reads as put-together." },
      { focus: "eye", text: "Keep your brow shape and lid grooming consistent — the eye area is what people read first." },
      { focus: "profile", text: "Keep your posture aligned — it carries your profile in every candid photo." },
      { focus: "lifestyle", text: "Keep consistent sleep — it's the easiest glow up to lose and the easiest to keep." },
      { focus: "lifestyle", text: "Protect your skin long term; don't skip SPF even on cloudy days." },
      { focus: "styling", text: "Stay confident — your expression and posture carry as much as your features." },
      { focus: "styling", text: "Rotate your look slightly each season so your styling stays fresh, not frozen." },
    ],
  },
};

// Order metric weakness is prioritised in. Acne and skin are the most visible
// and most actionable, then structure, so they lead; styling fills the rest.
const FOCUS_PRIORITY = ["acne", "skin", "structure", "eye", "symmetry", "profile", "lifestyle", "styling"];

// Thresholds (on the 0-100 sub-scores) below which a focus area counts as
// "weak" for this scan and its tips get surfaced first.
//
// `structure` is shared by three readings of very different scales: the golden
// ratio (a proportion score that starts deducting around 80), the face-fat score
// (100 = lean, and it only drops into the 50s once a face is visibly full), and
// the jawline score. It was 75 -- high enough that the face-fat reading alone
// tagged structure as weak for any average, slightly-full face, pushing "lower
// your body fat" style tips to the top of the list even for someone whose
// structure is fine. 58 keeps it firing only on a genuinely full/round reading.
const WEAK = { skin: 70, acne: 82, structure: 58, jawline: 60, eye: 60, symmetry: 75 };

// Which focus areas a given analysis should priorit, weakest first.
//
// `analysis` is the object returned by analyzeFace(): it has .skinQuality,
// .skinAcne, .faceFat, .jawline, .eyeShape, .golden, .symmetry, .canthalTilt,
// .frontalMetricsMeasured and .profile. A missing/partial object (e.g. a legacy
// caller) just falls back to the full priority order, so this never throws.
function focusAreasFor(analysis) {
  if (!analysis) return FOCUS_PRIORITY;
  const weak = new Set();
  // `frontalMetricsMeasured` is false on a profile AND on a no-face photo, so the
  // frontal readings below must not be read as weak signals in either case. A
  // no-face scan also has no skin/acne reading to act on, hence the explicit
  // overallMeasured guard: there is nothing honest to advise on.
  const frontal = analysis.frontalMetricsMeasured !== false && analysis.overallMeasured !== false;
  // No face: nothing honest to advise on.
  if (analysis.noFace) return ["lifestyle", "styling"];
  // Side profile: the frontal readings (jaw, face fat, symmetry, eye area) are
  // all "n/a" for this scan, so tips built on them are noise. Skin still applies
  // (it measures the same at any angle); everything else falls back to the
  // posture/lifestyle/styling pools, which are true regardless of head angle.
  if (!frontal && analysis.profile && analysis.profile.isProfile) {
    return ["profile", "skin", "lifestyle", "styling"];
  }

  if (typeof analysis.skinQuality === "number" && analysis.skinQuality < WEAK.skin) {
    weak.add("skin");
  }
  // On a profile there is no eye-area / jaw / face-fat reading to be "weak", so
  // only the skin signal is allowed through above this point.
  if (analysis.skinAcne && typeof analysis.skinAcne.score === "number" && analysis.skinAcne.score < WEAK.acne) {
    weak.add("acne");
  }
  // Structure now also covers the direct structure readings: a full/round face
  // (low fat score) or a soft jaw (low jawline score) both want the jaw/bloat
  // tips, not just a poor golden ratio.
  if (typeof analysis.golden === "number" && analysis.golden < WEAK.structure) {
    weak.add("structure");
  }
  if (frontal && analysis.faceFat && analysis.faceFat.score < WEAK.structure) {
    weak.add("structure");
  }
  if (frontal && analysis.jawline && analysis.jawline.score < WEAK.jawline) {
    weak.add("structure");
  }
  // Symmetry only counts as a signal when it was actually measurable (it isn't
  // on a profile shot), so a profile doesn't get symmetry tips it can't act on.
  if (
    frontal &&
    typeof analysis.symmetry === "number" &&
    analysis.symmetry < WEAK.symmetry
  ) {
    weak.add("symmetry");
  }
  if (analysis.canthalTilt && analysis.canthalTilt.label !== "Positive") {
    weak.add("profile");
  }
  // The eye AREA now covers the shape label, so it is the primary eye signal:
  // a weak composite (or a specifically weak eyelid/brow part) should surface the
  // eye-area tips. eyeShape is still checked as a fallback so a legacy/partial
  // analysis object still works.
  if (frontal && analysis.eyeArea && analysis.eyeArea.score < WEAK.eye) {
    weak.add("eye");
  }
  if (frontal && analysis.eyeShape && analysis.eyeShape.score < WEAK.eye) {
    weak.add("eye");
  }
  // The POTENTIAL priority is the single biggest lever the app identified (see
  // computePotential -> weakestFixable), so whatever it names leads the tips. This
  // is the fix for the report offering generic styling advice next to a metric
  // that is demonstrably capping the user's tier: on the FatGirl scan the overall
  // was limited by face fat, yet the tips opened with gua-sha and eyebrow
  // shaping. Mapping the priority to its focus area puts the actionable advice
  // first instead.
  const POTENTIAL_TO_FOCUS = {
    skin: "skin",
    clarity: "acne",
    leanness: "structure",
    jaw: "structure",
    "eye-area": "eye",
  };
  let leadFocus = null;
  if (analysis.potential && analysis.potential.priority) {
    leadFocus = POTENTIAL_TO_FOCUS[analysis.potential.priority] || null;
    if (leadFocus) weak.add(leadFocus);
  }

  // Weak areas first (in priority order), then everything else as filler. When the
  // potential analysis named a lead focus, it is pinned to the front of the order
  // so its tips are always the first ones the user reads.
  const ordered = FOCUS_PRIORITY.filter((f) => weak.has(f));
  if (leadFocus) {
    const i = ordered.indexOf(leadFocus);
    if (i > 0) {
      ordered.splice(i, 1);
      ordered.unshift(leadFocus);
    }
  }
  for (const f of FOCUS_PRIORITY) if (!weak.has(f)) ordered.push(f);
  return ordered;
}

/**
 * Tips tailored to one scan. Picks a varied set driven by which metrics are
 * weak for THIS face, then tops up from the remaining pool. The output length
 * stays in the familiar 6-8 range so the layout doesn't change.
 *
 * @param {string} gender "male" | "female"
 * @param {object} analysis result object from analyzeFace() (may be partial)
 * @param {object} [opts] { max } to cap the number of tips
 */
export function tipsForAnalysis(gender, analysis, opts = {}) {
  const group = analysis && analysis.tierGroup === "maintain" ? "maintain" : "glowup";
  const pool = POOLS[group][gender] || POOLS[group].male;
  const max = opts.max || (group === "maintain" ? 6 : 8);
  const order = focusAreasFor(analysis);

  // Walk the focus order; from each area take its tips in pool order. Cap the
  // number taken per single area so one area can't dominate the whole list.
  const perAreaCap = 3;
  const picked = [];
  for (const focus of order) {
    const inArea = pool.filter((t) => t.focus === focus);
    let taken = 0;
    for (const tip of inArea) {
      if (picked.length >= max || taken >= perAreaCap) break;
      picked.push(tip.text);
      taken++;
    }
    if (picked.length >= max) break;
  }

  // Fill any remaining slots from the whole pool (in case a group has fewer
  // tagged tips than slots), preserving order and avoiding duplicates.
  if (picked.length < max) {
    for (const tip of pool) {
      if (picked.length >= max) break;
      if (!picked.includes(tip.text)) picked.push(tip.text);
    }
  }

  return picked.slice(0, max);
}

/**
 * Back-compat: the old flat-list API. Returns every tip for a group/gender,
 * untagged. Kept so nothing that still imports it breaks; main.js uses
 * tipsForAnalysis() now.
 */
export function tipsFor(gender, group) {
  const g = group === "maintain" ? "maintain" : "glowup";
  const pool = POOLS[g][gender] || POOLS[g].male;
  return pool.map((t) => t.text);
}

export function tipsHeadingFor(group) {
  return group === "maintain" ? "Keep It Up" : "Glow Up Tips";
}
