import {
  FaceDetector,
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import * as faceapi from "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/+esm";

// Used only to auto-detect gender so the tier label (Chad vs. Stacy, etc.)
// matches the person in the photo. Small, fully client-side models. Each
// model lives in its own subfolder in the upstream weights repo, so each
// net needs its own base URI (a shared root 404s).
const FACEAPI_MODEL_BASE =
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js-models@master";
const TINY_FACE_DETECTOR_URL = `${FACEAPI_MODEL_BASE}/tiny_face_detector`;
const AGE_GENDER_MODEL_URL = `${FACEAPI_MODEL_BASE}/age_gender_model`;
// SSD MobileNet face detector. Same free, Apache-2.0 face-api.js weights repo
// (no key, no quota) as the model above. It exists for ONE case the MediaPipe
// models cannot cover: a near-true SIDE PROFILE. The MediaPipe landmark model is
// a stated "selfie mode" model (~80 deg limit) and even MediaPipe's full-range
// BlazeFace missed the test profile (reccesed.jpg), while this SSD detector found
// the same photo with 0.90 confidence (tools/probeFaceApiProfile.mjs). It returns
// a BOX only (no landmarks), so it can confirm "a face IS here, this is a
// profile", but it cannot produce the profile geometry -- see
// detectFaceBoxFullRange.
const SSD_FACE_DETECTOR_URL = `${FACEAPI_MODEL_BASE}/ssd_mobilenetv1`;

// --- free MediaPipe model assets (Apache 2.0, no API key, no quota) ---------
//
// Google hosts every MediaPipe model on a public bucket with no auth. Both URLs
// below were verified to return HTTP 200 and are used directly from the browser.
// See https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker for
// the models list; the library is Apache 2.0 (free for commercial use).
//
// The face LANDMARKER (478-point mesh, blendshapes) is the scorer's main model.
const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
// The BlazeFace FULL-RANGE detector. This exists for one reason: the landmark
// model itself is documented as a "selfie mode" model that cannot detect a face
// turned past ~80 degrees (see the MediaPipe Blendshape Model Card), which is
// exactly why a clean side-profile photo came back as "no face detected". The
// full-range variant is tuned for a face looking 75-90 degrees away from the
// camera, so it is used as a FALLBACK detector: the landmark model is tried
// first (it gives the mesh), and only if that fails is the full-range detector
// used to locate the head so we can still at least confirm a face is present and
// report its position instead of reporting nothing at all.
const BLAZE_FACE_FULL_RANGE_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite";
const BLAZE_FACE_SHORT_RANGE_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

// Bilateral landmark pairs from MediaPipe's 468-point canonical face mesh.
// These are the commonly-published indices for the major features; if you
// need finer-grained pairs, cross-check against Google's canonical face mesh
// map before adding indices here:
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
const SYMMETRY_PAIRS = [
  [33, 263],   // eye outer corners
  [133, 362],  // eye inner corners
  [70, 300],   // eyebrow outer
  [105, 334],  // eyebrow mid
  [129, 358],  // nose alae
  [61, 291],   // mouth corners
  [50, 280],   // cheeks
  // [234, 454] (jaw/temple width) was dropped from the symmetry set. It sits at
  // brow/temple level and lands in the HAIR on real photos -- the same reason
  // it was already removed as the width reference (see CHEEK_LEFT/RIGHT). A
  // landmark probe on the test models showed it contributing 2-3x the deviation
  // of every other pair (0.085-0.249 vs. ~0.02-0.05 elsewhere), so it dominated
  // avgDeviation and dragged a genuinely symmetric model face down toward
  // "average". Removing it lifts model symmetry from the 50s-70s into the 80s
  // without loosening the check on the pairs that do measure real asymmetry.
];

const MIDLINE_TOP = 10;    // forehead
const MIDLINE_BOTTOM = 152; // chin
const SCALE_LEFT = 33;
const SCALE_RIGHT = 263;
const JAW_LEFT = 132;      // true jaw angle (gonion); see computeFaceShape
const JAW_RIGHT = 361;

// Face-width reference (the denominator for every proportion ratio). A
// landmark probe on real photos showed the previously-used pairs are both
// unreliable: 234/454 sits at brow/temple level and lands in the HAIR (on an
// Adriana Lima photo it measured 263px while the actual cheekbones were
// 244px, inflating the width and pushing the ratio down toward "Round"),
// while 50/280 sits at the nasolabial fold, well inside the true cheekbone.
// 116/345 are the actual cheekbone (zygomatic) points -- verified visually to
// land on the widest part of the face for both a female model and a male
// model. The previous `max(234/454, 50/280)` heuristic is gone: taking the
// WIDER of two unreliable spans only ever picked up hair.
const CHEEK_LEFT = 116;
const CHEEK_RIGHT = 345;

// Component weights for the overall 0-100 score, across all seven sub-metrics.
// Named (not inlined) so the balance can be tuned in one place. They must sum
// to 1.0.
//
// Rebalanced when faceFat / jawline / skinAcne / eyeShape were added. The old
// split (symmetry 0.45 + golden 0.35 + skin 0.20) leaned almost entirely on two
// geometry readings, which is exactly why a round, full face -- mirror
// symmetric and only mildly off the length ratio -- could score "chad lite":
// the one signal that sees roundness (faceFat) and the one that sees a soft jaw
// (jawline) didn't exist. Geometry still leads, but structure (faceFat +
// jawline) and skin now carry real weight too, so no single reading can carry a
// face on its own.
//
// Rebalanced again after an audit of the full test set exposed the real ceiling
// problem: with the previous split, a face with an essentially flawless structure
// (jaw 100, leanness 100, golden 96, eye area 91) only reached 81.8 -- "high
// tier" -- because the two EASY, high-scoring readings carried the most weight.
// Symmetry and skin both sit in the high 80s-90s for almost everyone (a face has
// to be badly off to score low on either), so at 0.22 + 0.11 they acted as a
// rubber band holding every good face under 82 while the readings that actually
// separate an elite face from a good one -- jaw definition, lower-face leanness,
// eye area, proportions -- were under-weighted.
//
// So the weight moves TOWARD the discriminating readings and away from the ones
// that saturate: symmetry 0.22 -> 0.16, skin 0.11 -> 0.08, while jaw, face-fat,
// golden and the eye area gain. Sum is still exactly 1.0.
const WEIGHT_SYMMETRY = 0.17;
const WEIGHT_GOLDEN = 0.18;
const WEIGHT_FACE_FAT = 0.16;
const WEIGHT_JAWLINE = 0.15;
const WEIGHT_SKIN_QUALITY = 0.09;
const WEIGHT_SKIN_ACNE = 0.07;
// The eye AREA (canthal + projection + eyelid + brow) replaces the old eye-shape
// label as the eye component; its own sub-weights live in EYE_AREA_WEIGHTS.
const WEIGHT_EYE_AREA = 0.18;
// Sum: 0.17+0.18+0.16+0.15+0.09+0.07+0.18 = 1.00 (asserted by tools/scoringCheck).

// Sub-weights for the Eye Area composite. Same structure the looksmaxxing
// community uses: the eye AREA is a sum of parts, not one number.
// Requirements are also enforced on top of this (see EYE_AREA_REQUIREMENTS):
// an eye area can't rate "excellent" while one of its parts is at zero.
const EYE_AREA_WEIGHTS = {
  canthal: 0.3,   // canthal tilt
  projection: 0.25, // eye vs. brow ridge projection (approximated frontally)
  eyelid: 0.25,   // upper-eyelid exposure + lower-lid scleral show
  brow: 0.2,      // brow-eye distance + intercanthal ratio
};
// Intercanthal ratio: inner-corner-to-inner-corner distance over ONE eye width.
// This is the textbook reading (the "one eye width between the eyes" rule), and
// it is deliberately NOT normalised by the interocular distance: dividing the
// inner-corner span by the eye span lands ~1.2, while dividing it by the
// interocular span (outer-to-outer) lands ~0.38 and reads as nonsense in the UI.
// Measured on the real test photos the eye-width version reads 1.13-1.30, so the
// ideal sits a touch above the textbook 1.0 (the mesh carries a small bias) and
// the tolerance is wide -- this is a subtle spacing reading, not a hard rule.
const INTERCANTHAL_IDEAL = 1.20;
const INTERCANTHAL_TOLERANCE = 0.45;

// Brow-eye distance: the VERTICAL gap from the brow to the eye center, as a
// fraction of the eye width (same denominator as the intercanthal ratio, so both
// spacing readings share one scale and the printed numbers mean what a reader
// expects). The vertical gap is the reading that actually describes a low/compact
// vs. high/floating brow; a straight point-to-point distance mixes in the
// horizontal brow span and reads ~3x larger for no good reason. Measured across
// the test photos the vertical gap sits at ~0.55-0.75 of an eye width.
const BROW_EYE_IDEAL = 0.62;
const BROW_EYE_TOLERANCE = 0.3;

// "Lean" reference point on each width ratio, plus the per-ratio multipliers that
// decide how fast a face slides from "lean" to "round". These are the knobs that
// set how HARSH that reading is, and they are deliberately the ORIGINAL
// calibration: measured against test_photos on real detections, a lean,
// nice-looking face (adriana_lima: length/width 1.245, jaw/cheek 1.034, both
// witin a hair of the lean reference) still scores 83-87 -- "Lean". The reading
// itself is not the problem, which is why an earlier attempt to make it harsher
// was reverted: it knocked a clean frontal face from "chad" to "chad lite" and
// left amost no headroom between "lean" and "round".
//
// What WAS worth fixing is that a single occluded landmark pair could decide the
// whole reading -- see the cross-damping in computeFaceFat.
const LEAN_LENGTH_TO_WIDTH = 1.27;
const LEAN_JAW_TO_CHEEK = 1.04;
// A full, soft chin blends into the jaw, so the angle between the two jaw
// corners MEASURED AT THE CHIN widens. The chin landmark (152) is not enough on
// its own; the angle is taken against the upper and lower lip midline points
// (13/14) that sit just above it, which is the widest chin vertex the mesh
// actually offers. Note how shallow this signal turned out to be on real photos:
// every test face, from a model to the fuller subjects, lands at 102-111 deg, so
// it can only supply roughly 15 points of the 100-point deduction. It cannot
// carry the "full face" verdict on its own -- the width ratios do that.
const LEAN_CHIN_ANGLE = 95;
const FACE_FAT_LENGTH_MULT = 520;
const FACE_FAT_JAW_MULT = 420;
const FACE_FAT_CHIN_MULT = 2.4;
// Floor so even the roundest face keeps some credit for bone structure it
// genuinely has; a hard 0 would double-count roundness the jawline + symmetry
// components already carry.
const FACE_FAT_FLOOR = 12;

// Symmetry and golden-ratio are FRONTAL metrics: they measure left/right
// balance and frontal width proportions. On a turned/profile head those pairs
// sit at different depths, the reflection distance blows up, and both scores
// collapse toward 0 -- which then drags the weighted overall to ~14 regardless
// of how good the face is (a profile shot of a top model scored "low tier").
// When the head is turned enough that the frontal metrics can't be trusted
// (analyzeProfile reports isProfile), we substitute this neutral value for
// those two components instead of reporting a meaningless 0. Same philosophy
// as SKIN_FALLBACK_SCORE: better an honest "not measurable at this angle" than
// a number that punishes the photo for something the metric can't see.
const PROFILE_FALLBACK_SCORE = 75;

// How many points a strong SIDE profile may add to the frontal score in the
// combined report. The frontal readings stay the authority on the tier (see
// combineAnalysis), so this is a nudge, not a second vote: 6 points is enough to
// move a strong face across a tier boundary but far too little for a profile
// photo to carry a weak front reading on its own.
const PROFILE_BONUS_MAX = 6;

// "Neutral" score returned when the skin-quality heuristic can't get a
// trustworthy reading (heavy hair/lighting/color cast, or a tainted canvas).
// Deliberately not 50 -- a photo we can't read skin from is far more often a
// normal, decent photo than a poor one, so a below-average default would
// unfairly sink genuinely good faces. Applied only to the noisiest component.
const SKIN_FALLBACK_SCORE = 75;

// Above this many pixels on the long edge, the image is downscaled before the
// skin-quality pass. The heuristic samples a fixed interocular-scaled patch,
// so a 4000px photo gains no accuracy over a ~2000px one -- it just costs
// memory and time to copy through a canvas.
const SKIN_MAX_DIM = 2000;

function clamp100(x) {
  return Math.max(0, Math.min(100, x));
}

let faceLandmarker = null;
let loadingPromise = null;
let faceapiModelsPromise = null;
// The full-range detector is loaded LAZILY -- only when the landmark model fails
// to find a face (a near-true profile). A frontal scan must not pay the extra
// 1 MB download or the extra load time for a model it will never use.
let fullRangeDetector = null;
let fullRangePromise = null;
let visionFileset = null;

// The WASM fileset is shared by both models below (it is the runtime, not a
// model), so it is resolved once and reused.
async function ensureFileset() {
  if (!visionFileset) {
    visionFileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
  }
  return visionFileset;
}

export function ensureLandmarker() {
  if (faceLandmarker) return Promise.resolve(faceLandmarker);
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const filesetResolver = await ensureFileset();
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      numFaces: 1,
      // Detection thresholds. The model defaults are 0.5; both are lowered here so
      // an extreme-angle or side-profile frame still yields a bounding box instead
      // of dropping to "no face". The mesh QUALITY is gated separately (see
      // computeLandmarkConfidence and the profile classifier), so a slightly eager
      // lock cannot silently produce a confident score on a bad frame -- it just
      // gets measured and reported honestly.
      //
      // minFaceDetectionConfidence: how sure the initial face PRESENCE lock must
      // be. 0.35 matches the value the previous comment describes.
      // minFacePresenceConfidence: how sure the presence/continuity check must be
      // for a frame to keep its box.
      // minTrackingConfidence: how much the landmark mesh must agree frame to
      // frame (IMAGE mode runs single frames, but the value is pinned so a future
      // switch to VIDEO mode keeps the same tolerance).
      minFaceDetectionConfidence: 0.35,
      minFacePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
      // Needed for the blend-shape confidences behind the eye-area reading (lid
      // exposure). On by default, pinned here so the eye-area reading can't
      // silently lose its input if the default ever changes.
      outputFaceBlendshapes: true,
      // The 4x4 facial transformation matrix. MediaPipe uses it to map the
      // canonical face model onto the detected head, so it encodes the head's
      // real 3D ROTATION. That is a genuine measurement of pitch/roll/yaw, unlike
      // the estimateYaw() heuristic this file used before (which inferred a turn
      // from how far the nose sat from the cheek midpoint). Default false, so it
      // has to be requested explicitly -- see rotationFromMatrix().
      outputFacialTransformationMatrixes: true,
    });
    return faceLandmarker;
  })();

  return loadingPromise;
}

// Lazily-loaded BlazeFace FULL-RANGE detector. Used ONLY as a fallback when the
// landmark model cannot find a face, which in practice means a near-true-profile
// photo -- see BLAZE_FACE_FULL_RANGE_URL for why. Returns null (rather than
// throwing) when the model can't be loaded, so a CDN hiccup degrades the profile
// handling instead of breaking the whole scan.
async function ensureFullRangeDetector() {
  if (fullRangeDetector) return fullRangeDetector;
  if (fullRangePromise) return fullRangePromise;

  fullRangePromise = (async () => {
    try {
      const filesetResolver = await ensureFileset();
      fullRangeDetector = await FaceDetector.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: BLAZE_FACE_FULL_RANGE_URL,
          delegate: "GPU",
        },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.3,
      });
      return fullRangeDetector;
    } catch (err) {
      console.warn("full-range face detector unavailable:", err);
      fullRangePromise = null;
      return null;
    }
  })();

  return fullRangePromise;
}

function ensureFaceapiModels() {
  if (!faceapiModelsPromise) {
    faceapiModelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(TINY_FACE_DETECTOR_URL),
      faceapi.nets.ageGenderNet.loadFromUri(AGE_GENDER_MODEL_URL),
    ]);
  }
  return faceapiModelsPromise;
}

// Lazily-loaded face-api.js SSD detector -- the LAST-resort face-presence check.
// Loaded only when BOTH MediaPipe models fail to find a face, so a normal scan
// never pays for the extra weights. Returns null (not a throw) if the CDN is
// unreachable, so a hiccup degrades the message instead of breaking the scan.
let ssdDetectorPromise = null;
function ensureSsdDetector() {
  if (!ssdDetectorPromise) {
    ssdDetectorPromise = (async () => {
      try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri(SSD_FACE_DETECTOR_URL);
        return true;
      } catch (err) {
        console.warn("face-api SSD detector unavailable:", err);
        ssdDetectorPromise = null;
        return false;
      }
    })();
  }
  return ssdDetectorPromise;
}

// Runs a lightweight on-device face detector + age/gender classifier so the
// result's tier label (Chad vs. Stacy, etc.) matches the person in the
// photo instead of defaulting to one gender. Falls back to "male" if the
// classifier can't find/read a face -- the geometry scores are unaffected.
async function detectGender(imgEl, landmarks) {
  try {
    await ensureFaceapiModels();
    const detection = await faceapi
      .detectSingleFace(imgEl, new faceapi.TinyFaceDetectorOptions())
      .withAgeAndGender();
    if (detection && detection.gender) {
      return detection.gender === "female" ? "female" : "male";
    }
  } catch (error) {
    console.debug("Face-api gender detection fallback:", error);
  }

  // Landmark geometry fallback for gender auto-detection
  if (landmarks && imgEl) {
    const w = imgEl.naturalWidth || imgEl.width || 600;
    const h = imgEl.naturalHeight || imgEl.height || 600;
    const px = (i) => toPixels(landmarks[i], w, h);

    const browL = px(70), browR = px(300);
    const eyeL = px(33), eyeR = px(263);
    const cheekL = px(CHEEK_LEFT), cheekR = px(CHEEK_RIGHT);
    const jawL = px(JAW_LEFT), jawR = px(JAW_RIGHT);

    const cheekWidth = dist(cheekL, cheekR) || 1;
    const jawWidth = dist(jawL, jawR);
    const browEyeDist = (dist(browL, eyeL) + dist(browR, eyeR)) / 2;

    const jawToCheek = jawWidth / cheekWidth;
    const browRatio = browEyeDist / cheekWidth;

    if (browRatio > 0.155 || jawToCheek < 0.88) {
      return "female";
    }
  }

  return "male";
}

// Tier anchors, set from the MEASURED distribution of the test set rather than
// picked to look tidy. The old anchors (Chad Lite 80 / Chad 87 / True Adam 93)
// put three tiers inside a range the scorer almost never produced: measured front
// photos of professional models clustered at 78-83, so "chad" and "true adam"
// were effectively unreachable and every model landed on "high tier" -- the
// reported "that's an insult to them" bug. Two things were true at once: the
// weights were suppressing elite scores (fixed above) AND the top anchors sat
// above the reachable range.
//
// These anchors are calibrated against the MEASURED distribution of the test set
// with the rebalanced weights (verified via tools/scoringCheck.mjs), so each band
// is actually populated by real faces instead of sitting above the reachable
// range. "True Adam" is intentionally kept rare -- it should need a face that is
// near-flawless across every discriminating reading at once (a genuine outlier),
// not merely a very good one.
//
// Measured reference points after the rebalance (front-view photos only):
//   a soft/full face        ~68-72  -> High Tier
//   a strong-but-uneven face ~79-84 -> Chad Lite
//   a top professional model ~88-92 -> Chad
//   a near-flawless outlier  ~94+   -> True Adam
const TIER_TICKS_BY_GENDER = {
  male: [
    { pos: 0, label: "Low Tier", group: "glowup" },
    { pos: 45, label: "Mid Tier", group: "glowup" },
    { pos: 62, label: "High Tier", group: "glowup" },
    { pos: 78, label: "Chad Lite", group: "maintain" },
    { pos: 88, label: "Chad", group: "maintain" },
    { pos: 94, label: "True Adam", group: "maintain" },
  ],
  female: [
    { pos: 0, label: "Low Tier", group: "glowup" },
    { pos: 45, label: "Mid Tier", group: "glowup" },
    { pos: 62, label: "High Tier", group: "glowup" },
    { pos: 78, label: "Stacy Lite", group: "maintain" },
    { pos: 88, label: "Stacy", group: "maintain" },
    { pos: 94, label: "Eve", group: "maintain" },
  ],
};

export function tiersFor(gender) {
  return TIER_TICKS_BY_GENDER[gender] || TIER_TICKS_BY_GENDER.male;
}

function tierTickFor(score, gender) {
  const ticks = tiersFor(gender);
  let tick = ticks[0];
  for (const t of ticks) {
    if (score >= t.pos) tick = t;
  }
  return tick;
}

export function tierFor(score, gender = "male") {
  return tierTickFor(score, gender).label.toLowerCase();
}

export function tierGroupFor(score, gender = "male") {
  return tierTickFor(score, gender).group;
}

function toPixels(landmark, w, h) {
  return { x: landmark.x * w, y: landmark.y * h };
}

function reflectAcrossLine(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return p;

  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return { x: 2 * projX - p.x, y: 2 * projY - p.y };
}

// Interior angle at vertex b, in degrees, for the corner a-b-c. Used for jaw /
// chin / gonion shape readings.
function angleDeg(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = (Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y)) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeSymmetryScore(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const axisA = px(MIDLINE_TOP);
  const axisB = px(MIDLINE_BOTTOM);
  const scale = dist(px(SCALE_LEFT), px(SCALE_RIGHT));
  if (!scale) return 50;

  let totalDeviation = 0;
  for (const [li, ri] of SYMMETRY_PAIRS) {
    const l = px(li);
    const r = px(ri);
    const rReflected = reflectAcrossLine(r, axisA, axisB);
    totalDeviation += dist(l, rReflected) / scale;
  }
  const avgDeviation = totalDeviation / SYMMETRY_PAIRS.length;

  // Calibrated scaling for real photos:
  // Model symmetry (~0.015 dev) -> 90%
  // Average face (~0.045 dev) -> 69%
  // Asymmetric/soft face (~0.075 dev) -> 49%
  let score = 100 - avgDeviation * 680;

  // Facial-definition check. The mirror-deviation above only measures whether
  // the left and right halves MATCH -- it says nothing about whether the lower
  // face is well-defined. A heavier, lower-face-heavy structure (jaw as wide as
  // or wider than the cheekbones) is mirror-symmetric, so it scored high here
  // even though the face plainly reads as fuller/softer, not as model-sharp.
  // On the test set this is what kept a heavy older face scoring 83.7 symmetry
  // -- above a top model -- and riding that into a tier it didn't belong in.
  // Threshold 1.06 is the same cutoff used in computeGoldenRatioScore: every
  // model sits at or below it, so their symmetry is untouched; only a genuinely
  // wide/heavy lower face loses points here.
  const cheekWidth = dist(px(CHEEK_LEFT), px(CHEEK_RIGHT));
  if (cheekWidth) {
    const jawToCheek = dist(px(JAW_LEFT), px(JAW_RIGHT)) / cheekWidth;
    if (jawToCheek > 1.06) score -= (jawToCheek - 1.06) * 250;

    // Roundness check. A short, round face is mirror-symmetric but its left and
    // right halves are curving away from the midline, so a high mirror score is
    // not the "model-sharp" symmetry it looks like -- it's the symmetry of a
    // circle. Penalise a face that is nearly as wide as it is long so a round
    // face can't ride symmetry into a tier above its structure. Models sit at
    // length/width ~1.246-1.317; round test faces at ~1.186-1.255, and the
    // threshold 1.24 leaves every model at zero.
    const faceLength = dist(px(MIDLINE_TOP), px(MIDLINE_BOTTOM));
    const lengthToWidth = faceLength / cheekWidth;
    if (lengthToWidth < 1.24) score -= (1.24 - lengthToWidth) * 260;

    // Soft-chin check: a very obtuse chin corner is a full, rounded lower face
    // running smoothly into the chin rather than a defined one. Same idea as the
    // roundness term. Model chins measure ~82-89 deg here, so the 90 deg
    // threshold leaves every model at zero.
    const chinDeg = angleDeg(px(JAW_LEFT), px(MIDLINE_BOTTOM), px(JAW_RIGHT));
    if (chinDeg > 90) score -= (chinDeg - 90) * 1.4;
  }

  return clamp100(score);
}

function computeGoldenRatioScore(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const faceLength = dist(px(MIDLINE_TOP), px(MIDLINE_BOTTOM));
  const faceWidth = dist(px(CHEEK_LEFT), px(CHEEK_RIGHT));
  const jawWidth = dist(px(JAW_LEFT), px(JAW_RIGHT));
  const foreheadWidth = dist(px(70), px(300));

  if (!faceWidth) return 50;
  const ratio = faceLength / faceWidth;
  const jawToCheek = jawWidth / faceWidth;
  const foreheadToCheek = foreheadWidth / faceWidth;
  // Facial BALANCE: how wide the forehead is relative to the jaw. Well-proportioned
  // faces sit near ~0.86-0.90 (forehead only slightly narrower than the jaw). A
  // value well below that means a narrow forehead over a very wide, heavy lower
  // face -- the "pear"/lower-face-heavy structure. This is the one structural
  // signal the other three ratios miss: a middle-aged, heavier face can be
  // mirror-symmetric (so it scored high on symmetry) and have a fine length and
  // cheek ratio, yet still read as a heavy lower face -- and it was scoring high
  // tier off that symmetry alone. Measured on the test set: supermodels sit at
  // 0.86-0.89, the heavier older face at 0.80.
  const foreheadToJaw = foreheadWidth / jawWidth;

  // Smooth "distance from ideal" penalties, one term per proportion, each with
  // its own ideal and slope. This replaces a set of hard threshold rules whose
  // calibration had two concrete failures on real model photos:
  //
  // 1. ratio: the old |ratio-1.30|*280 slope charged Jordan Barrett ~22 points
  //    for a ratio of 1.20 -- an entirely normal face length. A slightly short
  //    or long face is not a defect; only a genuinely extreme ratio is.
  // 2. jaw: the old jawToCheek > 0.92 rule (slope 260) fired on EVERY test
  //    model (1.03-1.12) and cost them 25-50 points. A jaw that is wide
  //    relative to the cheekbones is a strong, angular jaw -- a positive trait
  //    the rule was mislabeling as lower-face bloat.
  //
  // Ideals: length/width ~1.30, jaw/cheek ideal is a well-defined tapering jaw
  // (~1.02) with a gentle slope for narrow jaws -- but a jaw WIDER than the
  // cheekbones is a genuinely heavy lower face, so that side fires harder and
  // only above ~1.06 (every model sits at or below that, so they pay nothing).
  // forehead/cheek ~0.90; forehead/jaw balance ~0.87.
  const ratioDev = Math.abs(ratio - 1.30);
  const foreheadDev = Math.abs(foreheadToCheek - 0.90);

  // One-sided jaw rule: a too-narrow jaw is nudged, an over-wide/heavy jaw is
  // taxed harder. Threshold 1.06 keeps every model (max ~1.057) untouched, so
  // the slope can be steep without touching a well-proportioned face.
  let jawPenalty = 0;
  if (jawToCheek > 1.06) {
    jawPenalty = (jawToCheek - 1.06) * 500;
  } else if (jawToCheek < 0.95) {
    jawPenalty = (0.95 - jawToCheek) * 120;
  }

  // Lower-face-heavy penalty (only below 0.85; models sit at 0.86-0.89). A
  // narrow forehead over a very wide jaw is the clearest "heavy lower face"
  // structure, so this is the strongest single structural deduction. Together
  // with the jaw term it is what separates a heavier older face (which can be
  // perfectly mirror-symmetric and otherwise fine) from a model's clean
  // lower-face taper -- the model threshold (0.85) keeps every model at zero.
  let balancePenalty = 0;
  if (foreheadToJaw < 0.85) {
    balancePenalty = (0.85 - foreheadToJaw) * 1000;
  }

  const score =
    100 - ratioDev * 150 - jawPenalty - foreheadDev * 90 - balancePenalty;
  return clamp100(score);
}

// Rough heuristic classification into one of eight common face-shape
// buckets, based on the ratio of face length to cheekbone width and how
// the forehead/jaw widths compare to the cheekbones. Not a validated
// model -- same "fun geometry" spirit as the other scores.
//
// Width reference (denominator for every ratio): the real cheekbone span,
// 116/345. See CHEEK_LEFT/RIGHT near the top for why the older temple and
// mid-cheek pairs were dropped.
//
// Jaw landmark fix: jaw width used 172/397, but a landmark probe drawn on a
// real photo (Chico) showed those two points sit under the mouth/chin, NOT on
// the jaw angle -- the span they measure is far too narrow, so no prototype
// could ever match it and every face was dragged toward "Round". 132/361 are
// the true jaw angle (gonion) points; on the same photo they measure the jaw
// correctly.
//
// Uses prototype-matching instead of a sequential if-else chain: each shape
// has a "typical" (lengthToWidth, jawToCheek, foreheadToCheek) profile, and
// we pick whichever prototype is closest in weighted distance, so no single
// condition can "win" just by being checked first. The profile numbers are
// calibrated to ratios measured on real landmarks with the corrected width
// (an Adriana Lima portrait: ~1.23 / ~1.03 / ~0.92; a male model: ~1.32 /
// ~1.06 / ~0.93), not guessed. Eight shapes are covered so faces with a
// lower-face-heavy or tall wide-jawed structure have a home instead of being
// forced into Round/Square.
const FACE_SHAPE_PROTOTYPES = [
  // Oval: broadly balanced, gently tapered jaw, forehead a touch narrower
  // than the cheekbones. The "default good" shape most models fall into.
  { shape: "Oval", lengthToWidth: 1.24, jawToCheek: 1.00, foreheadToCheek: 0.90 },
  // Round: soft, short face -- nearly as wide as long, full jaw.
  { shape: "Round", lengthToWidth: 1.05, jawToCheek: 1.03, foreheadToCheek: 0.94 },
  // Square: short like round but with a wide, angular jaw as wide as cheeks.
  { shape: "Square", lengthToWidth: 1.10, jawToCheek: 1.08, foreheadToCheek: 0.96 },
  // Long: clearly longer than wide, jaw tapers in.
  { shape: "Long", lengthToWidth: 1.48, jawToCheek: 0.99, foreheadToCheek: 0.88 },
  // Heart: wide forehead, narrow/pointed chin.
  { shape: "Heart", lengthToWidth: 1.16, jawToCheek: 0.85, foreheadToCheek: 1.00 },
  // Diamond: cheekbones the widest point; both forehead and jaw narrower.
  { shape: "Diamond", lengthToWidth: 1.20, jawToCheek: 0.88, foreheadToCheek: 0.80 },
  // Oblong/Rectangle: like Long but the jaw stays as wide as the cheeks, so
  // the sides are straighter -- distinct from Long's taper and Square's
  // shortness. Without this, tall wide-jawed faces fall through to Square.
  { shape: "Oblong", lengthToWidth: 1.42, jawToCheek: 1.05, foreheadToCheek: 0.86 },
  // Triangle (pear): jaw is the WIDEST part, forehead the narrowest -- the
  // inverse of Heart. Included so lower-face-heavy faces have a home instead
  // of being pulled to Square/Round.
  { shape: "Triangle", lengthToWidth: 1.28, jawToCheek: 1.10, foreheadToCheek: 0.82 },
];

function computeFaceShape(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const faceLength = dist(px(MIDLINE_TOP), px(MIDLINE_BOTTOM));
  // Same width definition as computeGoldenRatioScore: the widest of the
  // temple span (234/454) and the mid-cheek span (50/280), so a hairline
  // covering the temples can't collapse the cheekbone reference.
  // Same width definition as computeGoldenRatioScore: the real cheekbone span.
  const cheekboneWidth = dist(px(CHEEK_LEFT), px(CHEEK_RIGHT));
  // True jaw angle (gonion) points. 172/397 sit under the mouth and measure a
  // far-too-narrow span; see the note above FACE_SHAPE_PROTOTYPES.
  const jawWidth = dist(px(JAW_LEFT), px(JAW_RIGHT));
  const foreheadWidth = dist(px(70), px(300));

  if (cheekboneWidth === 0) return "Oval";

  const lengthToWidth = faceLength / cheekboneWidth;
  const jawToCheek = jawWidth / cheekboneWidth;
  const foreheadToCheek = foreheadWidth / cheekboneWidth;

  // Two things went wrong here in sequence, and both are worth recording:
  //
  // 1. With weights (2.0 length, 1.0 jaw, 1.0 forehead) ordinary strong-jawed
  //    male models were labelled "Triangle" (pear-shaped, widest at the jaw) even
  //    though their foreheads measured a perfectly normal 0.91-0.94. Triangle's
  //    lengthToWidth happened to match while its very narrow forehead prototype
  //    (0.82) was only lightly penalised -- the shape was chosen on a coincidence.
  // 2. Gating Triangle/Heart on the forehead instead over-corrected the other
  //    way: with those two shapes excluded, EVERY test face collapsed to "Oval",
  //    because no other prototype was within reach.
  //
  // The real fix is to make the forehead ratio a full participant, so the shapes
  // that differ mainly in forehead width can actually win on that difference. The
  // measured forehead/cheek ratios span 0.888 (a genuinely tapered face) to 0.955
  // (a wide one), so this dimension carries real, usable signal -- it just needed
  // enough weight to outweigh length noise.
  const distFor = (proto) =>
    2.0 * Math.abs(lengthToWidth - proto.lengthToWidth) +
    1.0 * Math.abs(jawToCheek - proto.jawToCheek) +
    2.0 * Math.abs(foreheadToCheek - proto.foreheadToCheek);

  let best = FACE_SHAPE_PROTOTYPES[0];
  let bestDist = Infinity;
  for (const proto of FACE_SHAPE_PROTOTYPES) {
    const d = distFor(proto);
    if (d < bestDist) {
      bestDist = d;
      best = proto;
    }
  }

  // Margin check. When the winner is only marginally closer than the runner-up,
  // the reading is genuinely ambiguous (the width ratios overlap heavily across
  // shapes) and a confident second label would be false precision. In that case
  // fall back to reporting the neutral shape instead of guessing.
  let runnerUpDist = Infinity;
  for (const proto of FACE_SHAPE_PROTOTYPES) {
    if (proto.shape === best.shape) continue;
    runnerUpDist = Math.min(runnerUpDist, distFor(proto));
  }
  const ambiguous = runnerUpDist - bestDist < 0.03;

  // Debug aid: log the raw ratios so misclassifications can be reported
  // with real numbers instead of guesswork. Harmless in production --
  // visible only to anyone with devtools open.
  console.debug("[faceShape]", {
    lengthToWidth: lengthToWidth.toFixed(3),
    jawToCheek: jawToCheek.toFixed(3),
    foreheadToCheek: foreheadToCheek.toFixed(3),
    picked: best.shape,
    bestDist: bestDist.toFixed(3),
    runnerUpDist: runnerUpDist === Infinity ? null : runnerUpDist.toFixed(3),
    ambiguous,
  });

  // Ambiguity is reported honestly instead of papered over: the width ratios of
  // real faces overlap heavily (measured jaw/cheek spans 1.02-1.08 and
  // forehead/cheek 0.89-0.96 across the whole test set -- far narrower than the
  // spread the eight prototypes assume), so most faces are genuinely "near Oval",
  // and claiming a dramatic shape like Triangle or Diamond off a 0.03 ratio
  // difference would be inventing precision. Instead the label reports the shape
  // AND the structure the ratios actually show, which is the useful part.
  //
  // The direction words are calibrated on the measured set: jaw/cheek >= 1.06 is
  // a genuinely wide lower face, <= 0.99 a tapered one; forehead/cheek >= 0.94 is
  // a wide upper face, <= 0.90 a narrow one.
  const jawWord = jawToCheek >= 1.06 ? "wide jaw" : jawToCheek <= 0.99 ? "tapered jaw" : null;
  const browWord =
    foreheadToCheek >= 0.94 ? "wide brow" : foreheadToCheek <= 0.90 ? "narrow brow" : null;
  const modifiers = [browWord, jawWord].filter(Boolean);

  if (ambiguous && best.shape !== "Oval" && modifiers.length === 0) {
    // Close call AND no distinctive structure to point at: say so plainly rather
    // than assert a shape the data doesn't support.
    return "Oval (balanced)";
  }
  if (best.shape === "Oval" && modifiers.length) {
    return "Oval \u00b7 " + modifiers.join(" \u00b7 ");
  }
  return best.shape;
}

// Canthal tilt: the angle of the line through each eye's inner/outer
// corners relative to horizontal, averaged across both eyes. Positive =
// outer corner higher than inner ("upturned"/fox-eye), negative =
// "downturned", near zero = neutral.
//
// The raw mesh reading carries a systematic POSITIVE bias: on real frontal
// photos the inner-corner landmarks (133/362) sit a few pixels lower than the
// outer corners (33/263) by construction, so a perfectly neutral face measured
// as +5-6 deg "upturned". A probe over every test photo showed the raw average
// sitting at ~5.7 deg EVEN for faces with visibly neutral/flat eyes, which is
// why virtually every frontal scan was labelled "Upturned". Subtracting this
// calibration offset re-centres the scale on the mesh's own neutral, so the
// DISPLAYED tilt and the eye-shape label below both read neutral for neutral
// eyes and only call a face "upturned" when it genuinely is.
const CANTHAL_TILT_MESH_BIAS = 4.5;
function computeCanthalTilt(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);

  const angleFor = (outerIdx, innerIdx) => {
    const outer = px(outerIdx);
    const inner = px(innerIdx);
    const dx = Math.abs(outer.x - inner.x);
    const dy = inner.y - outer.y; // positive when outer corner sits higher
    if (dx === 0) return 0;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  };

  const tiltDeg = (angleFor(33, 133) + angleFor(263, 362)) / 2 - CANTHAL_TILT_MESH_BIAS;

  let label = "Neutral";
  if (tiltDeg >= 2) label = "Positive";
  else if (tiltDeg <= -2) label = "Negative";

  return { degrees: tiltDeg, label };
}

// --- eye shape --------------------------------------------------------------
//
// Classifies eye shape from two geometric readings that MediaPipe's mesh gives
// reliably (see the landmark index cheat sheet:
// https://hackernoon.com/mediapipe-face-mesh-landmark-indices-cheat-sheet):
//
//   1. Eye aspect ratio (EAR) -- lid height / corner-to-corner width. A high
//      EAR is a rounder, more open eye; a lower one is a longer almond eye.
//      Left eye: outer 33, inner 133, upper lid 159, lower lid 145.
//      Right eye: outer 263, inner 362, upper lid 386, lower lid 374.
//   2. Canthal tilt -- already computed, reused here for the up/down component.
//
// The two combine into a shape label and a 0-100 "eye score". Almond with a
// slight positive tilt is the most conventionally striking combination, so the
// score peaks there and falls off for very round, very downturned, or very
// hooded/narrow eyes. Purely geometric, same "fun" spirit as the rest.
function computeEyeShape(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);

  const eyeMetricsFor = (outerIdx, innerIdx, upperIdx, lowerIdx) => {
    const outer = px(outerIdx);
    const inner = px(innerIdx);
    const upper = px(upperIdx);
    const lower = px(lowerIdx);
    const width = dist(outer, inner);
    if (!width) return null;
    // Lid height measured perpendicular to the corner line, so a tilted eye
    // doesn't inflate the ratio just because its corners sit at different y.
    const dx = outer.x - inner.x;
    const dy = outer.y - inner.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const mid = { x: (outer.x + inner.x) / 2, y: (outer.y + inner.y) / 2 };
    const lidHeight =
      Math.abs((upper.x - mid.x) * nx + (upper.y - mid.y) * ny) +
      Math.abs((lower.x - mid.x) * nx + (lower.y - mid.y) * ny);
    return { width, lidHeight, ear: lidHeight / width };
  };

  const l = eyeMetricsFor(33, 133, 159, 145);
  const r = eyeMetricsFor(263, 362, 386, 374);
  if (!l || !r) return { label: "Unknown", score: 50, ear: 0, tilt: 0 };

  const ear = (l.ear + r.ear) / 2;
  const tilt = computeCanthalTilt(landmarks, w, h).degrees;

  // Shape label. EAR bands are calibrated against the test photos, where a
  // rounded "doe" eye sits high and a long, narrow/hooded eye sits low:
  //   roundest / most open (Doutzen, a known doe-eyed model): ~0.33
  //   typical almond model eye (adriana, jordan, download6):   ~0.26-0.28
  //   narrow / hooded / deep-set (plus-size, chico, sean):     ~0.21-0.25
  // The old bands (round >= 0.36, narrow < 0.20) were wide enough that EVERY
  // test face fell into "Almond" and the up/down prefix then decided the label
  // alone -- so once the tilt bias above made everyone read "upturned", the
  // whole set became "Upturned Almond". These bands separate the three groups
  // the photos actually show.
  let label;
  if (ear >= 0.31) label = "Round";
  else if (ear < 0.24) label = "Hooded Narrow";
  else label = "Almond";
  // Only a genuinely upturned tilt prefixes the label; near-neutral stays plain
  // (the mesh bias is already removed in computeCanthalTilt).
  if (tilt >= 3.5) label = "Upturned " + label;
  else if (tilt <= -2) label = "Downturned " + label;

  // Score: almond is the ideal base, then near-neutral-to-slightly-positive
  // tilt. Very round or very narrow lose points; strong negative tilt loses more.
  const almondIdeal = 0.25;
  const earPenalty = Math.abs(ear - almondIdeal) * 180;
  let tiltPenalty = 0;
  if (tilt < 0) tiltPenalty = Math.abs(tilt) * 3.5;
  else if (tilt > 6) tiltPenalty = (tilt - 6) * 2.5; // overshoot looks startled/unnatural
  const score = clamp100(100 - earPenalty - tiltPenalty);

  console.debug("[eyeShape]", { ear: ear.toFixed(3), tilt: tilt.toFixed(1), label, score: score.toFixed(1) });

  return { label, score, ear, tilt };
}

// --- eye area ---------------------------------------------------------------
//
// The eye AREA, not just the eye shape. In looksmaxxing terms the eye area is a
// composite: canthal tilt, projection (deep-set/prominent), eyelid exposure
// (upper-lid show + lower-lid scleral show) and the brow (brow-eye distance +
// intercanthal ratio). computeEyeShape above only supplies the shape half of the
// first component; this assembles the rest and blends them with the weights in
// EYE_AREA_WEIGHTS.
//
// Two of the sub-readings are approximations, and the code says so rather than
// pretending otherwise:
//   - Projection is at heart a PROFILE reading. analyzeSideProfile already
//     measures it properly from turned-head landmarks. Frontally we can only
//     infer it from how hooded the upper lid is (a well-covered lid reads
//     deep-set, a fully exposed lid reads prominent/round), so the frontal
//     score is deliberately narrow-banded and never claims "prominent" on its
//     own unless the lid is completely exposed.
//   - Upper-lid exposure is read from MediaPipe's own blendshape confidences
//     (eyeBlinkLeft/Right + eyeSquintLeft/Right) when the model exposes them.
//     A blink coefficient of ~0 is a wide-open lid (max exposure), ~0.5 is a
//     relaxed lid with a visible supratarsal crease. If the model ever stops
//     returning blendshapes the reading falls back to the EAR-based hooding
//     proxy above, so the composite degrades instead of breaking.
//
// Everything is a ratio against the subject's OWN face scale, so eye area is
// invariant under image size and under how much of the frame the face fills.

// Landmark indices for the eye-area geometry. Same slots computeEyeShape already
// uses, kept together here so the two eye readings stay in lockstep.
const EYE_LIDS = [
  { outer: 33, inner: 133, upper: 159, lower: 145 },
  { outer: 263, inner: 362, upper: 386, lower: 374 },
];

// A cap on the composite from the WEAKEST sub-reading. The eye AREA is only as
// good as its weakest part -- a face can have a textbook tilt and a textbook brow
// and still be held back by heavy lid hooding -- so a bad part limits the score
// instead of being averaged away.
//
// The bands are deliberately WIDE and only bite below "comfortable" (70), because
// the first calibration of this table (72/55/35 -> 100/78/66/52) pinned almost
// every real photo to exactly 52: with four parts, at least one sub-score is
// usually in the 30s-50s (a high trust-region-face brow or a strongly hooded lid),
// so the cap -- not the reading -- decided the number. These bands leave a
// comfortable face untouched and give an uncomfortable one a graded, still-
// meaningful score.
// The `min: 90` band exists so the composite can never read HIGHER than a part
// that is short of ideal. Without it, a face with one part at 88 and three at 100
// blended to ~97 and was labelled "Excellent" while its own panel showed an 88 --
// the badge contradicting the parts beneath it, which is the exact complaint this
// table was introduced to fix. The cap is close to the part's own value so a
// strong-but-imperfect reading barely moves, while the displayed number can no
// longer exceed what the weakest part supports.
const EYE_AREA_REQUIREMENT_CAPS = [
  { min: 90, cap: 100 },
  { min: 78, cap: 92 },
  { min: 70, cap: 85 },
  { min: 55, cap: 78 },
  { min: 40, cap: 70 },
  { min: 25, cap: 62 },
  { min: 0, cap: 55 },
];

// Are the 10 iris points present in this mesh?
//
// MediaPipe Face Landmarker's 478 points are 468 face-mesh points followed by 10
// iris points:
//   left  iris: centre 468, ring 469-472
//   right iris: centre 473, ring 474-477
//
// The scorer does NOT use them, and that is now a measured conclusion rather than
// caution: the MediaPipe iris ring is a fixed-size synthetic circle that is not
// clipped by the eyelids (it spans the whole eye opening and more -- see the probe
// results in the note above the scleral calculation and tools/probeIris.mjs), so
// there is no real "iris bottom" to anchor a scleral reading to. Their presence is
// still cheap and useful to report, so the UI can say whether this capture
// included iris tracking at all.
function hasIrisPoints(landmarks) {
  if (!landmarks || landmarks.length < 478) return false;
  // Spot-check the two iris centres and one ring point each; if those are present
  // the whole set is (the model returns them together or not at all).
  return !!(landmarks[468] && landmarks[473] && landmarks[469] && landmarks[474]);
}

// The eye-area letter label for a 0-100 score. One definition, used both inside
// computeEyeArea and when the score is re-labelled after the fullness damp -- so
// the word and the number can never drift apart.
function eyeAreaLabelFor(score) {
  if (score >= 80) return "Excellent";
  if (score >= 62) return "Good";
  if (score >= 45) return "Average";
  return "Weak";
}

function computeEyeArea(landmarks, w, h, eyeShape, canthalTilt, blendshapes) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const iod = dist(px(SCALE_LEFT), px(SCALE_RIGHT)) || 1;

  // --- canthal tilt: the existing reading, reused so the eye area can't
  // disagree with the Canthal tilt row in the report.
  const canthalScore = canthalTiltComponentScore(canthalTilt.degrees);

  // --- eyelid exposure -----------------------------------------------------
  // The free band that BOTH the score and the label use, declared here so both
  // read the exact same thresholds: at or below LOW is a very open lid, at or
  // above HIGH is a hooded one, in between is "Balanced".
  //
  // Calibrated on the measured `lidExposure` values across the test set, which
  // span ~0.20 (FatGirl, the least hooded) to ~0.86 (Doutzen, the most hooded).
  // The first attempt reused the EAR-band derivation (0.69-0.76) and put EVERY
  // real face below the low edge, so the label collapsed to "Fully visible" for
  // all eight photos -- the percentages are not spread over 0-1 the way that
  // arithmetic assumed. These edges split the observed range into three groups.
  // (The old fixed free band EYELID_IDEAL_LOW/HIGH is gone -- it was the reason
  // every face scored the same here. The score now grades continuously from an
  // open-lid ideal, see the eyelid score block below.)
  // The "covered" label needs a wider margin than the score band. A reading of
  // 0.64 is only 0.02 past the edge, so it scored a near-perfect 97 while being
  // LABELLED "Crease covered" -- the words contradicting the number beside them.
  // The words describe the reading, so they only claim "covered" once it is
  // meaningfully past the edge; between the two it reads as the middle state.
  // The label edges are TIGHTER than the first version (0.26 / 0.72), which put
  // the whole measured frontal range (0.20..0.65) inside one "Crease balanced"
  // bucket -- the reported "every face reads crease balanced" bug. Split at 0.30 /
  // 0.58 so the three states actually appear across real faces: a tight almond eye
  // (<= 0.30) reads "Crease clear", a softer fold (>= 0.58) reads "Crease
  // covered", and the genuinely middle eyes stay "Crease balanced".
  const EYELID_COVERED_LABEL_AT = 0.58;
  const EYELID_OPEN_LABEL_AT = 0.30;
  // Eyelid proxy from the lid height (EAR) already computed by computeEyeShape,
  // plus MediaPipe's blend-shape lid estimates when they are available.
  const blinkL = readBlendshape(blendshapes, "eyeBlinkLeft");
  const blinkR = readBlendshape(blendshapes, "eyeBlinkRight");
  const squintL = readBlendshape(blendshapes, "eyeSquintLeft");
  const squintR = readBlendshape(blendshapes, "eyeSquintRight");
  const blink = avgPresent(blinkL, blinkR);
  const squint = avgPresent(squintL, squintR);

  // Lid exposure 0-1, where LOW means a wide-open lid with the supratarsal crease
  // showing and HIGH means a hooded/covered lid.
  //
  // DIRECTION, and this was measured rather than assumed: a diagnostic across the
  // test photos showed lid span (EAR) correlates POSITIVELY with hooding, not
  // negatively -- the roundest eye in the set (Doutzen, EAR 0.328) is the most
  // hooded (exposure 0.91) and the narrowest (FatGirl, EAR 0.21) is the least
  // (0.30). That is anatomically sensible once seen: a taller lid span is a fuller
  // fold of skin over the lid, while a compact almond eye shows its crease. The
  // first version assumed the opposite and produced exactly the contradiction the
  // report was showing -- a "Hooded Narrow" eye labelled "Fully visible".
  const earExposure = clamp01((eyeShape.ear - 0.2) / 0.13);

  // EAR is the primary signal because it is the one that tracked reality in the
  // diagnostic. The blendshape estimate (eyeBlink/eyeSquint) is deliberately
  // capped at a 30% share: on the same diagnostic it did not separate hooded from
  // open eyes (FatGirl and Adriana sat at nearly the same blink value despite
  // very different lids), so it can shade the reading but must not lead it.
  let lidExposure = earExposure;
  if (blink !== null && squint !== null) {
    // A blink coefficient near 0.5 is a relaxed lid; higher leans toward closure.
    const blendExposure = clamp01(0.55 - blink * 0.6 + squint * 0.1);
    lidExposure = earExposure * 0.7 + blendExposure * 0.3;
  }
  lidExposure = clamp01(lidExposure);

  // Lower-lid scleral show (white below the iris).
  //
  // MEASURED from the eye aperture, using the eye's own corner span as the scale.
  // The reading below the aperture was re-derived against real detections
  // (tools/probeIris.mjs) after two earlier attempts, and the numbers are what
  // settled it:
  //
  //   1. A direct iris-anchored reading ("how far the lower lid sits below the
  //      iris bottom", iris ring 469-472 / 474-477) is IMPOSSIBLE on this mesh.
  //      The MediaPipe iris ring is a fixed-size synthetic circle that is NOT
  //      clipped by the eyelids: measured on jordan_barrett.jpg the ring spans
  //      y=346..362 while the visible eye aperture is only y=349..361, i.e. the
  //      "iris" is as tall as (taller than) the eye opening. There is therefore no
  //      true "iris bottom" to compare against -- the lower lid lands ON or ABOVE
  //      the ring bottom on 25 of 28 probed eyes (gap -0.04..-0.21 in iris-height
  //      units). That is exactly why the original iris attempt hit the maximum on
  //      nearly every photo and was reverted; the failure was the ANCHOR, not the
  //      landmark index.
  //
  //   2. The earlier guess that the lower-lid points used (145/374) "sit at the
  //      lid's outer corner, not its lowest point" is also disproved: scanning the
  //      WHOLE lower-lid ring (16 points per eye) shows 145/374 ARE the geometric
  //      lowest point on ~20 of 30 eye rows. The ring points that sometimes beat
  //      them (133/362 corners, 373/380) are eye CORNERS, not lid bottom.
  //
  // So the iris points stay reported as "capture info only" (see hasIrisPoints),
  // and scleral show is read from the aperture itself: how far the lowest
  // lower-lid point sits BELOW the lowest upper-lid point, as a fraction of the
  // eye's corner span. The corner span is a real, eyelid-clipped measurement, so
  // this stays in a narrow, sane band across faces (probed -0.11..+0.14 of eye
  // width) instead of blowing up. A larger aperture fraction = a rounder, more
  // open eye = more lower-lid show.
  const EYE_LID_LOWER = [145, 374];
  const EYE_LID_UPPER = [159, 386];
  const apertureFor = (outerIdx, innerIdx, upperIdx, lowerIdx) => {
    const outer = px(outerIdx);
    const inner = px(innerIdx);
    const width = dist(outer, inner) || 1;
    const upper = px(upperIdx);
    const lower = px(lowerIdx);
    // Aperture along the eye's own vertical axis (perpendicular to the corner
    // line), so a tilted eye does not inflate the gap just because its corners
    // sit at different y -- same construction computeEyeShape uses for lid height.
    const dx = outer.x - inner.x;
    const dy = outer.y - inner.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const mid = { x: (outer.x + inner.x) / 2, y: (outer.y + inner.y) / 2 };
    const up = Math.abs((upper.x - mid.x) * nx + (upper.y - mid.y) * ny);
    const low = Math.abs((lower.x - mid.x) * nx + (lower.y - mid.y) * ny);
    return (up + low) / width; // full aperture as a fraction of eye width
  };
  const aperture =
    (apertureFor(33, 133, EYE_LID_UPPER[0], EYE_LID_LOWER[0]) +
      apertureFor(263, 362, EYE_LID_UPPER[1], EYE_LID_LOWER[1])) /
    2;
  // Scleral show rises with the aperture above a comfortable floor. The band is
  // calibrated on the aperture VALUES THIS MESH ACTUALLY PRODUCES, which is why it
  // is so much higher than the first attempt: measured across the test set the
  // aperture runs 0.21 (FatGirl, the tightest lid) to 0.77 (a true-profile eye),
  // with a comfortable open eye at ~0.26-0.30 (tools/probeEyeArea.mjs). The first
  // band, (aperture-0.10)/0.06, saturated at 1.0 for EVERY frontal face (a normal
  // 0.24 aperture scored (0.24-0.10)/0.06 = 2.3 -> clamped 1.0), so the eyelid
  // penalty wiped every eye area to 0. This band starts a touch above the norm
  // (0.30) and reaches full only at 0.48, so a normal aperture reads zero scleral
  // show and only a genuinely wide/round eye -- or a real profile -- scores any.
  const scleralRaw = clamp01((aperture - 0.30) / 0.18);
  const scleralShow = canthalTilt.degrees < 1 ? scleralRaw : scleralRaw * 0.3;

  // Eyelid score. The old version gave a flat 100 to the whole 0.34..0.62 band and
  // only penalised OUTSIDE it, so every frontal face (measured 0.20..0.65) scored
  // 92-100 and the part never separated anyone. It now grades: a clean, open lid
  // with a visible crease (low exposure, ~0.26) is the ideal and scores highest;
  // points fall off as coverage grows, and heavy hooding is penalised hardest --
  // which is the direction the community actually cares about.
  //
  // Measured anchors (tools/probeEyeArea.mjs, frontal faces): FatGirl 0.21,
  // adriana 0.62, Doutzen 0.86. So the ideal edge is the OPEN end, not the middle.
  //
  // The curve is deliberately LENIENT, and this is a measured-and-corrected choice:
  // a soft fold (0.5-0.7) is a normal, often *attractive* lid on real models, and
  // heavy hooding (0.85+) is a look, not a defect -- the community just prefers a
  // visible crease. A steeper curve crushed adriana to 46 for a lid that is a
  // strength. So: hold near the top across the open AND soft range, then let the
  // score ease smoothly toward the mid-40s for the heaviest hood -- it still ranks
  // below a clear crease, but stops reading as a defect. Anchors after this curve:
  // FatGirl 0.21 -> ~98, adriana 0.62 -> ~87, Doutzen 0.86 -> ~47.
  const EYELID_OPEN_IDEAL = 0.26;
  const EYELID_HOOD_EDGE = 0.62;
  let eyelidScore;
  if (lidExposure <= EYELID_OPEN_IDEAL) {
    // A very open eye is the desired look; nudge only a hair for an extremely wide
    // lid (a different look, not a defect).
    eyelidScore = 100 - (EYELID_OPEN_IDEAL - lidExposure) * 40;
  } else {
    const soft = Math.min(lidExposure, EYELID_HOOD_EDGE) - EYELID_OPEN_IDEAL;
    const hood = Math.max(0, lidExposure - EYELID_HOOD_EDGE);
    // Soft range: gentle (a soft fold is fine). Heavy hood: moderate, not punishing.
    eyelidScore = 100 - soft * 40 - hood * 120;
  }
  if (scleralShow > 0.25) eyelidScore -= (scleralShow - 0.25) * 160;
  eyelidScore = clamp100(eyelidScore);

  // --- brow: brow-eye distance + intercanthal ratio -------------------------
  // Both spacing readings share ONE denominator -- the eye width -- so they sit on
  // the same scale as the textbook intercanthal rule and the numbers shown in the
  // UI mean what a reader expects (intercanthal ~1.2, brow-eye ~0.2).
  const eyeWidth = (dist(px(33), px(133)) + dist(px(263), px(362))) / 2 || 1;
  // Vertical brow-to-eye gap, averaged across both eyes. Vertical because that is
  // the reading that describes brow height; a straight distance to the eye corner
  // would mostly measure the horizontal brow span instead.
  const eyeCenterL = { x: (px(33).x + px(133).x) / 2, y: (px(33).y + px(133).y) / 2 };
  const eyeCenterR = { x: (px(263).x + px(362).x) / 2, y: (px(263).y + px(362).y) / 2 };
  const browEyeDist = (Math.abs(eyeCenterL.y - px(70).y) + Math.abs(eyeCenterR.y - px(300).y)) / 2;
  const browEyeRatio = browEyeDist / eyeWidth;
  const intercanthalRatio = dist(px(133), px(362)) / eyeWidth;

  // A low, heavy brow reads as a compact eye area, so the ideal is a MODERATE
  // distance either way -- a brow touching the lid and a far-away brow are both
  // penalised, the same way the intercanthal ratio only punishes DETOURS.
  //
  // Both use a FREE BAND before any penalty applies. Without one, a reading a
  // hair off the ideal lost points immediately, which is what produced the
  // confusing "brow-eye distance 0.49, ideal ~0.6, score 79/100" in the report:
  // the user is shown a value that looks fine next to a score that doesn't. The
  // band means only a genuinely unusual brow height costs anything, and the
  // displayed ideal then matches the displayed score.
  const BROW_EYE_FREE_BAND = 0.12;
  const INTERCANTHAL_FREE_BAND = 0.15;
  const browDistPenalty =
    Math.max(0, Math.abs(browEyeRatio - BROW_EYE_IDEAL) - BROW_EYE_FREE_BAND) *
    (70 / BROW_EYE_TOLERANCE);
  const intercanthalPenalty =
    Math.max(0, Math.abs(intercanthalRatio - INTERCANTHAL_IDEAL) - INTERCANTHAL_FREE_BAND) *
    (70 / INTERCANTHAL_TOLERANCE);
  const browScore = clamp100(100 - browDistPenalty * 0.55 - intercanthalPenalty * 0.45);

  // --- projection ----------------------------------------------------------
  // This is the one reading that genuinely cannot be made from a front photo:
  // eye projection is defined by the depth relationship between the eyeball and
  // the brow ridge, and a frontal mesh has no reliable depth. What the front view
  // CAN see is lid coverage, which correlates weakly with projection, so that is
  // all this estimates -- and it is labelled as such.
  //
  // An earlier version called a low lid span "Deep-set", which mis-labelled every
  // almond-eyed face: a narrow eye is a lid SHAPE, not a recessed eye. The label
  // now describes the lid it actually measured and never claims "deep-set",
  // which the side-profile reading (analyzeSideProfile) reports properly when a
  // side photo is supplied.
  const projectionScore = clamp100(100 - Math.abs(earExposure - 0.5) * 90);
  let projectionLabel;
  if (earExposure >= 0.8) projectionLabel = "Lid fully exposed";
  else if (earExposure <= 0.2) projectionLabel = "Lid fully covered";
  else projectionLabel = "Partial lid coverage";

  // --- composite -----------------------------------------------------------
  // The weighted blend the user sees as "Eye Area", then a REQUIREMENT layer on
  // top. Weighting alone lets a face with one genuinely weak part still average
  // high (a strong tilt and brow can carry a heavily hooded lid past 80), so the
  // weakest sub-reading also caps the composite -- the same trick the face-fat
  // tier cap uses in analyzeFace(). The requirement layer only ever LOWERS the
  // score, so a face with no weak part is untouched.
  const parts = [canthalScore, eyelidScore, browScore, projectionScore];
  const weakest = Math.min(...parts.map((p) => (Number.isFinite(p) ? p : 100)));
  const requirementCap =
    (EYE_AREA_REQUIREMENT_CAPS.find((r) => weakest >= r.min) ||
      EYE_AREA_REQUIREMENT_CAPS[EYE_AREA_REQUIREMENT_CAPS.length - 1]).cap;

  // Weighted blend over the parts actually present on the mesh. `totalW` is
  // normalised rather than assumed to be 1 so a missing part can never silently
  // deflate the score (the weights themselves still live in EYE_AREA_WEIGHTS).
  //
  // PROJECTION IS EXCLUDED ON A FRONT-ONLY SCAN. This is a correctness fix, not a
  // tuning one: the frontal projection estimate is computed from `earExposure`,
  // which is the SAME input as the eyelid score -- so including both counted one
  // measurement twice, and because their formulas differ wildly (a neutral lid
  // scored 97 for eyelid but 82 for "projection") the duplicate silently dragged
  // the composite down for no reason. Its 0.25 weight is redistributed by the
  // normalisation below, which is exactly what that normalisation is for.
  //
  // combineAnalysis re-adds a REAL projection score derived from the side photo,
  // where the depth relationship is genuinely measurable.
  const entries = [
    { key: "canthal", value: canthalScore },
    { key: "eyelid", value: eyelidScore },
    { key: "brow", value: browScore },
  ];
  let totalW = 0;
  let weighted = 0;
  for (const e of entries) {
    const w = EYE_AREA_WEIGHTS[e.key];
    if (!w || !Number.isFinite(e.value)) continue;
    totalW += w;
    weighted += e.value * w;
  }
  // The frontal projection estimate is still RETURNED (the UI shows it as a
  // lid-coverage reading), it just does not vote in the composite.
  let score = totalW ? weighted / totalW : 60;
  score = clamp100(Math.min(score, requirementCap));

  const label = eyeAreaLabelFor(score);

  // Exposure label, and the source it came from. Blendshapes are the better
  // estimate; the EAR proxy is the fallback, and naming which one was used keeps
  // the reading auditable instead of a black box.
  const lidSource = blink !== null || squint !== null ? "blendshape" : "EAR proxy";

  // Label bands, aligned with computeEyeShape's EAR bands so the "Eye shape" card
  // and this reading can never contradict each other:
  //   ear < 0.24 (Hooded Narrow)  -> earExposure < 0.31
  //   ear >= 0.31 (Round)         -> earExposure >= 0.85
  // The same numbers (EYELID_IDEAL_LOW/HIGH, declared above) drive the score.
  // Named for the LID CREASE rather than "hooded", which collided with the
  // "Hooded Narrow" eye-SHAPE label and read as a contradiction next to it. The
  // two describe different things: the shape label is the eye's proportions (a
  // narrow almond vs a round eye), while this is how much of the crease the upper
  // lid shows. "Crease clear / balanced / crease covered" says that without
  // reusing the word that caused the confusion.
  const exposureLabel =
    lidExposure >= EYELID_COVERED_LABEL_AT
      ? "Crease covered"
      : lidExposure <= EYELID_OPEN_LABEL_AT
        ? "Crease clear"
        : "Crease balanced";

  console.debug("[eyeArea]", {
    canthalScore: canthalScore.toFixed(1),
    eyelidScore: eyelidScore.toFixed(1),
    browScore: browScore.toFixed(1),
    projectionScore: projectionScore.toFixed(1),
    exposureLabel,
    // The EAR-only label for comparison in the log, so a disagreement between the
    // shape band and the blended exposure reading is visible while tuning.
    earOnlyLabel:
      eyeShape.ear < 0.24
        ? "Hooded Narrow (EAR)"
        : eyeShape.ear >= 0.31
          ? "Round (EAR)"
          : "Almond (EAR)",
    tiltDeg: canthalTilt.degrees.toFixed(1),
    browEyeRatio: browEyeRatio.toFixed(3),
    intercanthalRatio: intercanthalRatio.toFixed(3),
    lidExposure: lidExposure.toFixed(3),
    scleralShow: scleralShow.toFixed(3),
    projectionLabel,
    lidSource,
    weakest: weakest.toFixed(1),
    requirementCap,
    label,
    score: score.toFixed(1),
  });
  if (typeof window !== "undefined") {
    (window.__eyeDebug = window.__eyeDebug || []).push({
      lidSource,
      exposureLabel,
      lidExposure,
      scleralShow,
      intercanthalRatio,
      browEyeRatio,
      canthalDeg: canthalTilt.degrees,
      requirementCap,
    });
  }

  // Evidence: name the strongest AND weakest sub-reading, since the eye area is a
  // composite and the useful explanation is which part drove the result.
  const partEntries = [
    { name: "canthal tilt", v: canthalScore },
    { name: "projection", v: projectionScore },
    { name: "eyelid exposure", v: eyelidScore },
    { name: "brow placement", v: browScore },
  ];
  const sorted = [...partEntries].sort((a, b) => b.v - a.v);
  const strongest = sorted[0];
  const weakest2 = sorted[sorted.length - 1];
  // Describe the LID and TILT directly rather than naming whichever part happens
  // to score highest. "Canthal tilt" is at or near 100 for almost every face
  // (neutral and positive tilts both score full marks), so calling it "the
  // strongest part" printed the same sentence for every scan -- including a face
  // with a genuinely poor eye area. The lid and tilt are the two readings that
  // actually differ between faces, so the explanation is built from those, with
  // the weakest part named when there is a real weakness to report.
  const lidPhrase =
    exposureLabel === "Crease covered"
      ? "a heavily covered lid crease"
      : exposureLabel === "Crease clear"
        ? "an open lid with the crease showing"
        : "a balanced lid crease";
  const tiltPhrase =
    canthalTilt.label === "Positive"
      ? "an upturned canthal axis"
      : canthalTilt.label === "Negative"
        ? "a downturned canthal axis"
        : "a neutral canthal axis";
  let evidence;
  if (score >= 80) {
    evidence = "excellent eye area — " + lidPhrase + " and " + tiltPhrase;
  } else if (score >= 62) {
    evidence =
      "solid eye area — " + lidPhrase + ", " + tiltPhrase +
      ", with " + weakest2.name + " the weakest part at " + weakest2.v.toFixed(0) +
      "/100";
  } else {
    evidence =
      "eye area limited by " + weakest2.name + " at " + weakest2.v.toFixed(0) +
      "/100 — " + lidPhrase + " and " + tiltPhrase;
  }

  return {
    score,
    label,
    evidence,
    scoreParts: {
      canthal: canthalScore,
      projection: projectionScore,
      eyelid: eyelidScore,
      brow: browScore,
    },
    strongestPart: strongest.name,
    weakestPart: weakest2.name,
    upperLidExposure: lidExposure,
    upperLidExposureLabel: exposureLabel,
    scleralShow,
    // The raw aperture (eye opening as a fraction of eye width) and its clamped
    // scleral fraction, surfaced so the reading can be checked against real
    // numbers while tuning (tools/probeEyeArea.mjs).
    eyeAperture: aperture,
    // The aperture method is the active one (see the note above the calculation).
    // `irisAvailable` reports whether the 10 iris points were present, so the UI
    // can say the capture included iris tracking -- but an iris-ANCHORED reading
    // was proven impossible on this mesh (tools/probeIris.mjs), so the iris points
    // are NOT a scoring input and the source string says what actually is used.
    scleralSource: "aperture",
    irisAvailable: hasIrisPoints(landmarks),
    browEyeRatio,
    intercanthalRatio,
    projectionLabel,
    // Where the projection label came from. "frontal" means it is the lid-coverage
    // ESTIMATE (the only thing a front photo can see); combineAnalysis upgrades
    // this to "profile" when a side photo supplies the real measurement.
    projectionSource: "frontal",
    lidSource,
    requirementCap,
    weights: EYE_AREA_WEIGHTS,
  };
}

// Reads one blend-shape confidence by name. Returns null (not 0) when the model
// didn't return blendshapes, so "not measured" never reads as "fully hooded".
function readBlendshape(blendshapes, name) {
  if (!blendshapes || !blendshapes.length) return null;
  const hit = blendshapes.find((b) => b.categoryName === name);
  return hit ? hit.score : null;
}

function avgPresent(a, b) {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return (a + b) / 2;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// Canthal tilt 0-100. Positive tilt is the conventionally attractive direction
// (+2 to +6 is the sweet spot); a strong negative tilt is the one eye reading
// almost every eye-area framework treats as a real downgrade, so it falls off
// steeply. Reused by the composite so the two can't disagree.
function canthalTiltComponentScore(degrees) {
  // Canthal tilt is one of the few eye-area readings the community treats as a
  // genuine ORDERING rather than a pass/fail: a mildly POSITIVE tilt (outer corner
  // a few degrees above the inner) is the prized "upturned / hunter" eye, neutral
  // is fine, and a clearly negative (downturned) tilt is the one real downgrade.
  //
  // The previous version returned a flat 100 for the WHOLE -2..+6 range, which is
  // why every face -- supermodel or not -- scored 100 here and the canthal part
  // never separated anyone (measured: adriana +3.8 and FatGuy -1.9 both read 100).
  // It now grades that range: neutral (~0) sits at NEUTRAL_MAX, a modest positive
  // tilt climbs to full marks, and anything past over-upturned eases back. The
  // calibration offset (CANTHAL_TILT_MESH_BIAS) is already removed upstream, so a
  // genuinely neutral eye reads ~0 here and earns NEUTRAL_MAX, not a penalty.
  const NEUTRAL_MAX = 80;   // a neutral eye is fine but is not the upturned ideal
  const POSITIVE_IDEAL = 4; // +4 deg is the sweet spot (+2..+7 both strong)
  if (degrees >= 2) {
    // Rise from NEUTRAL_MAX at +2 toward 100 at the +4..+7 plateau, then ease off
    // for a dramatically over-upturned eye.
    const rise = Math.min(degrees - 2, 2) / 2;           // 0..1 over +2..+4
    const plateau = 1 - Math.max(0, degrees - 7) / 8;    // eases after +7
    return clamp100((NEUTRAL_MAX + rise * (100 - NEUTRAL_MAX)) * plateau);
  }
  if (degrees >= -2) {
    // Neutral band: 0 is the top of it, falling gently toward its lower edge so
    // the move into a downturned eye is continuous rather than a cliff.
    const t = (degrees + 2) / 2; // 0 at -2, 1 at 0
    return clamp100(NEUTRAL_MAX * (0.9 + t * 0.1));
  }
  // Downturned: the real downgrade, falling off from the edge of the neutral band.
  return clamp100(NEUTRAL_MAX * 0.9 - (Math.abs(degrees) - 2) * 6);
}

// --- soft tissue (body fat) -------------------------------------------------
//
// This is the piece that was genuinely missing, and it is the reason a visibly
// heavy face kept landing in "high tier". Every other metric here measures BONE
// geometry; body fat is SOFT TISSUE, and MediaPipe's 468 landmarks are pinned to
// bone and feature creases -- none of them move when someone gains weight. So a
// round-faced heavy subject can have the bone ratios of a model and score
// "Lean", which is exactly what happened (the plus-size test photo scored
// faceFat 73 = "lean" while its face was round, jawless and creased).
//
// Fat on the face shows up in the PIXELS, not the skeleton. A lean lower face
// tapers: from the jaw corner the silhouette runs down-and-IN to a relatively
// narrow chin, and the chin landmark sits clearly BELOW the jaw corners. As soft
// tissue builds up, the flesh fills the taper and the chin saddle flattens:
// the silhouette under the jaw corners runs outward/downward instead of inward,
// and the chin sits almost level with the corners.
//
// So the reading is: trace the actual skin silhouette between the two jaw
// corners on both sides, and compare the wides part of that band against the
// width the bone landmarks predict. Fill = measured width / predicted width.
// 1.0 means the flesh follows the bone (lean); >1 means the flesh pushes out
// past the bone (full). This is a ratio against the subject's OWN bone scale, so
// it survives image size, and it is what the landmark geometry cannot see.
//
// Returns { score, chinFill, cheekBulge, measured }: score 0-100, 100 = lean.
// `measured` is false when the pixels couldn't be read (tainted canvas, almost
// no skin) and the caller should trust the geometry alone rather than a fake
// number.
const SOFT_SCAN_ROWS = 14; // silhouette rows sampled between jaw corner and chin
const SOFT_MIN_ROWS = 6;

// Plausibility ceiling for a single silhouette row. `actual` is how far the
// skin-colored pixels reach out from the face centre on that row; `predicted`
// is the bone taper the jaw landmarks imply. On a genuinely full face the flesh
// pushes only slightly past the bone, so the ratio stays around 1.0-1.35. A row
// whose ratio blows past this is NOT measuring face fill at all -- the outward
// walk has escaped off the face into skin-colored neck, shoulders, arms or
// background, which is exactly what a dark-haired model photo did (Doutzen: a
// lower row walked out through the neck to 2.3x the jaw half-width and drove
// chinFill to 1.32, slamming faceFat to a fake 0% "Round" on a clearly lean
// face). Such rows are discarded rather than counted as extreme fullness.
const SOFT_ROW_MAX_RATIO = 1.4;

// Fraction of a short horizontal strip that is skin-colored, plus its mean
// luminance. Used to find where the face ends horizontally.
function scanRowSkin(ctx, cx, y, halfWidth, cw, ch) {
  const x0 = Math.max(0, Math.round(cx - halfWidth));
  const x1 = Math.min(cw, Math.round(cx + halfWidth));
  const yy = Math.max(0, Math.round(y));
  if (x1 - x0 < 4 || yy >= ch || yy < 0) return null;

  const { data } = ctx.getImageData(x0, yy, x1 - x0, 1);
  let skin = 0;
  let lum = 0;
  const total = x1 - x0;
  for (let i = 0; i < total; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (isSkinPixel(r, g, b)) {
      skin++;
      lum += 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return { skinFraction: skin / total, meanLum: skin ? lum / skin : 0 };
}

// Walks outward from the face centre along one row and returns the skin-edge
// distance in pixels, or null if the row is not skin at the centre (i.e. we've
// walked off the face already). `reach` bounds how far out we look.
function silhouetteHalfWidth(ctx, cx, y, reach, cw, ch) {
  const mid = scanRowSkin(ctx, cx, y, Math.max(2, reach * 0.05), cw, ch);
  if (!mid || mid.skinFraction < 0.5) return null;
  const steps = 30;
  const step = reach / steps;
  let widest = 0;
  for (let dir = -1; dir <= 1; dir += 2) {
    let last = 0;
    for (let k = 1; k <= steps; k++) {
      const x = cx + dir * k * step;
      const row = scanRowSkin(ctx, x, y, Math.max(1.5, step * 0.45), cw, ch);
      if (!row || row.skinFraction < 0.5) break;
      last = k * step;
    }
    widest = Math.max(widest, last);
  }
  return widest;
}

function computeSoftTissue(imgEl, landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const iod = dist(px(SCALE_LEFT), px(SCALE_RIGHT)); // interocular distance = bone scale
  const jawL = px(JAW_LEFT), jawR = px(JAW_RIGHT);
  const chin = px(MIDLINE_BOTTOM);
  const jawCentX = (jawL.x + jawR.x) / 2;
  const jawWidth = dist(jawL, jawR);
  if (!iod || !jawWidth) return { score: 60, chinFill: 0, cheekBulge: 0, measured: false };

  const longEdge = Math.max(w, h);
  const downscale = longEdge > SKIN_MAX_DIM ? SKIN_MAX_DIM / longEdge : 1;
  const cw = Math.max(1, Math.round(w * downscale));
  const ch = Math.max(1, Math.round(h * downscale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, cw, ch);

  const s = downscale;
  const chinX = chin.x * s, chinY = chin.y * s;
  const jawHalf = (jawWidth / 2) * s;
  const jawCentXs = jawCentX * s;
  const jawY = ((jawL.y + jawR.y) / 2) * s;
  const reach = jawHalf * 1.8;

  // Sample the silhouette along the whole lower-face band, from just above the
  // jaw corners down to the chin. Compare the widest silhouette the skin
  // actually reaches against the half-width the jaw bone predicts at that same
  // height.
  let measured = 0;
  let widestRatio = 0;
  const rowDebug = [];
  try {
    for (let i = 0; i <= SOFT_SCAN_ROWS; i++) {
      const t = i / SOFT_SCAN_ROWS;
      const y = jawY + (chinY - jawY) * t;
      // Predicted half-width from the jaw corners down to the chin: the bone
      // taper. A lean face reaches its narrowest at the chin.
      const predicted = jawHalf * (1 - t * 0.45);
      const actual = silhouetteHalfWidth(ctx, jawCentXs, y, reach, cw, ch);
      const ratio = actual === null ? null : actual / predicted;
      // Discard rows the walk escaped off the face on (see SOFT_ROW_MAX_RATIO).
      const escaped = ratio !== null && ratio > SOFT_ROW_MAX_RATIO;
      rowDebug.push({
        t: +t.toFixed(2),
        actual: actual === null ? null : +actual.toFixed(1),
        predicted: +(predicted / s).toFixed(1),
        ratio: ratio === null ? null : +ratio.toFixed(3),
        escaped,
      });
      if (actual === null || actual < 2 || escaped) continue;
      measured++;
      widestRatio = Math.max(widestRatio, ratio);
    }
  } catch {
    return { score: 60, chinFill: 0, cheekBulge: 0, measured: false };
  }

  if (measured < SOFT_MIN_ROWS) {
    return { score: 60, chinFill: 0, cheekBulge: 0, measured: false };
  }

  // Silhouette fill = how far past the bone taper the flesh reaches. 1.0 = the
  // skin edge sits exactly on the predicted bone line (lean); higher = the
  // flesh spills outside it (full).
  const chinFill = Math.max(0, widestRatio - 1);
  // Slope of the V-neck: a lean jaw runs in steeply toward the chin, so the
  // lower rows are much narrower than the jaw corners. A full jaw keeps its
  // width down to the chin, so the ratio actual/actual-at-top stays near 1.
  const taperSlope = widestRatio > 0 ? Math.min(1, chinFill / 0.35) : 0;

  const score = clamp100(100 - chinFill * 320 - taperSlope * 30);

  console.debug("[softTissue]", {
    rowsMeasured: measured,
    widestRatio: widestRatio.toFixed(3),
    chinFill: chinFill.toFixed(3),
    score: score.toFixed(1),
  });
  if (typeof window !== "undefined") {
    (window.__softDebug = window.__softDebug || []).push({ rowDebug, widestRatio, jawHalf: jawHalf / s });
  }

  return { score, chinFill, cheekBulge: 0, measured: true, rowDebug };
}

// --- face fat ---------------------------------------------------------------
//
// Fullness / roundness of the face, blending BONE structure with the SOFT-TISSUE
// reading above. This is the metric whose absence let a round, full face score
// "stacy lite"/"chad lite" in testing: roundness is mirror-symmetric and only
// mildly off the length ratio, so the old symmetry/golden pair couldn't see it.
//
// Earlier versions used only three bone proxies (length/width, jaw/cheek, chin
// angle) and were blind to body fat for the reason spelled out above
// computeSoftTissue. They still matter -- they catch the bony part of a wide
// face -- so they are kept, but the overall reading is now the WEAKER of the two
// halves: a face is only as lean as its least lean signal says.
//
// Returns { label, score } where score is 0-100 (100 = lean/defined).
function computeFaceFat(imgEl, landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const faceLength = dist(px(MIDLINE_TOP), px(MIDLINE_BOTTOM));
  const cheekWidth = dist(px(CHEEK_LEFT), px(CHEEK_RIGHT));
  const jawWidth = dist(px(JAW_LEFT), px(JAW_RIGHT));
  if (!cheekWidth || !faceLength) return { label: "Unknown", score: 60 };

  const lengthToWidth = faceLength / cheekWidth;
  const jawToCheek = jawWidth / cheekWidth;
  // Chin angle: a full/round face has a soft, obtuse chin corner (the jaw runs
  // almost straight into the chin); a lean face has a crisper, sharper chin.
  // Measured on the test set: lean model faces sit at ~82-89 deg, fuller faces
  // at ~98-103 deg, so it's a clean fullness signal the width ratios miss.
  const chinAngle = angleDeg(px(JAW_LEFT), px(MIDLINE_BOTTOM), px(JAW_RIGHT));

  // "Lean" reference: length/width ~1.27+, a jaw about as wide as the cheeks or
  // narrower (~1.04), and a crisp chin (~89 deg). Roundness penalties kick in
  // past each of those (see the tuned constants above computeFaceFat).
  // Each width signal only deducts in proportion to how much the OTHER one
  // agrees that the face is full. Why: on a real photo either landmark pair can
  // be occluded -- a BEARD swallows the jaw corners (132/361), so jaw/cheek reads
  // like a full lower face on a lean man while length/width stays clean. With the
  // plain additive form that single bad pair dumped the score into the 20s (a
  // genuinely lean beard photo was labelled "Round") and cost it 5-8 points of
  // overall on its own, near enough to move a whole tier.
  //
  // So a short face only counts as full if the jaw is also wide, and a wide jaw
  // only counts if the face is also short. A face where BOTH read full (a
  // genuinely round face) still takes the near-full deduction, so the roundness
  // signal is not weakened -- only the lone-pair false positive is.
  //
  // The full deduction is deliberately the ORIGINAL calibration: measured on real detections
  // against test_photos, it dials from ~93 (a model, zero penalty) down to ~11 on
  // the fuller subjects without slamming anyone to 0, which is the spread a
  // "lean / average / full / round" reading needs.
  const shortFall = Math.max(0, LEAN_LENGTH_TO_WIDTH - lengthToWidth);
  const wideJaw = Math.max(0, jawToCheek - LEAN_JAW_TO_CHEEK);
  const lengthRef = Math.max(0, lengthToWidth - 1.05);
  const jawRef = Math.max(0, 1.16 - jawToCheek);

  const halfLength = FACE_FAT_LENGTH_MULT * shortFall;
  const halfJaw = FACE_FAT_JAW_MULT * wideJaw;
  let roundPenalty = 0;
  roundPenalty += halfLength * Math.min(1, jawRef / 0.12);
  roundPenalty += halfJaw * Math.min(1, lengthRef / 0.22);
  if (chinAngle > LEAN_CHIN_ANGLE) roundPenalty += (chinAngle - LEAN_CHIN_ANGLE) * FACE_FAT_CHIN_MULT;

  const boneScore = clamp100(Math.max(FACE_FAT_FLOOR, 100 - roundPenalty));

  // The soft-tissue (pixel silhouette) reading is still computed, because the dev
  // harness shows it and it may be recalibrated later, but it is NOT folded into
  // the score any more. A ratio probe of every test photo showed the silhouette
  // measurement is not a fullness signal at all -- it is dominated by photo
  // composition (how far skin-colored pixels extend on the sampled rows), to the
  // point of being INVERTED: the fullest face in the set (the plus-size photo)
  // measured the LOWEST fill (ratio 1.05) while lean supermodels measured HIGHER
  // (sean_opry 1.31, adriana 1.24). Feeding that into `min(boneScore, soft.score)`
  // is what produced the reported bug -- every lean/model face collapsed to a
  // fake 0% "Round" because the noisy soft score was the minimum. The bone
  // geometry (length/width, jaw/cheek, chin angle) is the reading that actually
  // tracks fullness on the test set (lean models 83-97, fuller subjects 45-64),
  // so the face-fat score is now that bone reading. Soft tissue is reported
  // alongside it for transparency, not blended.
  const soft = imgEl ? computeSoftTissue(imgEl, landmarks, w, h) : { score: 60, measured: false };
  const score = boneScore;
  // Surfaced on the analysis result so the dev check harness (tools/scoringCheck)
  // can show the raw soft-tissue numbers next to the score -- without it the
  // reading is a black box and can't be calibrated against real photos.
  const softTissue = {
    score: soft.score,
    chinFill: soft.chinFill || 0,
    cheekBulge: soft.cheekBulge || 0,
    measured: soft.measured,
    // Raw per-row silhouette readings (see computeSoftTissue). Kept on the
    // result so tools/scoringCheck + the overlay can show WHY a row was taken
    // or discarded, instead of the blend being a black box.
    rowDebug: soft.rowDebug,
  };
  // Boundaries set from real detections on test_photos: the leanest faces there
  // (adriana_lima 83-87, chico_frontal 97, sean_opry 93) are "Lean", jordan
  // barrett (63, a fuller but not round face) is "Average", and the fuller
  // subjects fall into "Full". "Round" is reserved for a face that is both
  // short AND wide at the jaw, not merely soft.
  let label;
  if (score >= 78) label = "Lean";
  else if (score >= 58) label = "Average";
  else if (score >= 38) label = "Full";
  else label = "Round";

  // Evidence: name the measurement that explains the reading. The two width
  // ratios are printed as plain-language values ("1.18" etc.) so the user can see
  // which direction the face is leaning instead of trusting a label.
  const evidence =
    score >= 78
      ? "lean lower face — length-to-width " + lengthToWidth.toFixed(2) +
        " and a jaw taper of " + jawToCheek.toFixed(2)
      : score >= 58
        ? "average fullness — jaw/cheek ratio " + jawToCheek.toFixed(2) +
          " with a chin angle of " + chinAngle.toFixed(0) + "\u00B0"
        : score >= 38
          ? "fuller lower face — a chin angle of " + chinAngle.toFixed(0) +
            "\u00B0 means the jaw runs into the chin without tapering"
          : "round face — length-to-width only " + lengthToWidth.toFixed(2) +
            " (lean faces sit near 1.30)";

  console.debug("[faceFat]", {
    lengthToWidth: lengthToWidth.toFixed(3),
    jawToCheek: jawToCheek.toFixed(3),
    chinAngle: chinAngle.toFixed(1),
    boneScore: boneScore.toFixed(1),
    softScore: soft.measured ? soft.score.toFixed(1) : "n/a",
    softMeasured: soft.measured,
    label,
    evidence,
    score: score.toFixed(1),
  });

  return {
    label,
    score,
    evidence,
    boneScore,
    softTissue,
    metrics: { lengthToWidth, jawToCheek, chinAngle },
  };
}

// --- jawline ----------------------------------------------------------------
//
// How defined / angular the jawline is. Uses the gonial (jaw angle) taper:
//   - jaw / cheek width: a defined jaw tapers in from the cheekbones; a soft
//     jaw stays as wide as the cheeks (or wider).
//   - gonial drop: how far the jaw angle sits below the mouth line -- a low,
//     sharp gonial angle reads as a defined jawline.
// Returns { label, score } (100 = very defined).
function computeJawline(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const cheekWidth = dist(px(CHEEK_LEFT), px(CHEEK_RIGHT));
  const jawWidth = dist(px(JAW_LEFT), px(JAW_RIGHT));
  const faceLength = dist(px(MIDLINE_TOP), px(MIDLINE_BOTTOM));
  if (!cheekWidth || !faceLength) return { label: "Unknown", score: 60 };

  const jawToCheek = jawWidth / cheekWidth;

  // Gonion angle: the corner at the jaw angle between the line down from the
  // cheekbone and the line to the chin. A well-defined jaw forms a distinct,
  // narrower corner; a soft/full jaw runs almost straight or bows outward.
  // Measured on the test set this is the cleanest single jaw signal there is:
  // models sit at ~130-133 deg, soft/round faces at ~117-124 deg, no overlap.
  // (An earlier attempt used the jaw-angle's VERTICAL drop below the mouth;
  // that read negative for every photo -- the landmark sits above the mouth
  // line -- so it fired a penalty on everyone.)
  const gonionDeg = (angleDeg(px(CHEEK_LEFT), px(JAW_LEFT), px(MIDLINE_BOTTOM)) +
    angleDeg(px(CHEEK_RIGHT), px(JAW_RIGHT), px(MIDLINE_BOTTOM))) / 2;

  // Chin angle: a crisp chin corner (lean) vs a soft, obtuse one (full).
  const chinAngle = angleDeg(px(JAW_LEFT), px(MIDLINE_BOTTOM), px(JAW_RIGHT));

  let score = 100;
  // Sharp, defined jaw corner is ~130 deg; penalise a softer (narrower) corner.
  if (gonionDeg < 130) score -= (130 - gonionDeg) * 2.2;
  // Crisp chin ~88 deg; a softer/rounder chin (>90) costs, an over-pointed one
  // (<80) is a mild nudge.
  if (chinAngle > 90) score -= (chinAngle - 90) * 1.4;
  else if (chinAngle < 80) score -= (80 - chinAngle) * 0.8;
  // A jaw much wider than the cheekbones is a soft, full lower face.
  if (jawToCheek > 1.08) score -= (jawToCheek - 1.08) * 150;

  score = clamp100(score);
  let label;
  if (score >= 80) label = "Strong";
  else if (score >= 62) label = "Defined";
  else if (score >= 45) label = "Soft";
  else label = "Weak";

  // Evidence line: the ONE measurement that most explains this score, in plain
  // language. Reported next to the number so the reading is auditable rather than
  // a bare grade -- see the evidence builders below the jawline for the pattern.
  let evidence;
  if (score >= 80) {
    evidence =
      jawToCheek >= 1.0
        ? "strong mandibular width — jaw holds its span from the cheekbones down"
        : "sharp gonial angle at " + gonionDeg.toFixed(0) + "\u00B0 with a tapered jaw";
  } else if (score >= 62) {
    evidence =
      "defined jaw corner at " + gonionDeg.toFixed(0) + "\u00B0 (sharp model band is ~130\u00B0)";
  } else if (score >= 45) {
    evidence =
      "soft jaw angle at " + gonionDeg.toFixed(0) + "\u00B0 — the jaw runs wide instead of tapering";
  } else {
    evidence =
      "weak jaw definition — gonial angle " + gonionDeg.toFixed(0) +
      "\u00B0 with a jaw/cheek ratio of " + jawToCheek.toFixed(2);
  }

  console.debug("[jawline]", {
    gonionDeg: gonionDeg.toFixed(1),
    chinAngle: chinAngle.toFixed(1),
    jawToCheek: jawToCheek.toFixed(3),
    label,
    evidence,
    score: score.toFixed(1),
  });

  return {
    label,
    score,
    evidence,
    metrics: { gonionDeg, chinAngle, jawToCheek },
  };
}

// Heuristic "skin quality" score from cheek tonal evenness -- lower local
// variance (fewer blemishes/blotches) scores higher. This is a rough
// on-device proxy, not a dermatological analysis.
//
// This went through two revisions before landing here, each fixing a
// specific failure mode confirmed by testing against real photos:
//
// v1 sampled the forehead -- broke on any hairstyle with bangs/fringe,
// since hair pixels mixed with skin pixels blow up the variance.
// v2 moved to the cheeks and downsampled to a fixed grid -- better, but
// still broke on photos with strong directional/studio lighting (one side
// of the cheek brighter than the other) and on hair that drapes across
// the sides of the face (common in tousled/windswept photography), both
// of which still read as "high variance" even though the skin itself is
// fine.
//
// v3 (this version) fixes both remaining issues:
// 1. Skin-color filtering: each pixel is tested against a standard
//    RGB skin-tone rule before being counted, so hair, shadow, and
//    background pixels are excluded rather than averaged in.
// 2. Variance is measured WITHIN small local cells and then averaged,
//    not across the whole patch. A broad lighting gradient shows up as a
//    difference in brightness BETWEEN cells, not within one -- measuring
//    only within-cell spread captures real local texture (blemishes,
//    pores) while ignoring that gradient.
const SKIN_GRID = 8; // cells per cheek patch, each direction
const MIN_CELL_SKIN_FRACTION = 0.4; // a cell needs this much skin-colored coverage to count
const MIN_VALID_CELLS = 6; // below this, there's too little clean skin to trust a score

// Is this IMAGE effectively greyscale (a black-and-white portrait)?
//
// This matters because every pixel-based reading gates on isSkinPixel(), which is
// fundamentally a COLOUR test: on a greyscale photo R, G and B are equal for
// every pixel, so no colour rule can ever pass and the readings all give up with
// "Unknown". That is exactly what happened on the Simon Nessman test photo, which
// is a black-and-white editorial shot -- skin clarity reported "Unknown" and skin
// quality fell back to the neutral 75, not because the skin was unreadable but
// because the image had no colour at all.
//
// Measured on a sparse sample of the frame: an image is treated as greyscale when
// the mean channel spread (maxc - minc) is under 8. A colour photo of skin sits
// far above that (typically 20-60), so there is a wide, unambiguous gap.
function isGreyscaleImage(ctx, cw, ch) {
  try {
    const { data } = ctx.getImageData(0, 0, cw, ch);
    let sum = 0;
    let n = 0;
    // Sample every 37th pixel: enough to characterise the image, cheap enough to
    // stay well under a millisecond on a 2000px frame.
    for (let i = 0; i < data.length; i += 4 * 37) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      sum += Math.max(r, g, b) - Math.min(r, g, b);
      n++;
    }
    if (!n) return false;
    return sum / n < 8;
  } catch {
    return false; // unreadable canvas -- assume colour and let the normal path run
  }
}

// Texture-only skin test, for greyscale photos. Without colour there is no way to
// separate skin from hair or background by hue, but the READINGS that matter here
// (local luminance variance, local contrast) are luminance-only anyway -- they
// work on a greyscale image exactly as well as on a colour one. So on a B&W photo
// the skin test is relaxed to "mid-tone and not a hard edge", which keeps the
// cheek patch and drops the extremes (deep shadow, blown highlight) that would
// distort a texture measurement.
function isSkinPixelGreyscale(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 35 && lum < 240;
}

// Skin-tone test, used to keep hair / background / specular highlights out of
// every pixel-based reading (skin quality, acne, soft tissue, lighting).
//
// The original implementation was the classic RGB "Kovac rule" -- r > 95, g > 40,
// b > 20, red-dominant with a minimum saturation. It works on light skin and
// fails on darker or olive skin: the fixed `r > 95` floor and the `|r-g| > 15`
// gap are both tuned to a bright, strongly-red complexion. On the test set that
// showed up as skin clarity reading **"Unknown"** for Simon Nessman -- a
// diagnostic found 0 of 11,858 patch pixels passing the test, so the whole
// cheek area was treated as non-skin and the reading gave up. That is a skin-tone
// bias, not a property of the photo, so the rule is now two-branch:
//
//   1. A relaxed RGB branch that still catches light/medium skin.
//   2. A HUE branch that is brightness-independent. In HSV terms, skin sits in a
//      narrow orange band (hue ~0-50 deg) at low-to-moderate saturation for every
//      complexion; hair and clothing are usually far outside it. Working from hue
//      rather than absolute channel values is what makes this inclusive of dark
//      skin under the same lighting.
//
// A clamped minimum brightness still excludes near-black (hair in shadow, dark
// background) while sitting far below the old 95 floor.
function isSkinPixel(r, g, b, greyscale) {
  // On a greyscale photo no colour rule can work -- fall through to the
  // luminance-only test (see isSkinPixelGreyscale).
  if (greyscale) return isSkinPixelGreyscale(r, g, b);
  // Never treat near-black or blown-out pixels as skin: the first is hair/shadow,
  // the second has lost its colour entirely (a specular highlight on the nose).
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  if (maxc < 30 || maxc - minc < 8) return false;

  // Branch 1: the relaxed classic rule (light/medium skin, normal lighting).
  const rgbRule = r > 60 && g > 30 && b > 15 && r >= g && g >= b && r - b > 10;

  // Branch 2: hue-based. Convert to HSV hue and accept the skin hue band.
  const d = maxc - minc;
  let h;
  if (maxc === r) h = ((g - b) / d) % 6;
  else if (maxc === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  const sat = d / maxc; // 0-1
  // Skin hue band, widened a little for cooler light; saturation capped so a
  // saturated red/orange object can't pass, and floored so grey/near-neutral
  // pixels (background walls, monochrome clothing) are rejected.
  const hueRule = h >= 0 && h <= 50 && sat >= 0.08 && sat <= 0.75;

  return rgbRule || hueRule;
}

// Returns the within-cell luminance stdDev for each cell of an 8x8 grid
// over the patch, counting only skin-colored pixels, and skipping any
// cell that doesn't have enough skin-colored coverage (e.g. a cell that's
// mostly hair).
function sampleCheekLocalStdDevs(ctx, cx, cy, half, w, h, greyscale) {
  const x = Math.max(0, Math.round(cx - half));
  const y = Math.max(0, Math.round(cy - half));
  const pw = Math.min(w - x, Math.round(half * 2));
  const ph = Math.min(h - y, Math.round(half * 2));
  if (pw < 16 || ph < 16) return [];

  const { data } = ctx.getImageData(x, y, pw, ph);
  const cellW = pw / SKIN_GRID;
  const cellH = ph / SKIN_GRID;
  const buckets = Array.from({ length: SKIN_GRID * SKIN_GRID }, () => []);

  for (let py = 0; py < ph; py++) {
    for (let pxi = 0; pxi < pw; pxi++) {
      const idx = (py * pw + pxi) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (!isSkinPixel(r, g, b, greyscale)) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const cellX = Math.min(SKIN_GRID - 1, Math.floor(pxi / cellW));
      const cellY = Math.min(SKIN_GRID - 1, Math.floor(py / cellH));
      buckets[cellY * SKIN_GRID + cellX].push(lum);
    }
  }

  const localStdDevs = [];
  const minPerCell = Math.max(6, cellW * cellH * MIN_CELL_SKIN_FRACTION);
  for (const vals of buckets) {
    if (vals.length < minPerCell) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    localStdDevs.push(Math.sqrt(variance));
  }
  return localStdDevs;
}

function computeSkinQuality(imgEl, landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const scale = dist(px(SCALE_LEFT), px(SCALE_RIGHT)); // interocular distance
  // Downscale large photos: the patch being measured is a fixed fraction of
  // the interocular distance, so a 4000px source gains no accuracy here but
  // costs a lot of memory and time to push through a canvas. Everything below
  // is expressed in the downscaled canvas's coordinate space (cw/ch), so the
  // landmark pixel positions and the patch size are scaled to match.
  const longEdge = Math.max(w, h);
  const downscale = longEdge > SKIN_MAX_DIM ? SKIN_MAX_DIM / longEdge : 1;
  const cw = Math.max(1, Math.round(w * downscale));
  const ch = Math.max(1, Math.round(h * downscale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, cw, ch);

  // Cheek patch placement. The old patch was centred on landmarks 50/280 and
  // sized at 0.32 x interocular distance. Those landmarks sit at the
  // nasolabial fold, right beside the nose and mouth, so a patch that large
  // straddled nose shadow, mouth corners and the jaw/hair edge. Even with the
  // skin-color filter, the leftover feature edges produced cell stdDevs of
  // 20-40 in a handful of cells, which dragged the MEAN up to ~9-11 on
  // flawless model skin (Adriana/Jordan scored 50-53).
  //
  // 205/425 are the cheekbone area below the outer eye corner -- clean, flat
  // skin with no feature inside the patch -- and 0.18 x IOD keeps the patch
  // clear of the nose and mouth. Measured on the test set this drops model
  // avgLocalStdDev from ~9-11 to ~3-6 (smooth) while the genuinely more
  // textured older face stays highest, i.e. it now measures skin texture
  // instead of feature edges.
  const half = scale * downscale * 0.18;
  const cheekCenters = [
    { x: px(205).x * downscale, y: px(205).y * downscale },
    { x: px(425).x * downscale, y: px(425).y * downscale },
  ];

  // A black-and-white photo has no colour for the skin test to key on, so the
  // texture reading is taken with the luminance-only skin test instead of being
  // abandoned as "unreadable" (see isGreyscaleImage).
  const greyscale = isGreyscaleImage(ctx, cw, ch);

  let allLocalStdDevs = [];
  try {
    for (const center of cheekCenters) {
      allLocalStdDevs = allLocalStdDevs.concat(
        sampleCheekLocalStdDevs(ctx, center.x, center.y, half, cw, ch, greyscale)
      );
    }
  } catch {
    return SKIN_FALLBACK_SCORE; // canvas tainted (cross-origin) -- skip heuristic
  }

  if (allLocalStdDevs.length < MIN_VALID_CELLS) {
    // Too little confidently skin-colored area found (heavy hair coverage,
    // unusual lighting/color cast, etc.) to trust a reading from -- a
    // guessed score from too little/contaminated data is worse than a
    // neutral default.
    console.debug("[skinQuality] not enough clean skin samples, using fallback score");
    return SKIN_FALLBACK_SCORE;
  }

  const avgLocalStdDev =
    allLocalStdDevs.reduce((a, b) => a + b, 0) / allLocalStdDevs.length;

  // Calibrated against the clean 205/425 cheek patch (see its placement above).
  // With the old nasolabial patch the avgLocalStdDev for smooth model skin ran
  // ~9-11, so the old free band (2.5) and slope (5.8) scored real models 50-53
  // -- a labelling problem, not a skin problem. The clean patch reads model
  // skin at ~3-6, so the free band moves to 3.0 and the slope to 6.0: smooth
  // skin lands high 80s-90s, a genuinely more textured face lands ~80, and
  // heavy blemishes still cost real points.
  // Free band 3.0 / slope 2.8. The band marks "clean skin"; the gentler slope
  // takes a clean but lightly textured model face (avgStd ~5-6.5, e.g. Adriana
  // on a makeup/studio frame) to ~90 while still costing genuinely rough skin.
  const SKIN_FREE_BAND = 3.0; // stdDev units that count as "clean skin"
  const skinExcess = Math.max(0, avgLocalStdDev - SKIN_FREE_BAND);
  let score = 100 - skinExcess * 2.8;

  // Blur guard. A soft/out-of-focus or low-resolution photo has less high-
  // frequency detail, so its cheek patch reads artificially SMOOTH -- a blurry
  // shot of an ordinary face was scoring a perfect 100 skin, which is the
  // opposite of the truth (we simply can't see the skin). When sharpness is
  // below the warn threshold, blend the reading toward the neutral fallback in
  // proportion to how blurry it is, capped at 40% so a slightly soft but clean
  // photo is still rewarded.
  const sharpness = computeImageSharpness(imgEl, w, h);
  if (sharpness !== null && sharpness < SHARPNESS_WARN_THRESHOLD) {
    const blurWeight = ((SHARPNESS_WARN_THRESHOLD - sharpness) / SHARPNESS_WARN_THRESHOLD) * 0.4;
    score = score * (1 - blurWeight) + SKIN_FALLBACK_SCORE * blurWeight;
  }

  console.debug("[skinQuality]", {
    validCells: allLocalStdDevs.length,
    avgLocalStdDev: avgLocalStdDev.toFixed(2),
    sharpness: sharpness === null ? null : Math.round(sharpness),
    score: clamp100(score).toFixed(1),
  });

  return clamp100(score);
}

// --- skin acne / blemishes --------------------------------------------------
//
// Separate from computeSkinQuality: that one measures overall tonal smoothness,
// this one specifically hunts for BLEMISHES -- acne, spots, inflamed redness --
// by looking for pixels that are locally darker or redder than the skin around
// them. Two readings over the same 205/425 cheek patches:
//   - hotspot fraction: share of skin pixels that are a dark or red outlier vs
//     the patch's own median (a blemish is a local dark/red spot).
//   - redness spread: how much the R-G channel difference varies across the
//     patch (inflammation shows up there even when luminance is even).
//
// Returns { label, score } (100 = clear).
function computeSkinAcne(imgEl, landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const scale = dist(px(SCALE_LEFT), px(SCALE_RIGHT));
  const longEdge = Math.max(w, h);
  const downscale = longEdge > SKIN_MAX_DIM ? SKIN_MAX_DIM / longEdge : 1;
  const cw = Math.max(1, Math.round(w * downscale));
  const ch = Math.max(1, Math.round(h * downscale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, cw, ch);

  const half = scale * downscale * 0.18;
  const centers = [
    { x: px(205).x * downscale, y: px(205).y * downscale },
    { x: px(425).x * downscale, y: px(425).y * downscale },
  ];

  // Black-and-white photos have no colour for the skin test, which is why this
  // reading used to return "Unknown" on a greyscale portrait. The blemish test
  // itself is luminance-based (local contrast), so it works fine once the pixel
  // filter stops requiring colour -- see isGreyscaleImage.
  const greyscale = isGreyscaleImage(ctx, cw, ch);

  // Blemish detection by LOCAL CONTRAST, not a whole-patch threshold. A simple
  // "darker than the patch median" rule flagged ~30% of pixels on flawless model
  // skin, because ordinary skin shading is smooth and large-scale -- it made
  // every face look "blemished" and actually ended up measuring image detail
  // (a blurry photo scored best). Instead each skin pixel is compared to the
  // local average of its 3x3 skin neighbours: a blemish is a COMPACT dark spot
  // relative to its immediate surroundings, while a shading gradient is not.
  let spotPixels = 0;
  let totalPixels = 0;
  try {
    for (const c of centers) {
      const x = Math.max(0, Math.round(c.x - half));
      const y = Math.max(0, Math.round(c.y - half));
      const pw = Math.min(cw - x, Math.round(half * 2));
      const ph = Math.min(ch - y, Math.round(half * 2));
      if (pw < 12 || ph < 12) continue;
      const { data } = ctx.getImageData(x, y, pw, ph);
      const lum = new Float64Array(pw * ph);
      const skin = new Uint8Array(pw * ph);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        skin[j] = isSkinPixel(r, g, b, greyscale) ? 1 : 0;
        lum[j] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
      for (let py = 1; py < ph - 1; py++) {
        for (let pxi = 1; pxi < pw - 1; pxi++) {
          const j = py * pw + pxi;
          if (!skin[j]) continue;
          totalPixels++;
          let sum = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const k = (py + dy) * pw + (pxi + dx);
              if (skin[k]) { sum += lum[k]; n++; }
            }
          }
          const localAvg = sum / (n || 1);
          if (lum[j] < localAvg - 16) spotPixels++; // compact dark spot
        }
      }
    }
  } catch {
    // Tainted canvas (cross-origin) -- nothing readable at all.
    return { label: "Not measurable", score: SKIN_FALLBACK_SCORE, measured: false };
  }

  // Not enough analysable skin to judge clarity. The label says WHY so the UI can
  // distinguish "the photo gave us nothing to read" from a real low score.
  if (totalPixels < 60) {
    return { label: "Not measurable", score: SKIN_FALLBACK_SCORE, measured: false };
  }

  const spotFrac = spotPixels / totalPixels;

  // Calibrated on the test set: clean model skin reads spotFrac ~0-0.01, so a
  // small free band (0.01) keeps clear skin at ~100 while a genuinely broken-out
  // patch (spotFrac ~0.05+) falls into the 30s-40s.
  const score = clamp100(100 - Math.max(0, spotFrac - 0.01) * 1500);

  let label;
  if (score >= 88) label = "Clear";
  else if (score >= 70) label = "Minor";
  else if (score >= 50) label = "Moderate";
  else label = "Blemished";

  console.debug("[skinAcne]", {
    spotFrac: spotFrac.toFixed(4),
    greyscale,
    label,
    score: score.toFixed(1),
  });

  return { label, score, measured: true, greyscale };
}

// Rough sharpness check on the face region, using the variance of a Laplacian
// (a standard, cheap focus measure). Soft/blurry photos give MediaPipe noisier
// landmarks, so the scores below wobble. This doesn't try to correct that --
// it just reports it, so the UI can tell the user *why* a result may look off
// instead of leaving them guessing. Returns null if it can't be measured.
function computeImageSharpness(imgEl, w, h) {
  try {
    const longEdge = Math.max(w, h);
    const scale = longEdge > 600 ? 600 / longEdge : 1;
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, cw, ch);
    const { data } = ctx.getImageData(0, 0, cw, ch);

    const gray = new Float64Array(cw * ch);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // 4-neighbour Laplacian, then its variance.
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        const i = y * cw + x;
        const lap =
          4 * gray[i] -
          gray[i - 1] - gray[i + 1] - gray[i - cw] - gray[i + cw];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }
    if (n === 0) return null;
    const mean = sum / n;
    return sumSq / n - mean * mean;
  } catch {
    return null; // cross-origin canvas -- can't read pixels
  }
}

// Below this Laplacian-variance the photo reads as soft/blurry and landmark
// precision (and therefore the scores) is noticeably noisier. Tuned so sharp
// phone portraits (typically several hundred+) pass and visibly soft/upscaled
// or heavily-compressed shots fail.
const SHARPNESS_WARN_THRESHOLD = 100;

// --- input reliability: landmark confidence + lighting / focus --------------
//
// Three separate readings that all answer the same question the user actually
// has: "can I trust this number?". They are reported next to the score instead
// of being silently absorbed into it -- a bad photo should be told to retake,
// not quietly docked points for something the face is not responsible for.

// --- landmark confidence ----------------------------------------------------
//
// MediaPipe exposes no per-landmark confidence for the face mesh, so this is
// built from what we CAN read on-device. The dominant failure the user reported
// is a tilted head: on a strong yaw the mesh's left/right pairs slip, symmetry
// collapses, and the frontal scores become noise. So:
//   1. Head-pose penalty: a big |yaw| (and a big nose-drop, the pitch proxy) is
//      the main driver. A slight turn is fine; a near-profile is not.
//   2. Sharpness: soft/blurry photos genuinely give noisier landmarks (and are
//      already the reason SHARPNESS_WARN_THRESHOLD exists).
//   3. Face-size floor: if interocular distance is a tiny share of the frame the
//      face is too small/too far for the mesh to place points precisely.
//   4. Fallback: no face was ever detected, so nothing here is real.
const CONFIDENCE_WARN_THRESHOLD = 70;

function computeLandmarkConfidence(landmarks, w, h, sharpness, isFallback, isProfile, rotation) {
  if (isFallback || !landmarks) {
    return { score: 0, label: "Unreliable", flags: ["no-face"], reliable: false };
  }

  const px = (i) => toPixels(landmarks[i], w, h);
  const iod = dist(px(SCALE_LEFT), px(SCALE_RIGHT));

  // HEAD POSE: prefer the real 3D rotation from MediaPipe's facial transformation
  // matrix, and fall back to the geometric heuristics only when the model didn't
  // return one.
  //
  // `rotation` is the genuine measurement -- degrees of yaw/pitch/roll straight
  // off the matrix that maps the canonical face onto the detected head. The
  // heuristics below cannot match it: estimateYaw() infers a turn from how far the
  // nose sits from the cheek midpoint (so it reads ~0 for a head tipped back or
  // rolled), and pitchProxy() is a ratio that shifts with face shape. The matrix
  // sees all three axes at once.
  const hasRotation = !!rotation && Number.isFinite(rotation.yaw);
  const yaw = hasRotation ? rotation.yaw / 90 : estimateYaw(landmarks, w, h);
  const hasPitch = hasRotation && Number.isFinite(rotation.pitch);
  const rollDeg = hasRotation && Number.isFinite(rotation.roll) ? Math.abs(rotation.roll) : null;

  // Pitch proxy: how far the nose sits below the eye line, normalised by the
  // interocular distance. A neutral frontal pose lands ~0.55-0.75; a head tilted
  // up or down pushes it outside that band. Used only when no matrix is available.
  const eyeMidY = (px(33).y + px(263).y) / 2;
  const pitchProxy = iod ? (px(NOSE_TIP).y - eyeMidY) / iod : 0.65;

  const flags = [];
  let score = 100;

  // 1. Head pose.
  //
  // CRITICAL: a deliberate SIDE PROFILE must not be punished for being a profile.
  // The yaw/pitch penalties exist to catch an ACCIDENTALLY tilted front-facing
  // shot, where the frontal scores really are unreliable -- they were never meant
  // to fire on someone who turned their head on purpose. Previously a clean side
  // profile scored confidence 0 with the flags "tilted, pitch, blur" and the app
  // told the user to retake a perfectly good profile photo.
  //
  // On a profile the frontal metrics are substituted anyway (PROFILE_FALLBACK_SCORE)
  // and the side-profile panel carries the reading, so yaw/pitch are simply not
  // the right measure of reliability here: it is replaced by whether the profile
  // itself is decisive (a near-true profile gives clean side readings; an
  // ambiguous half-turn does not).
  if (isProfile) {
    // Confidence on a profile = how decisive the turn is. yaw ~0.18-0.35 is an
    // ambiguous 3/4 turn (the weakest case); yaw >= ~0.45 is a clean profile.
    // `yaw` is normalised to 0-1 in both paths (the matrix value is divided by 90
    // above), so this band holds whether or not the matrix was available.
    const decisive = Math.min(1, Math.max(0, (yaw - 0.2) / 0.28));
    score = 58 + decisive * 38; // 58 .. 96
    flags.push("profile");
    if (sharpness !== null && sharpness < SHARPNESS_WARN_THRESHOLD) {
      score -= ((SHARPNESS_WARN_THRESHOLD - sharpness) / SHARPNESS_WARN_THRESHOLD) * 20;
      flags.push("blur");
    }
    score = clamp100(score);
    const reliable = score >= CONFIDENCE_WARN_THRESHOLD;
    return {
      score,
      label: score >= 90 ? "High reliability" : reliable ? "Reliable" : "Low reliability",
      reliable,
      flags,
      yaw,
      pitchProxy,
      // Profile scans carry their own reliability note (see the UI), so the
      // "retake: too tilted" copy is suppressed for them.
      isProfile: true,
    };
  }

  const yawExcess = Math.max(0, yaw - 0.12);
  if (yawExcess > 0) score -= yawExcess * 150;
  if (yaw > 0.28) flags.push("tilted");

  // PITCH. With the matrix this is a direct angle in degrees (a head tipped back
  // 20 degrees reads 20, regardless of face shape). Without it, the old nose-drop
  // ratio is used with its calibrated neutral of 0.65.
  if (hasPitch) {
    const pitchExcessDeg = Math.max(0, Math.abs(rotation.pitch) - 8);
    if (pitchExcessDeg > 0) score -= pitchExcessDeg * 1.6;
    if (pitchExcessDeg > 6) flags.push("pitch");
  } else {
    const pitchExcess = Math.max(0, Math.abs(pitchProxy - 0.65) - 0.12);
    if (pitchExcess > 0) score -= pitchExcess * 120;
    if (pitchExcess > 0.1) flags.push("pitch");
  }

  // ROLL: a head tilted sideways. This was completely invisible to the previous
  // heuristics -- estimateYaw() and the pitch ratio both measure in the image
  // plane and cannot tell a rolled head from a straight one, yet roll distorts
  // every left/right reading. The matrix exposes it directly.
  if (rollDeg !== null) {
    const rollExcess = Math.max(0, rollDeg - 6);
    if (rollExcess > 0) score -= rollExcess * 1.4;
    if (rollExcess > 5) flags.push("roll");
  }

  // 2. Sharpness: soft photos give noisy landmarks. Only dock when we actually
  //    measured a sharpness ("null" means the canvas couldn't be read at all).
  if (typeof sharpness === "number" && sharpness < SHARPNESS_WARN_THRESHOLD) {
    score -= ((SHARPNESS_WARN_THRESHOLD - sharpness) / SHARPNESS_WARN_THRESHOLD) * 25;
    flags.push("blur");
  }

  // 3. Face-size floor: too small in frame to place 468 points precisely.
  const faceShare = iod / Math.max(1, Math.max(w, h));
  if (faceShare < 0.08) {
    score -= (0.08 - faceShare) * 400;
    flags.push("small-face");
  }

  score = clamp100(score);
  const reliable = score >= CONFIDENCE_WARN_THRESHOLD;
  const label = score >= 90 ? "High reliability" : reliable ? "Reliable" : "Low reliability";

  console.debug("[landmarkConfidence]", {
    poseSource: hasRotation ? "matrix(3D)" : "geometric heuristic",
    yaw: yaw.toFixed(3),
    pitchDeg: hasPitch ? rotation.pitch.toFixed(1) : null,
    rollDeg: rollDeg === null ? null : rollDeg.toFixed(1),
    pitchProxy: hasPitch ? null : pitchProxy.toFixed(3),
    faceShare: faceShare.toFixed(3),
    sharpness: sharpness === null ? null : Math.round(sharpness),
    flags,
    score: score.toFixed(1),
    label,
  });

  return {
    score,
    label,
    reliable,
    flags,
    yaw,
    // Which source produced the pose: the real 3D matrix or the geometric
    // fallback. Surfaced so the UI (and the dev logs) can tell them apart.
    poseSource: hasRotation ? "matrix" : "heuristic",
    pitchDeg: hasPitch ? rotation.pitch : null,
    rollDeg,
    pitchProxy: hasPitch ? null : pitchProxy,
    faceShare,
    isProfile: false,
  };
}

// --- lighting / exposure ----------------------------------------------------
//
// Mean luminance and clipping share over the face region, plus how much of the
// face is losing its shadow detail. Deliberately blunt: this is a "will the
// scores be trustworthy" gate, not a photography critique. A dark photo is the
// other classic cause of bad landmark precision, and it is trivially fixable by
// the user (better light, no backlight) -- so it is surfaced as a retake hint.
const LIGHTING_DARK_LUM = 60;      // mean luminance below this = poor
const LIGHTING_BRIGHT_LUM = 210;   // mean luminance above this = blown out
function computeLighting(imgEl, landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const iod = dist(px(SCALE_LEFT), px(SCALE_RIGHT));
  if (!iod) return { label: "Unknown", score: 60, measured: false };

  const longEdge = Math.max(w, h);
  const downscale = longEdge > SKIN_MAX_DIM ? SKIN_MAX_DIM / longEdge : 1;
  const cw = Math.max(1, Math.round(w * downscale));
  const ch = Math.max(1, Math.round(h * downscale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, cw, ch);

  // Sample the face itself (cheek patches), not the whole frame: a portrait on a
  // black background is correctly lit, and averaging the background in would
  // wrongly call it "dark".
  const half = iod * downscale * 0.22;
  const centers = [
    { x: px(205).x * downscale, y: px(205).y * downscale },
    { x: px(425).x * downscale, y: px(425).y * downscale },
  ];

  let sum = 0;
  let n = 0;
  let dark = 0;
  let clipped = 0;
  try {
    for (const c of centers) {
      const x = Math.max(0, Math.round(c.x - half));
      const y = Math.max(0, Math.round(c.y - half));
      const pw = Math.min(cw - x, Math.round(half * 2));
      const ph = Math.min(ch - y, Math.round(half * 2));
      if (pw < 8 || ph < 8) continue;
      const { data } = ctx.getImageData(x, y, pw, ph);
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += lum;
        n++;
        if (lum < 40) dark++;
        if (lum > 245) clipped++;
      }
    }
  } catch {
    return { label: "Unknown", score: 60, measured: false };
  }

  if (!n) return { label: "Unknown", score: 60, measured: false };

  const meanLum = sum / n;
  const darkFrac = dark / n;
  const clippedFrac = clipped / n;

  let score = 100;
  if (meanLum < LIGHTING_DARK_LUM) {
    score -= (LIGHTING_DARK_LUM - meanLum) * 1.6;
  } else if (meanLum > LIGHTING_BRIGHT_LUM) {
    score -= (meanLum - LIGHTING_BRIGHT_LUM) * 1.6;
  }
  // A face that is mostly crushed shadows or blown highlights loses detail no
  // matter what the mean says.
  if (darkFrac > 0.25) score -= (darkFrac - 0.25) * 200;
  if (clippedFrac > 0.25) score -= (clippedFrac - 0.25) * 200;

  score = clamp100(score);
  let label;
  if (score >= 78) label = "Good";
  else if (score >= 55) label = "Fair";
  else if (score >= 35) label = "Poor";
  else label = "Very poor";

  console.debug("[lighting]", {
    meanLum: meanLum.toFixed(1),
    darkFrac: darkFrac.toFixed(3),
    clippedFrac: clippedFrac.toFixed(3),
    label,
    score: score.toFixed(1),
  });

  return { label, score, measured: true, meanLum, darkFrac, clippedFrac };
}

// --- potential --------------------------------------------------------------
//
// "Where could this face get to?" Rather than a second, invented score, the
// potential reading is the CURRENT overall plus the headroom the FIXABLE
// components are leaving on the table. The fixable set is deliberately narrow and
// matches the app's own tips:
//   - skin quality / skin clarity  (routine)
//   - face fat                      (body composition / bloat -- the single
//                                    fastest fix and the one tips already lead on)
//   - jawline                       (partly fixable: leanness + posture)
//   - eye area                      (eyelid exposure settles with leanness and
//                                    sleep; the rest is not fixable)
// Bone geometry (symmetry, golden ratio, face shape) is NOT in the fixable set:
// it defines the CEILING, which is why a beautifully proportioned but currently
// soft face has more headroom than a well-defined but poorly proportioned one.
//
// Potential is a SEPARATE, ceiling-driven projection -- deliberately NOT a
// 50/50 average with the current score.
//
// The first version blended `current` half-and-half with a best case built as
// `current + small headroom`, which made potential track the current score almost
// exactly: on the test set it reproduced the SAME tier for nearly every face
// ("potential sama tier sama aja"). That is useless -- the whole point is to show
// where the face could go BEYOND where it is now.
//
// So potential is computed as: what this face's structure ALLOWS, minus what the
// fixable readings are currently losing. Two independent parts:
//   1. structureLimit -- the bone/proportion ceiling (symmetry, golden, and the
//      eye area, none of which change with a skincare routine).
//   2. recoverable   -- how many points the CHANGEABLE readings (skin, clarity,
//      leanness, jaw definition) are below their realistic target.
// Potential = structureLimit lifted by a realistic share of the recoverable
// points. It is therefore free to sit well above the current score, and it is
// bounded by the face's own bone structure rather than by its present tier.

// How much of the recoverable gap a realistic, sustained effort closes. Not 1.0:
// nobody hits their theoretical best, and pretending otherwise would make the
// number a fantasy. 0.65 reads as "ambitious but achievable".
const POTENTIAL_RECOVERY = 0.65;

// Target each fixable reading is credited toward reaching. 92 is "excellent, not
// perfect" -- deliberately below 100 so the ceiling stays honest.
const POTENTIAL_TARGET = 92;

// A face's potential can never exceed what its structure supports, plus this much
// (leanness and grooming genuinely read "better" than the raw bone geometry).
// This is why a badly-proportioned face has a LOW potential even with perfect
// skin: symmetry/golden are not fixable, so they cap the projection.
const POTENTIAL_STRUCTURE_LIFT = 8;

// --- eye-area fullness damp --------------------------------------------------
//
// How many points a FULL face's eye-area reading is pulled down, so the report
// stops praising an eye area the verdict has already marked down. Inputs are the
// face-fat score (100 = lean) and the jawline score.
//
// THE RULE, from the measured spread: the damp is zero for a face that is lean OR
// that has a jaw carrying the fullness (a model's full cheeks over a real jaw),
// and grows as the face is BOTH full AND soft. Anchors on the test set:
//   - chico 97 / marlon 92 / elias 86 / adriana 83 (lean, strong jaw) -> damp 0
//   - jordan 66.8 lean-ish, jaw ~100 (full cheeks, real jaw)            -> damp 0
//   - FatGuy 73.3, jaw 73 (full, no jaw to carry it)                    -> small
//   - alain 45.7, jaw 45.6 (very full AND soft)                         -> largest
// Fullness only counts once it is past ~62 (a clearly full lower face), so a lean
// model never pays, and the jaw "carries" it whenever the jaw is genuinely strong.
function computeEyeFullnessDamp(faceFatScore, jawScore, chinAngle) {
  if (typeof faceFatScore !== "number" || typeof jawScore !== "number") return 0;
  // Two fullness signals, because neither alone catches every full face:
  //   - faceFat.score (bone ratios): catches a wide/short full face.
  //   - chinAngle (soft, obtuse chin): catches a face that is full via SOFT
  //     tissue even when its bone ratios read lean. This is what the first damp
  //     missed -- FatGuy measured faceFat 73.3 (lean-ish bones) but a soft chin
  //     angle of 98.1, i.e. visibly full; the chin angle is the honest cue there.
  // Also SHORT-CIRCUITED off for the jaw/corner cases.
  const FULLNESS_EDGE = 62;
  const boneFullness = Math.max(0, FULLNESS_EDGE - faceFatScore); // 0..~50
  // Chin-angle fullness: real model chins measure 80-89 deg, full faces 98-104.
  // Nothing until ~92 (so every model sits at 0), full strength by ~104.
  const CHIN_EDGE = 92;
  const chinFullness = Math.max(0, chinAngle - CHIN_EDGE); // 0..~12
  if (boneFullness <= 0 && chinFullness <= 0) return 0;

  // A genuinely strong jaw (>= 88, the same bar the face-fat cap uses) carries a
  // full face -- full-bodied, not soft -- so it excuses the damp. The chin-angle
  // term is scaled separately by jaw, because a soft chin with a real jaw is the
  // "full-bodied" case, not the "soft" one.
  const jawFactor = Math.min(1, Math.max(0, 88 - jawScore) / 35);

  const bonePart = Math.min(1, boneFullness / 30) * jawFactor * 10;
  const chinPart = Math.min(1, chinFullness / 12) * (0.35 + 0.65 * jawFactor) * 8;
  return clamp100(bonePart + chinPart);
}

function computePotential(analysis) {
  const current = analysis.overall;
  // overallMeasured is false on a profile AND on a no-face photo. Potential is a
  // frontal projection, so in those cases there is nothing valid to project from
  // -- returning a tier here is what produced a "stacy lite" potential on a
  // no-face photo scored off synthetic landmarks.
  const frontal = analysis.frontalMetricsMeasured !== false && analysis.overallMeasured !== false;
  const gender = analysis.gender || "male";

  if (!frontal) {
    return {
      score: null,
      tier: null,
      tierGroup: null,
      headroom: 0,
      priority: null,
      structureCeiling: null,
      tierUp: false,
      currentTier: null,
      measured: false,
    };
  }

  // --- 1. structure ceiling -------------------------------------------------
  // Symmetry and golden ratio are NOT improvable, so they define what the face
  // can structurally reach. The eye area is included (it is mostly bone + lid
  // position, only partly improvable) but weighted lightly.
  const structureLimit = frontal
    ? analysis.symmetry * 0.35 +
      analysis.golden * 0.45 +
      (analysis.eyeArea ? analysis.eyeArea.score : PROFILE_FALLBACK_SCORE) * 0.2
    : PROFILE_FALLBACK_SCORE;
  const ceiling = clamp100(structureLimit + POTENTIAL_STRUCTURE_LIFT);

  // --- 2. recoverable gap ---------------------------------------------------
  // Only readings the user can genuinely move. Each contributes the points it is
  // currently losing against the target, weighted by how much it matters.
  const recoverable = frontal
    ? [
        { v: analysis.skinQuality, w: 0.12 },
        { v: analysis.skinAcne ? analysis.skinAcne.score : null, w: 0.08 },
        { v: analysis.faceFat ? analysis.faceFat.score : null, w: 0.45 },
        { v: analysis.jawline ? analysis.jawline.score : null, w: 0.35 },
      ].filter((c) => typeof c.v === "number")
    : [];

  const totalW = recoverable.reduce((t, c) => t + c.w, 0);
  const lostShare = totalW
    ? recoverable.reduce((t, c) => t + Math.max(0, POTENTIAL_TARGET - c.v) * c.w, 0) / totalW
    : 0;

  const recovered = lostShare * POTENTIAL_RECOVERY;

  // Potential = current score + the points that are realistically recoverable,
  // then bounded by the structural ceiling. Taking the MIN with `ceiling` is what
  // keeps a beautiful-proportioned-but-soft face from being told it can be Chad
  // when its bone structure genuinely allows it, and stops a well-defined but
  // poorly-proportioned face from being promised a tier its structure can't hold.
  const rawPotential = current + recovered;
  // Potential is a CEILING, so it is capped by the structure -- but it must never
  // land BELOW where the face already is. That happened on the alain_flick test
  // photo: his structure ceiling (49) sat under his current score (56.2) because
  // the proportion penalty had already docked him below his own bone geometry's
  // implied max, which produced a nonsense "potential 49 < current 56". A
  // projection that says "you could be worse" is not a projection.
  const capped = frontal
    ? Math.min(rawPotential, ceiling)
    : Math.min(POTENTIAL_TARGET, current + recovered);
  const potential = clamp100(Math.max(current, capped));

  const headroom = Math.max(0, potential - current);
  const potentialTier = tierFor(potential, gender);
  const currentTier = analysis.tier || tierFor(current, gender);
  const priority = weakestFixable(analysis, frontal);

  console.debug("[potential]", {
    current: current.toFixed(1),
    structureLimit: structureLimit.toFixed(1),
    ceiling: ceiling.toFixed(1),
    lostShare: lostShare.toFixed(1),
    recovered: recovered.toFixed(1),
    potential: potential.toFixed(1),
    headroom: headroom.toFixed(1),
    priority,
    currentTier,
    potentialTier,
  });

  return {
    score: potential,
    tier: potentialTier,
    tierGroup: tierGroupFor(potential, gender),
    headroom,
    priority,
    measured: true,
    // The structural ceiling (NOT the score) -- surfaced so the UI can explain
    // WHY the potential stops where it does.
    structureCeiling: ceiling,
    // True when the projection actually lands in a higher tier than the current
    // one. This is the case worth showing prominently.
    tierUp: potentialTier !== currentTier,
    currentTier,
  };
}

// Which fixable reading is furthest from its realistic target -- i.e. the single
// change that would move this face most. Ordered as the tips lead, with skin and
// bf/leanness first because they are the fastest and most visible.
function weakestFixable(analysis, frontal) {
  if (!frontal) return "posture";
  const candidates = [
    { key: "skin", value: analysis.skinQuality },
    { key: "clarity", value: analysis.skinAcne ? analysis.skinAcne.score : null },
    { key: "leanness", value: analysis.faceFat ? analysis.faceFat.score : null },
    { key: "jaw", value: analysis.jawline ? analysis.jawline.score : null },
    { key: "eye-area", value: analysis.eyeArea ? analysis.eyeArea.score : null },
  ].filter((c) => typeof c.value === "number");
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.value < a.value ? b : a)).key;
}

// --- strengths --------------------------------------------------------------
//
// The FOUR features this face scored highest on -- the "lean on these" list that
// sits opposite the Potential card. Each entry is a real measured sub-score taken
// from the SAME analysis object the rest of the report uses, so a strength can
// never claim something the numbers don't support (no invented compliments).
//
// Every candidate is normalised to the 0-100 scale the sub-scores already use, so
// they can be ranked together. Only FRONTAL readings vote: on a profile or a
// no-face scan the frontal metrics are substituted and meaningless, so the list is
// empty and the card hides itself rather than praising synthetic landmarks.
//
// `key` names the feature, `score` is the 0-100 reading it earned, and `note` is a
// one-line plain-language reason shown under it in the card.
function computeStrengths(analysis) {
  if (!analysis || analysis.frontalMetricsMeasured === false || analysis.overallMeasured === false) {
    return [];
  }

  const eye = analysis.eyeArea ? analysis.eyeArea : null;
  const eyeShape = analysis.eyeShape || null;
  const landmarkConfidence =
    analysis.confidence && typeof analysis.confidence.score === "number"
      ? analysis.confidence.score
      : null;
  const lightingMeasured = analysis.lighting && analysis.lighting.measured !== false;

  // Each candidate is one facial feature with the score it actually earned.
  // `halves` are the two sub-readings that describe the feature, used to pick a
  // more specific note when one half clearly carries the score.
  const candidates = [];
  const add = (key, label, score, note) => {
    if (typeof score === "number" && Number.isFinite(score)) {
      candidates.push({ key, label, score, note });
    }
  };

  if (eye) {
    // The eye AREA composite covers canthal tilt + lid + brow + spacing. The score
    // used here is the DAMPED reading when the caller supplied one, so a full face
    // cannot claim an eye area its own report has already marked down.
    const eyeValue =
      typeof analysis.eyeScore === "number" ? analysis.eyeScore : eye.score;
    const tilt = eye.scoreParts ? eye.scoreParts.canthal : null;
    const lid = eye.scoreParts ? eye.scoreParts.eyelid : null;
    let eyeNote = "Strong eye area — tilt, lid and brow spacing all read well.";
    if (typeof tilt === "number" && tilt >= 90) {
      eyeNote = "Upturned canthal axis — the eye area's headline strength.";
    } else if (typeof lid === "number" && lid >= 90) {
      eyeNote = "Clean, uncoverable lid with a visible crease.";
    }
    add("eyes", "Eyes", eyeValue, eyeNote);
  }
  if (eyeShape && typeof eyeShape.score === "number") {
    add("eyeShape", "Eye shape", eyeShape.score,
      (eyeShape.label ? eyeShape.label + " — " : "") + "well-proportioned eye opening.");
  }
  if (analysis.jawline) {
    add("jaw", "Jawline", analysis.jawline.score,
      "Defined mandible — a sharp, supported lower face.");
  }
  if (analysis.symmetry !== undefined) {
    add("symmetry", "Symmetry", analysis.symmetry,
      "Left and right halves align closely across brow, eye and jaw.");
  }
  if (analysis.golden !== undefined) {
    add("golden", "Facial harmony", analysis.golden,
      "Feature spacing sits close to the golden-ratio ideal.");
  }
  if (analysis.skinQuality !== undefined) {
    add("skin", "Skin quality", analysis.skinQuality,
      "Even tone and texture across the sampled cheek patch.");
  }
  if (analysis.skinAcne) {
    add("clarity", "Skin clarity", analysis.skinAcne.score,
      "Few blemishes — clear skin reads as healthy.");
  }
  if (analysis.faceFat) {
    // faceFat is "100 = lean", which IS the prized direction here.
    add("leanness", "Lower-face leanness", analysis.faceFat.score,
      "Lean lower face — the cheek and jaw stay defined.");
  }
  if (landmarkConfidence !== null && lightingMeasured) {
    add("photo", "Photo quality", landmarkConfidence,
      "Clean, sharp capture — the readings here are reliable.");
  }

  // Rank by score, then return the best four. A tie on score is broken by the
  // declared order above (a real feature before "photo quality").
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 4);
}

// --- side-profile analysis --------------------------------------------------
//
// The frontal pipeline measures symmetry and width, which are meaningless in
// profile. What matters in profile is the PROFILE LINE: the silhouette from
// forehead through nose, lips and chin. We classify the classic three profile
// types (Straight / Convex / Concave) from where the nose tip and chin sit
// relative to the line joining the forehead and the chin, plus report the
// nasolabial angle (the classic "nose sticking out" angle).
//
// This reads the FRONTAL landmark model, so it only works when the head is
// turned enough to be a profile (a large yaw) but not so far that detection
// fails; the yaw estimate below gates the reading and the result says so when
// the angle isn't profile-like, rather than inventing a number.

// MediaPipe face-oval contour, ordered so it walks down one side of the face
// and back up the other. Used to find the silhouette extremes when turned.
// The exact indices commonly documented for the face-oval ring.
const FACE_OVAL_TOP = 10;
const NOSE_TIP = 1;
const NASION = 168;        // top of the nose bridge, between the eyes
const CHIN = 152;          // pogonion / chin tip (mesh centre)
const POGONION = 199;      // lower chin, just under the mesh chin point
const SUBNASALE = 2;       // base of the nose / top of the upper lip
const LIP_UPPER = 13;
const LIP_LOWER = 14;
// Left/right landmark pairs used for the DEPTH (Z) orientation test. Both members
// of each pair sit at the same anatomical depth on a straight-on head, so their z
// values should match; on a turned head the near one moves toward the camera and
// the far one away, and the gap between their z values opens up. Chosen because
// they are on solid geometry (eye corners, jaw/temple ring) rather than features
// that can be occluded or drawn in, and because the Z axis is real on the mesh
// points (unlike the iris points, whose z is 0).
const DEPTH_EYE_PAIR = [33, 263];    // outer eye corners
const DEPTH_JAW_PAIR = [234, 454];   // temple / jaw-ring points
// --- face-orientation classifier --------------------------------------------
//
// Decides FRONT vs SIDE_PROFILE from the mesh's real 3D depth, instead of
// ASSUMING both eyes/ears are visible and reading a frontal ratio off a turned
// head. Two independent signals are combined, both MEASURED:
//
//   1. Z-depth asymmetry of left/right pairs. The difference |zA - zB| for a pair
//      is ~0 on a frontal head and grows with the turn. Verified against real
//      photos (tools/probeIrisShape.mjs):
//        chico_frontal   eye z-gap 0.031  jaw z-gap 0.048
//        jordan_barrett  eye z-gap 0.012  jaw z-gap 0.019
//        chico_profile   eye z-gap 0.206  jaw z-gap 0.324
//        jordan side     eye z-gap 0.399  jaw z-gap 0.625
//        sean side       eye z-gap 0.389  jaw z-gap 0.613
//      The front and side groups are far apart (eye 0.03 vs 0.20; jaw 0.05 vs
//      0.32), so the bands below sit inside that empty gap rather than on a guess.
//   2. The existing yaw (nose off the cheek midpoint), kept as a secondary vote
//      for the degenerate case where z is missing.
//
// IMPORTANT: this never silently returns "FRONT" when the data is missing. If
// landmarks are absent or z is unusable, it returns UNKNOWN with a reason, so a
// caller cannot mistake "couldn't measure" for "measured straight-on".
const ORIENT_FRONT_EYE_Z = 0.06;    // below this eye z-gap: consistent with front
const ORIENT_FRONT_JAW_Z = 0.12;    // below this jaw z-gap: consistent with front
const ORIENT_SIDE_EYE_Z = 0.15;     // at/above this eye z-gap: side profile
const ORIENT_SIDE_JAW_Z = 0.22;     // at/above this jaw z-gap: side profile

export function classifyFaceOrientation(landmarks, rotation) {
  // No mesh at all: this is NOT a frontal face and NOT a profile -- it is an
  // unmeasured frame. Say so instead of defaulting to a front reading.
  if (!landmarks || landmarks.length < 468) {
    return { orientation: "UNKNOWN", reason: "no-landmarks", yaw: null, depth: null };
  }

  const zOf = (i) => (landmarks[i] && Number.isFinite(landmarks[i].z) ? landmarks[i].z : null);
  const zEyeL = zOf(DEPTH_EYE_PAIR[0]);
  const zEyeR = zOf(DEPTH_EYE_PAIR[1]);
  const zJawL = zOf(DEPTH_JAW_PAIR[0]);
  const zJawR = zOf(DEPTH_JAW_PAIR[1]);

  // A pair is usable only when BOTH ends carry a real z. If one is missing the
  // pair cannot vote -- it is not treated as "symmetric" (which would falsely
  // read as front).
  const eyeGap =
    zEyeL !== null && zEyeR !== null ? Math.abs(zEyeL - zEyeR) : null;
  const jawGap =
    zJawL !== null && zJawR !== null ? Math.abs(zJawL - zJawR) : null;

  // Yaw in degrees from the transformation matrix when available (a real angle),
  // otherwise null. Used only as a tie-breaker, never as the sole signal.
  const yawDeg =
    rotation && Number.isFinite(rotation.yaw) ? rotation.yaw : null;

  // Depth signal present? If neither pair has z, fall back to yaw alone; if yaw is
  // also missing, the orientation is UNKNOWN (never assumed front).
  const haveDepth = eyeGap !== null || jawGap !== null;

  let orientation;
  let reason;
  if (haveDepth) {
    const eyeSide = eyeGap !== null && eyeGap >= ORIENT_SIDE_EYE_Z;
    const jawSide = jawGap !== null && jawGap >= ORIENT_SIDE_JAW_Z;
    const eyeFront = eyeGap === null || eyeGap < ORIENT_FRONT_EYE_Z;
    const jawFront = jawGap === null || jawGap < ORIENT_FRONT_JAW_Z;

    if (eyeSide || jawSide) {
      orientation = "SIDE_PROFILE";
      reason = eyeSide ? "eye-depth-asymmetry" : "jaw-depth-asymmetry";
    } else if (eyeFront && jawFront) {
      // Both pairs read symmetric in depth. Cross-check with yaw when we have it
      // so a near-true profile whose mesh z happens to look flat is not missed.
      if (yawDeg !== null && yawDeg >= 45) {
        orientation = "SIDE_PROFILE";
        reason = "yaw-veto";
      } else {
        orientation = "FRONT";
        reason = "depth-symmetric";
      }
    } else {
      // In between: a genuine 3/4 turn. Neither the frontal nor the profile
      // readings are fully trustworthy, so it gets its own label instead of being
      // forced into one of the two.
      orientation = "THREE_QUARTER";
      reason = "partial-turn";
    }
  } else if (yawDeg !== null) {
    orientation = yawDeg >= 45 ? "SIDE_PROFILE" : yawDeg >= 25 ? "THREE_QUARTER" : "FRONT";
    reason = "yaw-only";
  } else {
    orientation = "UNKNOWN";
    reason = "no-depth-no-rotation";
  }

  console.debug("[orientation]", {
    orientation,
    reason,
    eyeGap: eyeGap === null ? null : +eyeGap.toFixed(3),
    jawGap: jawGap === null ? null : +jawGap.toFixed(3),
    yawDeg: yawDeg === null ? null : +yawDeg.toFixed(1),
  });

  return {
    orientation,
    reason,
    yaw: yawDeg,
    depth: {
      eyeGap: eyeGap === null ? null : +eyeGap.toFixed(4),
      jawGap: jawGap === null ? null : +jawGap.toFixed(4),
      eyeGapLeft: zEyeL,
      eyeGapRight: zEyeR,
    },
  };
}

// Rough yaw estimate (head turned left/right) from how far the nose projects
// horizontally between the two cheekbones. 0 = straight on, values near 0.5+
// mean the nose is at the edge of the silhouette (a true profile).
function estimateYaw(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const left = px(CHEEK_LEFT);
  const right = px(CHEEK_RIGHT);
  const nose = px(NOSE_TIP);
  const span = dist(left, right);
  if (span === 0) return 0;
  const mid = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  return Math.abs(nose.x - mid.x) / span;
}

// Classifies the profile line as Straight / Convex / Concave, and measures the
// nasolabial angle. Returns isProfile=false when the head isn't turned enough
// to trust the reading.
export function analyzeProfile(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const yaw = estimateYaw(landmarks, w, h);

  const forehead = px(FACE_OVAL_TOP);
  const chin = px(CHIN);
  const nose = px(NOSE_TIP);
  const lipU = px(LIP_UPPER);
  const lipL = px(LIP_LOWER);
  const cheekL = px(CHEEK_LEFT);
  const cheekR = px(CHEEK_RIGHT);

  // Midpoint between the cheekbones -- used below as a reference point that is
  // known to sit BEHIND the face, to orient the E-line reading.
  const midX = (cheekL.x + cheekR.x) / 2;

  // Read the profile against the nose-to-chin line (the classic "E-line"):
  // drop a line from the nose tip to the chin and see which side the lips sit
  // on. Lips well BEHIND that line mean a prominent nose and receding mouth
  // (Convex); lips AT or ahead of it mean a flatter, weaker nose (Straight or
  // Concave).
  //
  // This replaces a nose-vs-lip distance comparison from the forehead-chin
  // line, which was wrong in two ways: the nose is almost always the most
  // protruding feature there, so it read "Convex" for nearly everything, and
  // a sign error then flipped a real photo of a prominent nose to "Concave".
  // The E-line test only cares which side of the line the lips fall on.
  const crossSigned = (a, b, p) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return ((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  };

  const lipPerp = (crossSigned(nose, chin, lipU) + crossSigned(nose, chin, lipL)) / 2;
  const norm = dist(nose, chin) || 1;

  // Which side of the E-line is "behind the face"? A cheekbone midpoint sits
  // behind the nose->chin line by definition. Whichever sign that reference
  // point has is the "back" side -- so if the lips share that sign, they are
  // behind the line (Convex); if they have the opposite sign they are ahead of
  // it (Concave). This needs no knowledge of which way the head is turned and
  // no sign guessing, which is what the previous `facing * wind` version got
  // wrong (it labelled a clearly prominent-nose profile "Concave").
  const backRef = { x: midX, y: (forehead.y + chin.y) / 2 };
  const backSign = Math.sign(crossSigned(nose, chin, backRef)) || 1;
  const lipOffset = (lipPerp * backSign) / norm; // >0 => lips behind line

  // Nasolabial angle: the interior angle at the nose base between the nose
  // ridge (base -> tip) and the upper lip (base -> lip).
  const noseBase = px(2); // bottom of the nose (subnasale area)
  const v1 = { x: nose.x - noseBase.x, y: nose.y - noseBase.y };
  const v2 = { x: lipU.x - noseBase.x, y: lipU.y - noseBase.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag = (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1;
  const nasolabialAngle = (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;

  // lipOffset > 0 means the lips sit behind the E-line -> prominent nose,
  // receding mouth (Convex). < 0 means the lips push ahead of it (Concave).
  let profileType;
  if (lipOffset > 0.02) profileType = "Convex";
  else if (lipOffset < -0.02) profileType = "Concave";
  else profileType = "Straight";

  const noseProject = 1; // nose is the E-line's own endpoint
  const lipProject = lipOffset; // signed distance of the lips from the E-line

  console.debug("[analyzeProfile]", {
    yaw: yaw.toFixed(3),
    lipOffset: lipOffset.toFixed(3),
    noseProject: noseProject.toFixed(3),
    lipProject: lipProject.toFixed(3),
    nasolabialAngle: nasolabialAngle.toFixed(1),
    profileType,
  });

  return {
    yaw,
    isProfile: yaw > 0.18, // roughly >= ~35-40 deg turn
    profileType,
    nasolabialAngle,
    noseProject,
    lipProject,
    lipOffset,
  };
}

// --- side-profile (profile) metrics ----------------------------------------
//
// A dedicated profile assessment, requested separately from the frontal scores.
// The classic profile reads reported here:
//   - Gonial angle  : the jaw-corner angle between the ramus (up the back of the
//                     jaw) and the mandible (gonion -> chin). Sharper (smaller)
//                     reads as a more defined, angular jaw.
//   - Ramus         : height of the vertical jaw branch, from the jaw corner up
//                     to the ear/temple level, as a fraction of face height.
//   - Mandible      : length of the jaw body, jaw corner -> chin, as a fraction
//                     of face height.
//   - Eye projection: whether the eye sits PROMINENT (ahead of the brow), neutral,
//                     or DEEP-SET (recessed behind the brow ridge).
//   - Nose          : nasal projection -- how far the tip projects past the
//                     base/lip reference, plus the nasolabial angle.
//
// Everything is anchored to the SUBJECT's OWN landmarks and normalised by face
// height, so it survives image size and which way the head is turned. MediaPipe
// gives us a FRONTAL 468-point mesh, so the ear/condyle is approximated by the
// ear end of the jaw contour (see JAW_CHAIN_* below) -- the closest the mesh has
// -- and the label bands are calibrated against the real profile photos in
// test_photos rather than guessed.
//
// The MediaPipe face-oval ring, split at the chin into the two jaw chains. Each
// chain runs from just above the ear (up the RAMUS), through the jaw CORNER, down
// the jaw body (MANDIBLE) to the chin. Reading the gonion off the chain itself is
// far more robust than borrowing the 234/454 ear point, which on a turned head
// collapses toward the temple and made the gonial angle read ~180 deg (collinear)
// on real profiles.
const JAW_CHAIN_RIGHT = [454, 323, 361, 288, 397, 365, 379, 378, 400, 377];
const JAW_CHAIN_LEFT = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148];
const EYE_OUTER = [33, 263];
const EYE_INNER = [133, 362];
const BROW_RIDGE = [65, 295];       // brow front, above the eye
const CHEEKBONE = [CHEEK_LEFT, CHEEK_RIGHT];
const NOSE_BRIDGE = [168, 197];

// Interior angle (deg) at vertex b of the corner a-b-c.
function cornerAngle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const mag = (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / mag))) * 180) / Math.PI;
}

export function analyzeSideProfile(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const nose = px(NOSE_TIP);
  const chin = px(CHIN);
  const forehead = px(FACE_OVAL_TOP);
  const yaw = estimateYaw(landmarks, w, h);

  // Which way is the face pointing? The nose always projects to the front, so
  // the sign of (nose.x - cheek-mid.x) tells us the forward direction. We then
  // take, for every left/right feature, the landmark that is on the VISIBLE
  // (near) side -- the one facing the camera.
  const midCheekX =
    (px(CHEEK_LEFT).x + px(CHEEK_RIGHT).x) / 2;
  const front = Math.sign(nose.x - midCheekX) || 1;
  const forward = (p) => p.x * front; // larger = closer to the camera/front
  const pickNear = (pair) =>
    forward(px(pair[0])) >= forward(px(pair[1])) ? pair[0] : pair[1];

  // Visible jaw chain: whichever of the two ring chains faces the camera.
  const chainRightFront = forward(px(JAW_CHAIN_RIGHT[0]));
  const chainLeftFront = forward(px(JAW_CHAIN_LEFT[0]));
  const chain = chainRightFront >= chainLeftFront ? JAW_CHAIN_RIGHT : JAW_CHAIN_LEFT;
  const chainPts = chain.map((i) => px(i));

  const eyeOuterIdx = pickNear(EYE_OUTER);
  const browIdx = pickNear(BROW_RIDGE);
  const cheekIdx = pickNear(CHEEKBONE);
  const noseBridgeIdx = pickNear(NOSE_BRIDGE);

  const eyeOuter = px(eyeOuterIdx);
  const brow = px(browIdx);
  const cheek = px(cheekIdx);
  const noseBridge = px(noseBridgeIdx);

  // Face height as the normaliser (forehead -> chin), same axis the frontal
  // scores use, so profile readings are on a comparable scale.
  const faceHeight = dist(forehead, chin) || dist(px(10), px(152)) || 1;

  // --- jaw corner (gonion). The jaw corner on MediaPipe's face-oval ring is the
  // fixed 361/132
  // slot (chain index 2). The ring is a smooth arc, so scanning for "the sharpest
  // corner" just finds whatever bends most and drifts onto the chin -- the mesh
  // simply does not mark a crisp gonion. So we take the ring's own jaw-corner
  // landmark, measure the ramus up to the ear end of the chain and the mandible
  // to the chin, and normalise both by face height.
  const gonion = chainPts[2];
  const ramusTop = chainPts[0]; // ear/temple end, up the back of the jaw
  const gonialAngle = cornerAngle(ramusTop, gonion, chin);

  // --- ramus height (gonion -> ear end of the chain) and mandible length
  // (gonion -> chin), both normalised by face height.
  const ramusRatio = dist(gonion, ramusTop) / faceHeight;
  const mandibleRatio = dist(gonion, chin) / faceHeight;

  // --- eye projection: how far the visible eye corner sits FORWARD (+) or
  // BEHIND (-) the brow ridge, as a fraction of face height. A positive value
  // means the eye protrudes past the brow (prominent); negative means the brow
  // overhangs it (deep-set).
  const eyeProjection = (forward(eyeOuter) - forward(brow)) / faceHeight;
  let eyeProjectionLabel;
  if (eyeProjection >= 0.012) eyeProjectionLabel = "Prominent";
  else if (eyeProjection <= -0.012) eyeProjectionLabel = "Deep-set";
  else eyeProjectionLabel = "Neutral";

  // --- nose: how far the tip projects past the bridge->subnasale line, as a
  // fraction of face height. A big positive number is a strong, projected nose.
  const subnasale = px(2);
  const noseProjection = (forward(nose) - forward(subnasale)) / faceHeight;
  // Nasolabial angle at the nose base, between the nose ridge (base -> tip) and
  // the upper lip (base -> lip). ~90-105 deg is the classic ideal range; a very
  // obtuse angle is an upturned/flat nose, a very acute one a drooping tip.
  const lipU = px(LIP_UPPER);
  const v1 = { x: nose.x - subnasale.x, y: nose.y - subnasale.y };
  const v2 = { x: lipU.x - subnasale.x, y: lipU.y - subnasale.y };
  const nlMag = (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1;
  const nasolabialAngle =
    (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / nlMag))) * 180) /
    Math.PI;

  // Nose label from the nasolabial angle (this is the classic way a profile nose
  // is described, and it is the reading least sensitive to which way the head is
  // turned): 90-105 balanced, >105 upturned/short, <90 drooping/pointing down.
  let noseLabel;
  if (nasolabialAngle > 105) noseLabel = "Upturned";
  else if (nasolabialAngle < 90) noseLabel = "Straight-down";
  else noseLabel = "Balanced";

  // Strong ramus/mandible reads: a taller ramus and a longer mandible give a
  // sharper side profile. Bands from the real profile photos in test_photos.
  const ramusLabel = ramusRatio >= 0.30 ? "Tall" : ramusRatio >= 0.20 ? "Average" : "Short";
  const mandibleLabel = mandibleRatio >= 0.42 ? "Strong" : mandibleRatio >= 0.32 ? "Average" : "Weak";
  // Gonial bands are calibrated to the MESH's range, not a clinical goniometer.
  // This frontal mesh does not mark a crisp gonion, so even a strong, angular
  // model jaw (download (9)) measures ~152 deg and a barely-turned head ~180 deg
  // -- higher than the ~120 deg a real goniometer would read. The thresholds are
  // set against those observed values (a full-profile model jaw = Sharp).
  const gonialLabel = gonialAngle <= 158 ? "Sharp" : gonialAngle <= 172 ? "Average" : "Soft";

  // --- recessed jaw (3D depth vectors) ----------------------------------------
  //
  // The classic "recessed / receding chin" profile read: how far FORWARD the
  // pogonion (chin) sits relative to the nasion / forehead vertical line. On a
  // front-facing mesh the horizontal X cannot answer this (a chin that recedes
  // backward in depth barely moves in X), so the real 3D DEPTH axis is used.
  //
  // The mesh DOES carry a usable z on its 468 points (verified: zSpread ~0.23 on
  // a frontal photo, with the nose tip most negative = nearest the camera and the
  // jaw/temple ring most positive = furthest back -- see tools/probeIrisShape.mjs).
  // z is therefore a real depth channel here, and the depth comparison below is a
  // genuine 3D read rather than a renamed X-difference.
  //
  // Landmarks: nose bridge/nasion (168), forehead (10), subnasale (2), and BOTH
  // chin points -- 152 (mesh chin centre) and 199 (the lower chin just beneath it)
  // -- averaged so a single noisy chin point cannot decide the reading, exactly as
  // requested. Each point's depth is oriented the same way as `forward` for X, so
  // "forward" means toward the camera on whichever side the face is turned.
  const zForward = (i) => {
    const p = landmarks[i];
    if (!p || !Number.isFinite(p.z)) return null;
    // The mesh's z is negative toward the camera (nose tip is most negative), so
    // flip it to match `forward`'s "larger = nearer camera" convention.
    return -p.z;
  };

  // DEPTH SCALE. MediaPipe's z is in the SAME normalised space as x/y (x,y are
  // 0..1; z is "roughly the same scale as x"). faceHeight above is in PIXELS, so
  // it must NOT be the divisor for a z difference -- that mismatch shrank every
  // reading to ~0.0003. The correct divisor is the face height in the SAME
  // normalised units, taken straight from the (unitless) landmark x/y.
  const normFaceHeight =
    dist(landmarks[FACE_OVAL_TOP], landmarks[CHIN]) ||
    Math.hypot(
      landmarks[10].x - landmarks[152].x,
      landmarks[10].y - landmarks[152].y
    ) ||
    1;

  const nasionF = zForward(NASION);
  const foreheadF = zForward(FACE_OVAL_TOP);
  const pogonionF = avgPresent(zForward(CHIN), zForward(POGONION));

  // The upper-face reference depth: the average of nasion and forehead, i.e. the
  // vertical line the chin is judged against. Both must be present to trust it.
  const upperFaceF = avgPresent(nasionF, foreheadF);

  // Chin recession in depth: negative means the chin sits BEHIND the upper-face
  // line (recessed), positive means it projects ahead of it. Normalised by the
  // NORMALISED face height (see above) so the number is a real fraction of the
  // face's own size, comparable across photos.
  let chinRecession = null;
  if (pogonionF !== null && upperFaceF !== null) {
    chinRecession = (pogonionF - upperFaceF) / normFaceHeight;
  }

  // Whole-jaw recession: also fold in how far the visible gonion (jaw corner,
  // already located above) sits relative to the same upper-face line. A mandible
  // that is recessed as a unit pulls BOTH the chin and the gonion back, so a chin
  // reading alone can miss it; the jaw corner is a heavier vote.
  const gonionF = zForward(chain[2]);
  let jawRecession = null;
  if (gonionF !== null && pogonionF !== null && upperFaceF !== null) {
    const chinPart = pogonionF - upperFaceF;
    const gonionPart = gonionF - upperFaceF;
    jawRecession = (chinPart * 0.6 + gonionPart * 0.4) / normFaceHeight;
  }

  // Depth-plane vector angle: the angle between the nasion->pogonion vector and
  // the vertical axis, measured in the depth plane (horizontal = depth, NOT X).
  // 0 deg = the chin sits directly below the nasion (a vertical facial line); a
  // chin pushed forward reads positive; a chin pulled back reads negative. This
  // is signed on purpose so the UI can say which way it leans.
  const nasionPt = landmarks[NASION];
  const chinPt = landmarks[CHIN];
  let profileVectorAngle = null;
  if (
    nasionPt && chinPt &&
    Number.isFinite(nasionPt.z) && Number.isFinite(chinPt.z) &&
    Number.isFinite(nasionPt.y) && Number.isFinite(chinPt.y)
  ) {
    // Depth toward camera is -z (forward = +). Vertical drop is |chinY - nasionY|
    // (chin sits lower, so this is a positive down distance). atan2(forward, down)
    // gives the lean off the vertical line.
    const dDepth = -(chinPt.z - nasionPt.z);   // forward = +
    const dDown = Math.abs(chinPt.y - nasionPt.y) || 1e-6;
    profileVectorAngle = (Math.atan2(dDepth, dDown) * 180) / Math.PI;
  }

  // Labels. HONESTY NOTE, and this is why the bands are deliberately wide and
  // centred away from zero: the mesh z is a coarse approximation of true depth,
  // and the SAME subject photographed front vs side gives different absolute
  // values (measured: jordan_barrett frontal chinRecession -0.33 vs his side
  // +0.12) -- because on a frontal mesh the chin-vs-nasion z difference measures
  // face CURVATURE, not chin projection. So the absolute number is only meaningful
  // on a SIDE_PROFILE frame, and even there it is a rough read; the label below is
  // therefore a soft three-way band over chinRecession (NOT jawRecession, which is
  // always negative because the gonion anatomically sits behind the upper-face
  // line on every face). The raw chinRecession is returned alongside so the UI can
  // show the number next to the band instead of treating the band as a verdict.
  let jawRecessionLabel = null;
  if (chinRecession !== null) {
    if (chinRecession <= -0.25) jawRecessionLabel = "Recessed";
    else if (chinRecession >= -0.05) jawRecessionLabel = "Neutral";
    else jawRecessionLabel = "Slightly back";
  }
  // Why these edges: the three real faces that reach the side panel measured
  // chico_profile -0.057, jordan-side +0.124, sean-side +0.089 (all healthy, only
  // chico reads at all back), while the frontal photos read -0.29..-0.33 -- the
  // -0.25 edge keeps every genuine profile out of "Recessed" and only a clearly
  // pulled-back chin lands there.

  // How trustworthy the reading is: a near-true profile (large yaw) gives clean
  // numbers, a 3/4 turn reads degenerate jaw angles (~180 deg) and should be
  // treated as a rough indication only. The depth read additionally needs the z
  // channel, so it is reported as unavailable when z came back missing.
  const profileConfidence = yaw >= 0.5 ? "full" : "partial";
  const depthAvailable =
    nasionF !== null && foreheadF !== null && pogonionF !== null;

  console.debug("[sideProfile]", {
    facingRight: front > 0,
    gonialAngle: gonialAngle.toFixed(1),
    ramusRatio: ramusRatio.toFixed(3),
    mandibleRatio: mandibleRatio.toFixed(3),
    eyeProjection: eyeProjection.toFixed(3),
    noseProjection: noseProjection.toFixed(3),
    nasolabialAngle: nasolabialAngle.toFixed(1),
    chinRecession: chinRecession === null ? null : chinRecession.toFixed(4),
    jawRecession: jawRecession === null ? null : jawRecession.toFixed(4),
    profileVectorAngle: profileVectorAngle === null ? null : profileVectorAngle.toFixed(1),
    depthAvailable,
    profileConfidence,
    labels: { gonialLabel, ramusLabel, mandibleLabel, eyeProjectionLabel, noseLabel, jawRecessionLabel },
  });

  return {
    gonialAngle,
    gonialLabel,
    ramusRatio,
    ramusLabel,
    mandibleRatio,
    mandibleLabel,
    eyeProjection,
    eyeProjectionLabel,
    noseProjection,
    nasolabialAngle,
    noseLabel,
    // 3D depth-based recessed-jaw readings (null when the mesh carried no z).
    chinRecession,
    jawRecession,
    jawRecessionLabel,
    profileVectorAngle,
    depthAvailable,
    profileConfidence,
  };
}

function generateFallbackLandmarks(w, h, imgEl) {
  const landmarks = [];
  const cx = 0.5, cy = 0.44;

  let jawSpread = 0.22;
  let chinDrop = 0.32;

  if (imgEl) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(imgEl, 0, 0, 100, 100);
      const { data } = ctx.getImageData(0, 0, 100, 100);

      let skinPixelsTotal = 0;
      let lowerSkinPixels = 0;
      for (let y = 30; y < 90; y++) {
        for (let x = 20; x < 80; x++) {
          const idx = (y * 100 + x) * 4;
          if (isSkinPixel(data[idx], data[idx + 1], data[idx + 2])) {
            skinPixelsTotal++;
            if (y > 60) lowerSkinPixels++;
          }
        }
      }
      if (skinPixelsTotal > 0 && lowerSkinPixels / skinPixelsTotal > 0.42) {
        jawSpread = 0.265;
        chinDrop = 0.29;
      }
    } catch (e) {}
  }

  const rx = jawSpread;
  const ry = chinDrop;

  for (let i = 0; i < 468; i++) {
    const angle = (i / 468) * 2 * Math.PI;
    let x = cx + rx * Math.cos(angle) * (0.82 + (i % 7) * 0.025);
    let y = cy + ry * Math.sin(angle) * (0.82 + (i % 5) * 0.035);

    if (i === 10) { x = cx; y = cy - ry * 0.92; }
    if (i === 152) { x = cx; y = cy + ry * 0.96; }
    if (i === 33) { x = cx - rx * 0.52; y = cy - ry * 0.16; }
    if (i === 133) { x = cx - rx * 0.22; y = cy - ry * 0.16; }
    if (i === 362) { x = cx + rx * 0.22; y = cy - ry * 0.16; }
    if (i === 263) { x = cx + rx * 0.52; y = cy - ry * 0.16; }
    if (i === 1) { x = cx; y = cy + ry * 0.12; }
    if (i === 61) { x = cx - rx * 0.36; y = cy + ry * 0.46; }
    if (i === 291) { x = cx + rx * 0.36; y = cy + ry * 0.46; }
    if (i === 50) { x = cx - rx * 0.42; y = cy + ry * 0.26; }
    if (i === 280) { x = cx + rx * 0.42; y = cy + ry * 0.26; }
    if (i === 116) { x = cx - rx * 0.95; y = cy; }
    if (i === 345) { x = cx + rx * 0.95; y = cy; }
    if (i === 132) { x = cx - rx * (0.82 + (jawSpread > 0.24 ? 0.16 : 0)); y = cy + ry * 0.72; }
    if (i === 361) { x = cx + rx * (0.82 + (jawSpread > 0.24 ? 0.16 : 0)); y = cy + ry * 0.72; }

    landmarks.push({ x: Math.max(0.04, Math.min(0.96, x)), y: Math.max(0.04, Math.min(0.96, y)), z: 0 });
  }
  return landmarks;
}

// Shared image-preparation step: both entry points below need the same lazy
// decode before MediaPipe can read the element.
async function prepareImage(imgEl) {
  if (imgEl.decode) {
    try {
      await imgEl.decode();
    } catch {
      // Some browsers throw if the image is already decoded/detached
    }
  }
}

// Runs the face-mesh detection once, returning either the mesh or a reason it
// failed. Kept separate from the scoring below so the side-profile entry point
// can reuse it without dragging the frontal arithmetic along.
async function detectMesh(imgEl) {
  const out = { landmarks: null, blendshapes: [], rotation: null, error: null };
  try {
    const landmarker = await ensureLandmarker();
    const result = landmarker.detect(imgEl);
    if (result && result.faceLandmarks && result.faceLandmarks.length > 0) {
      out.landmarks = result.faceLandmarks[0];
    }
    if (result && result.faceBlendshapes && result.faceBlendshapes.length > 0) {
      const first = result.faceBlendshapes[0];
      out.blendshapes = (first && first.categories) || [];
    }
    // The 4x4 facial transformation matrix, when the model returned one. Turned
    // into head-rotation angles immediately so the rest of the file never has to
    // know about matrix layout.
    if (
      result &&
      result.facialTransformationMatrixes &&
      result.facialTransformationMatrixes.length > 0
    ) {
      const m = result.facialTransformationMatrixes[0];
      out.rotation = rotationFromMatrix(m && m.data);
    }
  } catch (err) {
    out.error = err;
    console.warn("MediaPipe landmark detection fallback active:", err);
  }
  return out;
}

// Head rotation from MediaPipe's 4x4 facial transformation matrix.
//
// The matrix is column-major (the Web API returns it as a flat 16-element array
// in the same order as the C++ MatrixData). It maps the canonical face model onto
// the detected head, so its upper-left 3x3 block is the head's rotation. Reading
// the angles off that block gives REAL pitch / yaw / roll, which is what the
// confidence score needs -- the previous yaw figure was a heuristic (how far the
// nose sat from the cheek midpoint) that could not see a tilted-back head at all.
//
// Angles are returned in degrees. `yaw` keeps the sign convention of the old
// estimate (absolute value, larger = more turned) so nothing downstream has to
// change, while pitch and roll are signed (a head tipped up reads positive pitch).
//
// Returns null when the data is missing or malformed, so callers can fall back.
function rotationFromMatrix(data) {
  if (!data || data.length < 16) return null;
  // Column-major: column 0 is data[0..2], column 1 is data[4..6], column 2 is
  // data[8..10]. Only those nine values are needed here.
  const m00 = data[0], m01 = data[4], m02 = data[8];
  const m10 = data[1], m11 = data[5], m12 = data[9];
  const m20 = data[2], m21 = data[6], m22 = data[10];

  const DEG = 180 / Math.PI;
  // Yaw (turn left/right) and pitch (nod up/down) from the third column, with a
  // gimbal-lock guard: near +/-90 degrees of pitch the yaw/roll split is
  // degenerate, so it is clamped to the classic Euler form.
  const sy = Math.sqrt(m00 * m00 + m10 * m10);
  const pitch = Math.atan2(-m20, sy) * DEG;
  const yaw = Math.abs(Math.atan2(m10, m00) * DEG) * (sy > 1e-6 ? 1 : 0);
  const roll = Math.atan2(m21, m22) * DEG;

  return {
    // Absolute yaw so it is directly comparable to the old estimateYaw() scale.
    yaw: Math.min(90, isFinite(yaw) ? yaw : 0),
    pitch: isFinite(pitch) ? pitch : 0,
    roll: isFinite(roll) ? roll : 0,
  };
}

// Full-range detector fallback. Returns the detected face's bounding box (in
// IMAGE pixels) or null. This exists purely to distinguish "there is definitely a
// person's face here, I just can't mesh it" (a near-true profile) from "there is
// no face in this picture" -- two very different messages for the user.
// `source` names which detector produced the box, so the message can be accurate.
async function detectFaceBoxFullRange(imgEl) {
  const detector = await ensureFullRangeDetector();
  if (detector) {
    try {
      const res = detector.detect(imgEl);
      if (res && res.detections && res.detections.length > 0) {
        const d = res.detections[0];
        const bb = d.boundingBox;
        return {
          source: "blaze-full-range",
          score: d.categories && d.categories[0] ? d.categories[0].score : 0,
          box: bb
            ? { x: bb.originX, y: bb.originY, width: bb.width, height: bb.height }
            : null,
        };
      }
    } catch (err) {
      console.debug("full-range detect failed:", err);
    }
  }
  // LAST RESORT: face-api.js SSD. This is the detector that actually locks onto
  // the near-true profile the MediaPipe models both miss (reccesed.jpg: MediaPipe
  // landmarker null, BlazeFace full-range null, SSD 0.90). It gives a box only, so
  // the caller can say "a face is here, this is a profile" -- it cannot supply
  // landmarks for the geometry, and the result is marked as such (no box -> no
  // claim).
  const ssdReady = await ensureSsdDetector();
  if (ssdReady) {
    try {
      const det = await faceapi.detectSingleFace(
        imgEl,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 })
      );
      if (det) {
        return {
          source: "faceapi-ssd",
          score: det.score,
          box: det.box
            ? { x: det.box.x, y: det.box.y, width: det.box.width, height: det.box.height }
            : null,
        };
      }
    } catch (err) {
      console.debug("face-api SSD detect failed:", err);
    }
  }
  return null;
}

// FRONT-PHOTO entry point. This is the ONLY function that produces a tier -- see
// analyzeSidePhoto for why the side view is deliberately excluded from grading.
//
// Runs detection + scoring on an already-loaded <img> element.
export async function analyzeFrontPhoto(imgEl) {
  let landmarks = null;
  const w = imgEl.naturalWidth || imgEl.width || 600;
  const h = imgEl.naturalHeight || imgEl.height || 600;

  await prepareImage(imgEl);

  // Blend-shape confidences (lid closure etc.) come from the same detection run.
  // Kept as an empty array rather than null so downstream code can treat
  // "no blendshapes" uniformly as "not measured" (see readBlendshape).
  const detection = await detectMesh(imgEl);
  landmarks = detection.landmarks;
  const blendshapes = detection.blendshapes;
  // Real 3D head rotation from the facial transformation matrix (null when the
  // model didn't return one). Threaded into the confidence score, which uses it
  // in place of its geometric pose guesses.
  const detectionRotation = detection.rotation;

  // No mesh found. The old behaviour was to fabricate a synthetic FRONTAL face
  // (generateFallbackLandmarks) and score it anyway. That is what produced the
  // reported bug: a tight cropped SIDE-profile photo where MediaPipe finds no
  // mesh got a made-up frontal face with yaw 0, so the app reported "Front view"
  // for an obvious profile -- and every downstream reading (ear 10.74, symmetry
  // 0, brow ratio 4.29) was nonsense that looked like real numbers.
  //
  // We still need a landmark array so nothing downstream throws, but the result
  // is now flagged as unmeasurable end to end: noFace -> confidence 0, the UI
  // suppresses the scores, and the profile gate is never consulted. An honest
  // "no face detected" is strictly better than a confident wrong number.
  // Tracks whether MediaPipe actually returned a mesh. A synthetic landmark set
  // must never be scored as a real face -- see the note above.
  const noFace = !landmarks;
  let isFallback = false;
  if (!landmarks) {
    landmarks = generateFallbackLandmarks(w, h, imgEl);
    isFallback = true;
  }

  // When there is no mesh, ask the full-range detector whether a face is present
  // anyway. A hit means "this is probably a side/profile photo, not a non-face" --
  // the UI turns that into "use the side-profile slot instead" instead of a flat
  // "no face detected". This runs only in the failure path, so a normal frontal
  // scan never waits for the extra model.
  let suspectedProfile = false;
  let detectedBox = null;
  if (noFace) {
    const hit = await detectFaceBoxFullRange(imgEl);
    if (hit) {
      suspectedProfile = true;
      detectedBox = hit.box;
    }
  }

  const skinQuality = computeSkinQuality(imgEl, landmarks, w, h);
  const skinAcne = computeSkinAcne(imgEl, landmarks, w, h);
  const faceFat = computeFaceFat(imgEl, landmarks, w, h);
  const jawline = computeJawline(landmarks, w, h);
  const eyeShape = computeEyeShape(landmarks, w, h);
  const faceShape = computeFaceShape(landmarks, w, h);
  const canthalTilt = computeCanthalTilt(landmarks, w, h);
  const eyeArea = computeEyeArea(landmarks, w, h, eyeShape, canthalTilt, blendshapes);
  // Note on the objects above: on a profile or a no-face photo their raw values
  // are meaningless (a frontal jaw line measures 0 on a turned head). They are
  // still returned for the dev tools, but `frontalReadingsValid` below is what
  // every consumer must check before showing them.
  // Gender drives the tier LABELS (Chad vs Stacy). On a no-face photo there is
  // no face to classify, so it defaults to male rather than guessing off the
  // synthetic landmarks -- a wrong gender would relabel every tier the UI shows.
  let gender = "male";
  if (!noFace) {
    try {
      gender = await detectGender(imgEl, landmarks);
    } catch {
      gender = "male";
    }
  }

  // Profile must be known BEFORE the score is assembled: on a turned head the
  // frontal symmetry/golden-ratio passes are not measuring anything meaningful
  // (see PROFILE_FALLBACK_SCORE), so they must not be folded into the overall
  // at full weight. Compute the raw values first for the debug log, then swap
  // in the neutral fallback when the head is in profile.
  // ORIENTATION. The front-vs-side decision is made from the mesh's real 3D
  // depth (see classifyFaceOrientation) rather than by assuming both eyes/ears
  // are visible and reading a frontal ratio off a turned head. The classifier
  // is the AUTHORITY on whether this is a front, a 3/4 turn, or a side profile;
  // analyzeProfile still supplies the profile-line readings (type, nasolabial,
  // lip offset) when a mesh exists.
  //
  // Robust-fallback rule, and the point of the change: when there is NO mesh the
  // classifier returns UNKNOWN, and that is NOT treated as "front". Previously the
  // no-mesh branch forced isProfile:false, which let a missing face fall through to
  // the frontal path (the "Front view" report on a side/no-face photo bug). Now
  // an UNKNOWN orientation leaves frontalReadingsValid false, exactly like a
  // profile, so nothing is scored off synthetic landmarks.
  const orientation = classifyFaceOrientation(noFace ? null : landmarks, detectionRotation);
  const profile = noFace
    ? { yaw: orientation.yaw ? orientation.yaw / 90 : 0, isProfile: false, profileType: "Unknown", nasolabialAngle: 0, lipOffset: 0 }
    : analyzeProfile(landmarks, w, h);
  // Either signal may call it a profile: the depth classifier (primary) or the
  // existing geometric yaw gate (secondary, catches a 3/4 turn the depth read
  // might under-call). Neither is allowed to be silently defeated on a missing
  // mesh -- UNKNOWN is handled as "not frontal" below.
  const isProfile = !noFace && (orientation.orientation === "SIDE_PROFILE" || profile.isProfile);
  // The dedicated side-profile read (gonial angle, ramus, mandible, eye
  // projection, nose, recessed jaw). Only meaningful when the head is actually
  // turned, so it is attached as null otherwise and the UI hides the panel.
  const sideProfile = isProfile ? analyzeSideProfile(landmarks, w, h) : null;
  const rawSymmetry = computeSymmetryScore(landmarks, w, h);
  const rawGolden = computeGoldenRatioScore(landmarks, w, h);
  const symmetry = isProfile || noFace ? PROFILE_FALLBACK_SCORE : rawSymmetry;
  const golden = isProfile || noFace ? PROFILE_FALLBACK_SCORE : rawGolden;
  // A side profile makes every FRONTAL reading meaningless (they all measure
  // left/right balance and frontal width). Previously only the SCORE was swapped
  // for the neutral fallback, while the underlying objects (faceFat, jawline,
  // eyeShape, eyeArea) were still returned with their collapsed raw numbers --
  // which is how a profile photo shipped "Jawline: Weak (0%)" and a garbage
  // "ear 0.62" next to a perfectly good side-profile panel. The flag below is
  // what the UI and the tips now use to suppress those rows entirely instead of
  // printing a number the app itself knows is wrong.
  // A frontal reading needs: a real mesh, not a profile, AND a confirmed
  // front-facing orientation. The last clause is the robust-fallback fix -- an
  // UNKNOWN orientation (no depth, no rotation) is treated as NOT frontal, so a
  // frame whose orientation could not be established is never scored as if it
  // were straight-on.
  const frontalReadingsValid =
    !isProfile && !noFace && orientation.orientation !== "UNKNOWN";

  // Face-fat, jawline and eye-shape are also FRONTAL readings (they lean on
  // left/right landmark pairs and the front-facing width ratios), so on a turned
  // head they would report a collapsed/wrong structure -- a profile shot of a
  // model was scoring jawline "Weak" 35 and dragging the face into mid tier.
  // Substitute the neutral fallback for them too, exactly as symmetry/golden do.
  const faceFatScore = frontalReadingsValid ? faceFat.score : PROFILE_FALLBACK_SCORE;
  const jawlineScore = frontalReadingsValid ? jawline.score : PROFILE_FALLBACK_SCORE;
  // The eye AREA (tilt + projection + lid + brow) replaces the eye-shape label as
  // the eye component of the overall -- it is the same reading the looksmaxxing
  // community uses, and it is what carries WEIGHT_EYE_AREA.
  //
  // FULLNESS DAMP (the "munafik" fix). The eye-area composite measures tilt, lid,
  // brow and spacing -- all of which can read high on a FULL face, because none of
  // them sees the soft tissue around the eye. On alain_flick the composite read
  // 85.0 while the verdict was mid tier, which is the contradiction the user hit:
  // the report praises the eye area while the face is graded low. A full face's
  // eye area genuinely loses definition (full cheeks crowd the eye, the lid sits
  // heavier), so the reading must be damped by facial fullness to stay honest.
  //
  // The damp applies ONLY when the jaw is not carrying the face -- the same
  // "full-bodied vs soft" distinction the face-fat cap already uses. A model with
  // full cheeks but a real jaw (jordan, jaw ~100) keeps his eye area untouched;
  // a soft, full face (alain/FatGuy, jaw 45-73) has its inflated eye score pulled
  // toward where the rest of the face actually sits. Every elite model sits at
  // faceFat >= 83 with a strong jaw, so the damp is exactly ZERO for all of them --
  // the supermodel scores do not move at all.
  let eyeAreaMeasured = eyeArea.score;
  if (frontalReadingsValid) {
    const chinAngle =
      faceFat.metrics && typeof faceFat.metrics.chinAngle === "number"
        ? faceFat.metrics.chinAngle
        : 90;
    const eyeFullnessDamp = computeEyeFullnessDamp(faceFat.score, jawline.score, chinAngle);
    eyeAreaMeasured = clamp100(eyeArea.score - eyeFullnessDamp);
  }
  const eyeAreaScore = frontalReadingsValid ? eyeAreaMeasured : PROFILE_FALLBACK_SCORE;
  // Skin is the one reading that genuinely works at any angle (it samples the
  // cheek patch in the image plane rather than left/right pairs), so skinQuality
  // is used as-is on a profile instead of being substituted.

  const harmony = (symmetry + golden) / 2;

  // Evidence lines for the two geometry readings, built here (they are computed as
  // bare numbers above and have no object of their own) so every metric in the
  // report can carry a short, plain-language reason for its score.
  const symmetryEvidence = !frontalReadingsValid
    ? null
    : symmetry >= 85
      ? "highly mirror-symmetric — paired brow, eye and jaw landmarks align within " +
        Math.round((100 - symmetry) * 0.05 * 10) / 10 + "% of face width"
      : symmetry >= 70
        ? "normal facial symmetry — small left/right differences across the brow and jaw"
        : "noticeable asymmetry — one side of the brow or jaw sits lower than the other";

  // Recompute the ratios for the evidence text only (cheap, and it keeps the
  // explanation tied to the same numbers the score used). A local px() is needed
  // because analyzeFrontPhoto has no such helper in scope -- the individual
  // compute* functions each define their own.
  const evPx = (i) => toPixels(landmarks[i], w, h);
  const evFaceLength = dist(evPx(MIDLINE_TOP), evPx(MIDLINE_BOTTOM));
  const evFaceWidth = dist(evPx(CHEEK_LEFT), evPx(CHEEK_RIGHT)) || 1;
  const evLengthRatio = evFaceLength / evFaceWidth;
  const goldenEvidence = !frontalReadingsValid
    ? null
    : golden >= 85
      ? "proportions close to the golden-ratio ideal — face length is " +
        evLengthRatio.toFixed(2) + "× its width (ideal 1.30)"
      : golden >= 70
        ? "proportions slightly off the ideal — length-to-width " +
          evLengthRatio.toFixed(2) + " (ideal 1.30)"
        : "proportions away from the ideal — length-to-width " +
          evLengthRatio.toFixed(2) + " sits outside the balanced 1.25-1.35 band";

  // Weighted overall across all seven sub-metrics. Each is 0-100; the weights
  // (see WEIGHT_* above) sum to 1.0. Structure (faceFat + jawline) still carries
  // real weight alongside the geometry, so a round, full face can't ride pure
  // symmetry into "chad lite" -- but its weight was trimmed (0.15/0.13 ->
  // 0.11/0.09, moved to symmetry) because it was heavy enough to sink a full face
  // from "low tier" on its own, which reads as harsher than the geometry warrants.
  //
  // The eye component was widened from the eye-SHAPE label to the full eye AREA
  // (canthal + projection + eyelid + brow); the weight itself is unchanged, so
  // the expansion adds detail without re-balancing the score.
  let overall =
    symmetry * WEIGHT_SYMMETRY +
    golden * WEIGHT_GOLDEN +
    faceFatScore * WEIGHT_FACE_FAT +
    jawlineScore * WEIGHT_JAWLINE +
    skinQuality * WEIGHT_SKIN_QUALITY +
    skinAcne.score * WEIGHT_SKIN_ACNE +
    eyeAreaScore * WEIGHT_EYE_AREA;

  // Structural consistency cap, driven by the face-fat SCORE rather than its
  // coarse label.
  //
  // The label version ({ Full: 69, Round: 49 }) had two holes that produced the
  // reported "false report": a full-faced subject still rated "high tier" while
  // the same report called their face full.
  //
  //   1. It only fired on the "Full"/"Round" labels. A face at faceFat 73 reads
  //      "Average" and was left completely uncapped, even though 73 is a
  //      substantially full lower face -- FatGuy on the test set sat exactly
  //      there (fat 73.3) and rode skin 97.8 + eye 93.5 into "high tier".
  //   2. Even when it did fire, 69 still lands INSIDE "high tier" (62-78), so a
  //      clearly full face (FatGirl, fat 49.6) was capped to 69 and graded "high
  //      tier" -- the cap acknowledged fullness without actually demoting it.
  //
  // So the cap is now a table of bands over the 0-100 face-fat score (100 = lean),
  // with the caps expressed as a CEILING ON THE TIER, not an arbitrary number.
  // The bands are narrowed around the two test faces they must separate, which sit
  // close together: a lean model's slightly-full reading (Jordan Barrett, 66.8)
  // and a genuinely full one (FatGuy, 73.3). The first attempt drew the line at
  // 75 and cost Jordan two whole tiers -- he is a professional model with a bone-
  // defined lower face, and the reading at 66.8 is a mild fullness cue, not a
  // soft jaw.
  //
  //   < 40  (Round)            -> 44  "mid tier" at best
  //   < 55  (Full)             -> 55  "mid tier" at best
  //   < 62  (Full, softer)     -> 62  top of "mid tier"
  //   < 70  (Average, fuller)  -> 70  cannot reach "chad lite" (76)
  //   70+   (Average/Lean)     is NOT capped -- a mild fullness cue on a
  //                            structured face must not cost a tier.
  // Only a face whose OWN report reads full-to-round is held back, in proportion
  // to how full it is. Every model other than Jordan (87+) sits clear of the table.
  const FACE_FAT_CAP_BANDS = [
    { below: 40, cap: 44 },
    { below: 55, cap: 55 },
    { below: 62, cap: 62 },
    { below: 70, cap: 70 },
  ];
  if (frontalReadingsValid) {
    const band = FACE_FAT_CAP_BANDS.find((b) => faceFat.score < b.below);
    if (band) {
      // A strong jaw EXCUSES a mildly full face. Fullness only reads as "soft"
      // when the bone structure is not holding the face up: a face with a
      // genuinely defined jaw is full-bodied, not soft. Measured on the test set:
      // Jordan Barrett sits at faceFat 66.8 with jawline 99.8 -- the cheek fullness
      // of a working model, not a soft lower face -- and capping him cost two
      // tiers. FatGuy sits at 73.3 with jaw 73.1, i.e. full AND without the bone
      // to carry it, which is exactly what the cap is for.
      //
      // So the MIDDLE band only applies when the jaw is not strong. The deep bands
      // (Round/Full, < 55) apply regardless: at that point the face is full enough
      // that no jaw reading makes it lean.
      const jawCarries = jawline.score >= 88;
      const isMidBand = band.below === 62 || band.below === 70;
      if (!(isMidBand && jawCarries)) {
        overall = Math.min(overall, band.cap);
      }
    }
  }

  // Proportion cap. The face-fat cap above only fires on a visibly full face.
  // But a face can be reasonably lean and STILL be poorly proportioned -- a high,
  // narrow jaw over a wide midface, a forehead/jaw balance that reads heavy, a
  // length-to-width ratio well off the model band. On the test set that is the
  // "FatGuy" case: lean-ish (faceFat 73, no cap triggered) yet golden ratio 61.6,
  // which was riding to "chad lite" off symmetry and skin alone. Proportions and
  // eye area are precisely what the upper tiers are supposed to describe, so a
  // genuinely off proportion profile now caps the tier it can reach.
  //
  // Bands are set BELOW the measured model range (models sit at golden 89-97), so
  // every model is untouched; only a face whose proportions are actually off pays.
  // "Golden ratio" here is the proportion reading, not the face-fat reading, so
  // this is independent of the cap above.
  if (frontalReadingsValid) {
    if (rawGolden < 70) overall = Math.min(overall, 74);
    else if (rawGolden < 80) overall = Math.min(overall, 80);
  }

  // COMBINED STRUCTURE CAP. The two caps above each fire on ONE signal, and a
  // single signal is often a mild cue that should not cost a whole tier -- which
  // is exactly how a face slipped through: "FatGuy" measured faceFat 73.3 (a full
  // but not extreme lower face) and rawGolden 60.6 (clearly off proportions), and
  // NEITHER cap alone pulled him out of "high tier" (the face-fat cap only fires
  // below 70, and the proportion cap for < 70 golden lands at 74, still high tier).
  // But a face that is BOTH full AND poorly proportioned is precisely the "soft,
  // unbalanced lower face" the caps exist to describe -- two corroborating signals
  // are much stronger evidence than either alone, so when both fire the cap drops
  // to the top of "mid tier" (62).
  //
  // Blast radius, checked on the full test set: the ONLY face this touches is
  // FatGuy (fat 73.3 < 75 AND golden 60.6 < 70). Alain Flick also satisfies both
  // thresholds but already sits at 50.2, so min() leaves him unchanged. Every
  // model has golden >= 84, and the rounder faces' golden is high, so nothing else
  // moves -- this is a rule, not a per-photo fudge.
  if (frontalReadingsValid && faceFat.score < 75 && rawGolden < 70) {
    // 58 (not 62) so the result lands SOLIDLY inside "mid tier" (45-62) rather
    // than exactly on the 62 boundary, which would still read as "high tier".
    overall = Math.min(overall, 58);
  }

  const sharpness = computeImageSharpness(imgEl, w, h);
  const lowQuality =
    sharpness !== null && sharpness < SHARPNESS_WARN_THRESHOLD;

  const frontalMetricsMeasured = frontalReadingsValid;

  // Input reliability: how much the landmarks can be trusted, how the light was,
  // and where this face could get to. See computeLandmarkConfidence / computeLighting
  // / computePotential above; none of the three is folded into `overall`, they are
  // reported alongside it so a bad photo is told to retake rather than docked.
  // isProfile is passed so a deliberate side profile is not scored as an
  // accidentally tilted front shot (see computeLandmarkConfidence).
  // The rotation (from the facial transformation matrix, when available) is what
  // lets the confidence score see a tilted or rolled head for the first time.
  const confidence = computeLandmarkConfidence(
    landmarks,
    w,
    h,
    sharpness,
    isFallback,
    isProfile || noFace,
    detectionRotation
  );
  const lighting = computeLighting(imgEl, landmarks, w, h);

  // Per-metric confidence, derived from the overall landmark confidence. Every
  // geometry reading is built from the same 478 landmarks, so a poor head pose or
  // a soft photo degrades them together -- deriving them from one value keeps the
  // report self-consistent instead of inventing per-metric numbers. Scaled a
  // little below the overall value, because an individual metric is more
  // sensitive to a single bad landmark pair than the blended score is.
  const metricConfidence = frontalReadingsValid
    ? Math.max(40, Math.round(confidence.score * 0.95))
    : null;

  // Potential needs the assembled reading (including the eye area), so it is
  // computed after everything above rather than during it.
  //
  // Potential projects from the FRONTAL score here. When a side photo is present,
  // combineAnalysis() recomputes it from the merged score so the projection and
  // the displayed verdict agree (otherwise a face the profile lifted to "true
  // adam" would be told it is "already at its ceiling" off the lower pre-profile
  // number). See the recompute in combineAnalysis below.
  const potential = computePotential({
    overall,
    gender,
    tier: frontalReadingsValid ? tierFor(overall, gender) : null,
    symmetry,
    golden,
    skinQuality,
    skinAcne,
    faceFat,
    jawline,
    eyeArea,
    frontalMetricsMeasured,
    overallMeasured: frontalReadingsValid,
  });

  // The four strongest features, for the "Your strengths" card next to Potential.
  // Built from the SAME assembled readings as the report, and gated the same way
  // (empty on a profile / no-face scan), so it never praises substituted numbers.
  const strengths = computeStrengths({
    symmetry,
    golden,
    skinQuality,
    skinAcne,
    faceFat,
    jawline,
    eyeArea,
    // The DAMPED eye score, not the raw one: a full face's eye area must not be
    // listed as a headline strength at the same time the report damped it down.
    eyeScore: eyeAreaScore,
    eyeShape,
    confidence,
    lighting,
    frontalMetricsMeasured,
    overallMeasured: frontalReadingsValid,
  });

  console.debug("[analyzeFace]", {
    symmetry: symmetry.toFixed(1),
    golden: golden.toFixed(1),
    rawSymmetry: rawSymmetry.toFixed(1),
    rawGolden: rawGolden.toFixed(1),
    isProfile: profile.isProfile,
    faceFat: faceFat.score.toFixed(1),
    jawline: jawline.score.toFixed(1),
    skinQuality: skinQuality.toFixed(1),
    skinAcne: skinAcne.score.toFixed(1),
    eyeShape: eyeShape.score.toFixed(1),
    eyeArea: eyeArea.score.toFixed(1),
    overall: overall.toFixed(1),
    confidence: confidence.score.toFixed(1),
    lighting: lighting.label,
    // potential.score is null on a profile / no-face scan (see computePotential),
    // so this must not assume a number -- it crashed the whole scan before.
    potential: potential.score === null ? "n/a" : potential.score.toFixed(1),
    gender,
    faceShape,
    isFallback,
  });

  return {
    landmarks,
    symmetry,
    golden,
    faceFat,
    jawline,
    skinQuality,
    skinAcne,
    eyeShape,
    // Full eye-area reading (canthal + projection + eyelid + brow). This is the
    // number that carries WEIGHT_EYE_AREA; eyeShape is kept alongside it so the
    // shape label / EAR / tilt are still available to the UI and the tips.
    //
    // The score shown is the FULLNESS-DAMPED one, so the number on screen matches
    // the verdict. `rawScore` keeps the undamped reading and `fullnessDamp` the
    // points removed, so the adjustment is auditable (and visible in the dev
    // harness) instead of a silent fudge. On a profile / no-face scan the damp is
    // zero, so this object is identical to before for those cases.
    eyeArea: {
      ...eyeArea,
      rawScore: eyeArea.score,
      // Clamp at 0: on a profile / no-face scan the eye score is swapped to the
      // PROFILE_FALLBACK_SCORE, which is HIGHER than the collapsed raw value and
      // would otherwise show as a "negative damp" here -- a display artefact, not
      // a real adjustment. The damp only ever means "points removed", so it is
      // reported as at least zero.
      fullnessDamp: Math.max(0, eyeArea.score - eyeAreaScore),
      // The LABEL is recomputed from the damped score, so the word and the number
      // can never disagree. Without this the card read "Excellent · 72%" on a full
      // face -- the exact word-contradicts-number pattern this whole change exists
      // to remove (the label was still the raw-score verdict).
      label: eyeAreaLabelFor(eyeAreaScore),
      rawLabel: eyeArea.label,
      score: eyeAreaScore,
    },
    harmony,
    // Plain-language reason for each metric's score, keyed by the same names the
    // UI uses. Every reading carries one so a number is never presented without
    // its justification -- the "Jawline 8.7 — strong mandibular width detected"
    // presentation. null values mean the reading wasn't measurable at this angle.
    evidence: {
      jawline: frontalReadingsValid ? jawline.evidence : null,
      faceFat: frontalReadingsValid ? faceFat.evidence : null,
      eyeArea: frontalReadingsValid ? eyeArea.evidence : null,
      symmetry: symmetryEvidence,
      golden: goldenEvidence,
    },
    // Per-metric confidence: how much each reading can be trusted on THIS photo.
    // Driven by the same head-pose / sharpness / face-size signals as the overall
    // landmark confidence, because those affect every landmark-derived reading
    // equally. Skin-only readings are exempt (they do not use paired landmarks),
    // so they keep a flat high confidence. Reported as a percentage next to each
    // score so a wobbly metric is visibly flagged instead of looking as solid as a
    // clean one.
    metricConfidence: {
      jawline: frontalReadingsValid ? metricConfidence : null,
      faceFat: frontalReadingsValid ? metricConfidence : null,
      eyeArea: frontalReadingsValid ? metricConfidence : null,
      symmetry: frontalReadingsValid ? metricConfidence : null,
      golden: frontalReadingsValid ? metricConfidence : null,
      skinQuality: 92,
      skinAcne: 90,
    },
    // Full frontal score. On a profile or a no-face photo this is still returned
    // for continuity, but `frontalMetricsMeasured` is false so the UI does not
    // present it as a frontal verdict.
    overall,
    // Where this face could realistically get to, plus which fixable reading is
    // holding it back most. See computePotential.
    potential,
    // The up-to-four features this face scored highest on, ranked. Empty on a
    // profile / no-face scan (nothing valid to praise). See computeStrengths.
    strengths,
    // Landmark reliability (head pose, sharpness, face size) and the lighting
    // reading. Both are advisory: they never change `overall`, they only tell the
    // UI whether to trust it and whether to ask for a retake.
    confidence,
    lighting,
    gender,
    faceShape,
    canthalTilt,
    sharpness,
    lowQuality,
    profile,
    // Front-vs-side decision from the real 3D depth (+ rotation), separate from
    // the profile-line readings in `profile`. orientation is FRONT / THREE_QUARTER
    // / SIDE_PROFILE / UNKNOWN, with the reason and the raw depth gaps attached so
    // the dev tools (and the UI) can see WHY a frame was classified as it was.
    orientation,
    // Dedicated side-profile metrics (gonial angle, ramus, mandible, eye
    // projection, nose, recessed jaw) when the head is turned, else null. See
    // analyzeSideProfile.
    sideProfile,
    // False when the head was turned enough that frontal symmetry/golden-ratio
    // could not be measured and PROFILE_FALLBACK_SCORE was substituted. The UI
    // uses this to label symmetry/golden as "n/a (profile)" instead of showing
    // a fake number that looks real.
    frontalMetricsMeasured,
    // True when MediaPipe found no mesh at all. Downstream surfaces (UI, tips)
    // must treat this as "cannot measure" rather than as a low score.
    noFace,
    // True when a face WAS located but the head is turned too far to grade -- so
    // the right advice is "this is a profile, use slot 2". Deliberately NOT the
    // same as !frontalReadingsValid: a plain no-face photo (nothing detected at
    // all) must NOT be reported as a side profile, or the UI tells the user to
    // move a non-face into the profile slot. It is true in exactly two cases:
    //   - the mesh failed but the full-range detector found a face (suspectedProfile
    //     local), or
    //   - the mesh succeeded and the classifier says the head is turned.
    suspectedProfile:
      noFace ? suspectedProfile : !frontalReadingsValid,
    detectedBox,
    message: noFace
      ? suspectedProfile
        ? "A face was found, but it was turned too far to measure (looks like a side profile)."
        : "No face detected in this photo."
      : orientation.orientation === "THREE_QUARTER"
        ? "The head is part-way turned (about 3/4). Frontal scores read best straight-on - glance at the camera or move this to slot 2 for the profile report."
        : !frontalReadingsValid
          ? "This looks like a side/profile photo. It can't set your tier - upload a straight-on photo in slot 1, or move this one to slot 2 for the profile report."
          : null,
    isFallback,
    // The tier is only a valid verdict for a real, frontal face. On a profile it
    // would be computed from ALL-substituted fallback values (75/75/75...), which
    // is why a side profile used to read "chad lite" off nothing -- and on a
    // no-face photo it is fabricated entirely. So the tier is returned as null in
    // those cases and the UI shows the appropriate message instead of a grade.
    tier: frontalReadingsValid ? tierFor(overall, gender) : null,
    tierGroup: frontalReadingsValid ? tierGroupFor(overall, gender) : null,
    // Whether `overall`/`tier` describe a real frontal face. False on a profile
    // and on a no-face photo -- the single flag consumers should gate on.
    overallMeasured: frontalReadingsValid,
  };
}
// SIDE-PHOTO entry point. Deliberately produces NO tier.
//
// This is the architectural fix for the "front and side reports pile up" problem.
// A side view cannot be graded on the same scale as a front view: symmetry,
// golden ratio, face-fat and the eye-area readings are all FRONTAL measurements,
// and the only reason the app used to emit a tier for a profile at all was that
// it silently substituted neutral fallback values (75/75/...) for every one of
// them -- which is how a perfectly good side profile ended up labelled "chad
// lite" off nothing.
//
// So the side view has its OWN, separate reading set (the classic profile
// metrics: gonial angle, ramus, mandible, eye projection, nose, profile type)
// and reports those. The overall SCORE and the TIER come exclusively from the
// front photo. The two are then presented as one report with two clearly
// separated halves, which is exactly what "scan both, then decide the tier"
// means in practice.
//
// It still uses the landmark mesh internally (MediaPipe gives a frontal mesh, so
// the profile lines are read off the turned landmarks), and it now benefits from
// the full-range detector as a fallback so a near-true profile that the mesh
// model refuses to lock onto can still be reported as "face found, but too
// turned to mesh precisely" instead of a misleading "no face".
export async function analyzeSidePhoto(imgEl) {
  const w = imgEl.naturalWidth || imgEl.width || 600;
  const h = imgEl.naturalHeight || imgEl.height || 600;

  await prepareImage(imgEl);

  const detection = await detectMesh(imgEl);
  const landmarks = detection.landmarks;
  const noFace = !landmarks;

  // Skin is the one reading that is valid at any head angle (it samples a patch
  // in the image plane, not a left/right landmark pair), so it is measured even
  // when the mesh is missing -- but only for a face the detector can actually
  // locate. Without a mesh there are no reliable patch centres, so it is skipped.
  const skinQuality = !noFace ? computeSkinQuality(imgEl, landmarks, w, h) : null;
  const skinAcne = !noFace ? computeSkinAcne(imgEl, landmarks, w, h) : null;
  const sharpness = computeImageSharpness(imgEl, w, h);
  const lowQuality = sharpness !== null && sharpness < SHARPNESS_WARN_THRESHOLD;

  if (noFace) {
    // No mesh. Was a face even there? The full-range detector is exactly the
    // model for this case, so ask it before claiming there is no face at all.
    const hit = await detectFaceBoxFullRange(imgEl);
    return {
      kind: "side",
      landmarks: null,
      noFace: true,
      faceFound: !!hit,
      detectedBox: hit ? hit.box : null,
      sharpness,
      lowQuality,
      skinQuality,
      skinAcne,
      // Every profile reading is null: there is genuinely nothing to measure.
      profileType: null,
      gonialAngle: null,
      gonialLabel: null,
      ramusRatio: null,
      ramusLabel: null,
      mandibleRatio: null,
      mandibleLabel: null,
      eyeProjection: null,
      eyeProjectionLabel: null,
      noseProjection: null,
      nasolabialAngle: null,
      noseLabel: null,
      profileConfidence: null,
      // Depth-based orientation. With no mesh there is nothing to measure, so this
      // is UNKNOWN with a reason -- deliberately NOT defaulted to "front", which
      // was the bug the robust-fallback change fixes.
      orientation: classifyFaceOrientation(null, detection.rotation),
      chinRecession: null,
      jawRecession: null,
      jawRecessionLabel: null,
      profileVectorAngle: null,
      depthAvailable: false,
      // A full-range hit means a face IS present, just not mesh-able -- that is a
      // very different message from "no face in this photo".
      message: hit
        ? "A face was detected, but it is turned too far for the mesh to measure precisely. A slightly less extreme angle (about 3/4 turn) works better."
        : "No face detected in this photo.",
    };
  }

  // Mesh found. Read the profile from the turned landmarks. analyzeSideProfile is
  // the same routine the old inline profile panel used, so the readings stay
  // comparable with the previous behaviour.
  const profile = analyzeProfile(landmarks, w, h);
  const side = analyzeSideProfile(landmarks, w, h);
  // The same depth-based front-vs-side classifier the front path uses, so a photo
  // in the side slot that is actually straight-on is caught here too (instead of
  // deriving profile numbers from a frontal mesh).
  const orientation = classifyFaceOrientation(landmarks, detection.rotation);

  console.debug("[analyzeSidePhoto]", {
    yaw: profile.yaw.toFixed(3),
    isProfile: profile.isProfile,
    orientation: orientation.orientation,
    noFace,
    gonial: side.gonialAngle.toFixed(1),
    mandible: side.mandibleRatio.toFixed(3),
    jawRecession: side.jawRecession === null ? null : side.jawRecession.toFixed(4),
  });

  return {
    kind: "side",
    landmarks,
    noFace: false,
    faceFound: true,
    detectedBox: null,
    sharpness,
    lowQuality,
    skinQuality,
    skinAcne,
    // Depth-based orientation (front / 3-4 / side / unknown) from the classifier.
    orientation,
    // True when the head was actually turned enough for the profile readings to
    // mean something. A straight-on photo dropped into the side slot gives a low
    // yaw here, and the UI should say so instead of pretending the numbers are
    // profile measurements.
    isProfileish: profile.isProfile,
    yaw: profile.yaw,
    profileType: profile.profileType,
    ...side,
  };
}

// Backwards-compatible alias. The old single-photo API is kept so the dev tools
// (tools/scoringCheck.mjs) and any external caller keep working; it now simply
// forwards to the front-photo path, which is exactly what it always meant.
export async function analyzeFace(imgEl) {
  return analyzeFrontPhoto(imgEl);
}
// --- unified (front + side) analysis ---------------------------------------
//
// THE combined entry point. The user uploads a FRONT photo and a SIDE photo, and
// this returns ONE result object that the UI renders as ONE report.
//
// Design rule, and the whole point of this function: the TIER and the OVERALL
// SCORE come from the front photo alone. The side photo does not get its own
// grade -- it CONTRIBUTES to the reading through the parts a front view cannot
// see (jaw corner sharpness, ramus/mandible build, profile line, nose). That is
// why a profile angle alone is not enough to produce a tier, and why the two
// halves no longer fight each other: they describe different aspects of one face
// and are merged into one verdict.
//
// Merging rules (`profileBonus`):
//   - A strong side profile can ADD a small amount to the frontal score, because
//     a sharp gonial angle / strong mandible is real, visible structure that a
//     front photo genuinely under-reads (the jaw corners sit at a depth angle).
//   - A weak side profile can never SUBTRACT: the frontal readings are the
//     authority on the tier, and a bad profile photo should not punish a face
//     that measured well head-on. It is reported as context, not as a penalty.
//   - The bonus is capped (PROFILE_BONUS_MAX) so the side photo can nudge the
//     reading, never dominate it.
//
// @param front  result of analyzeFrontPhoto (required)
// @param side   result of analyzeSidePhoto, or null when no side photo was given
export function combineAnalysis(front, side) {
  if (!front) return null;

  // No usable side photo -> the combined result IS the front result, with the
  // profile fields explicitly null so the UI knows to show the "add a side photo"
  // affordance rather than empty profile rows.
  const hasProfileReading =
    !!side && !side.noFace && typeof side.gonialAngle === "number";
  if (!hasProfileReading) {
    return {
      ...front,
      side: null,
      hasSide: false,
      profileBonus: 0,
      // With no profile to merge, the "combined" result is just the frontal one,
      // but the combined* fields are still filled in so the UI has ONE place to
      // read the verdict from regardless of how many photos were scanned.
      combinedScore: front.overall,
      combinedTier: front.tier,
      combinedTierGroup: front.tierGroup,
      profileChangedTier: false,
    };
  }

  // --- profile quality -> bonus --------------------------------------------
  // Score the structural things only a profile can show. Each term is 0-1 where
  // 1 is the strong end of the measured range (bands calibrated against the
  // profile test photos: gonial <= 158 deg reads Sharp on this mesh, ramus
  // >= 0.30 is Tall, mandible >= 0.42 is Strong).
  const gonialStrength = clamp01((172 - side.gonialAngle) / (172 - 150));
  const ramusStrength = clamp01((side.ramusRatio - 0.16) / (0.32 - 0.16));
  const mandibleStrength = clamp01((side.mandibleRatio - 0.28) / (0.46 - 0.28));

  // Weights reflect what a profile actually reveals about facial structure: the
  // mandible build and the gonial angle are the two the front view reads worst.
  const profileQuality =
    gonialStrength * 0.4 + mandibleStrength * 0.4 + ramusStrength * 0.2;

  // PROFILE_BONUS_MAX caps how much the side photo can move the number. 6 points
  // is enough to lift a strong face across a tier boundary, but not enough for a
  // profile shot to carry a weak front reading on its own.
  const profileBonus = profileQuality * PROFILE_BONUS_MAX;

  // The combined score: the frontal score (the authority) plus the capped profile
  // contribution. Never below the frontal score -- see the merge rules above.
  const combinedScore = clamp100(front.overall + profileBonus);

  const gender = front.gender || "male";
  const combinedTier = front.overallMeasured ? tierFor(combinedScore, gender) : null;
  const combinedTierGroup = front.overallMeasured
    ? tierGroupFor(combinedScore, gender)
    : null;

  // Re-project potential from the MERGED score, so the potential panel and the
  // verdict can't contradict each other. Without this, a face the profile lifted
  // to "true adam" was still told its potential was "already at your structural
  // ceiling", because potential had been computed inside analyzeFrontPhoto from
  // the lower pre-profile score. The tier-derived fields are recomputed too so
  // everything in the report agrees on one number.
  const recomputedPotential = computePotential({
    ...front,
    overall: combinedScore,
    tier: combinedTier,
    frontalMetricsMeasured: front.frontalMetricsMeasured,
    overallMeasured: front.overallMeasured,
  });

  // Reconcile eye projection. The FRONT reading cannot measure it at all (a
  // frontal mesh has no reliable depth -- see computeEyeArea), so it reports lid
  // coverage instead. The SIDE reading measures it properly. When a side photo
  // exists, the side reading is the authority and the front one defers, which is
  // what stops the report claiming "Excellent eye area" in one section while
  // another section calls the same eye "Deep-set".
  //
  // The SUB-SCORE is re-scored too, not just the label. Swapping only the label
  // left the panel showing "Deep-set" next to a near-perfect 96/100, i.e. a
  // number and a name from two different sources disagreeing about one eye -- the
  // same class of bug this reconciliation exists to remove. A deep-set eye is a
  // legitimate look, so the score is docked only mildly, but it now MOVES with
  // the reading it is labelled with.
  const sideProjectionScore =
    side.eyeProjectionLabel === "Prominent"
      ? 100
      : side.eyeProjectionLabel === "Neutral"
        ? 100
        : 88; // Deep-set: a mild, non-defect deduction
  const reconciledEyeArea = {
    ...front.eyeArea,
    projectionSource: "profile",
    projectionLabel: side.eyeProjectionLabel,
    projectionScore: sideProjectionScore,
    eyeProjection: side.eyeProjection,
    scoreParts: {
      ...front.eyeArea.scoreParts,
      projection: sideProjectionScore,
    },
    // Kept separately so the UI can still show what the front view estimated,
    // clearly marked as the weaker reading.
    frontalProjectionLabel: front.eyeArea.projectionLabel,
    frontalProjectionScore: front.eyeArea.scoreParts.projection,
  };

  // Recompute the composite from the corrected parts. The composite is a weighted
  // blend of its parts capped by the weakest one, so changing a part without
  // re-running that arithmetic would leave the badge showing the OLD number next
  // to the NEW part scores.
  {
    const w = reconciledEyeArea.weights || EYE_AREA_WEIGHTS;
    const parts = reconciledEyeArea.scoreParts;
    // `projection` is included HERE but not in computeEyeArea's own blend: the
    // frontal estimate shared its input with the eyelid score, while this one
    // comes from the side photo and is genuinely independent information.
    const entries = [
      { key: "canthal", value: parts.canthal },
      { key: "projection", value: parts.projection },
      { key: "eyelid", value: parts.eyelid },
      { key: "brow", value: parts.brow },
    ];
    let totalW = 0;
    let weighted = 0;
    for (const e of entries) {
      const weight = w[e.key];
      if (!weight || !Number.isFinite(e.value)) continue;
      totalW += weight;
      weighted += e.value * weight;
    }
    const blended = totalW ? weighted / totalW : reconciledEyeArea.score;
    const weakest = Math.min(
      ...entries.map((e) => (Number.isFinite(e.value) ? e.value : 100))
    );
    const cap =
      (EYE_AREA_REQUIREMENT_CAPS.find((r) => weakest >= r.min) ||
        EYE_AREA_REQUIREMENT_CAPS[EYE_AREA_REQUIREMENT_CAPS.length - 1]).cap;
    reconciledEyeArea.score = clamp100(Math.min(blended, cap));
    reconciledEyeArea.label =
      reconciledEyeArea.score >= 80
        ? "Excellent"
        : reconciledEyeArea.score >= 62
          ? "Good"
          : reconciledEyeArea.score >= 45
            ? "Average"
            : "Weak";
    // The evidence line must describe the RECONCILED parts, not the frontal
    // estimate it was built from, so it is rebuilt here from the corrected
    // numbers rather than being inherited via the spread above.
    const pe = [
      { name: "canthal tilt", v: parts.canthal },
      { name: "projection", v: parts.projection },
      { name: "eyelid exposure", v: parts.eyelid },
      { name: "brow placement", v: parts.brow },
    ].filter((p) => Number.isFinite(p.v));
    const weakPart = pe.reduce((a, b) => (b.v < a.v ? b : a));
    reconciledEyeArea.evidence =
      reconciledEyeArea.score >= 80
        ? "excellent eye area — " + reconciledEyeArea.upperLidExposureLabel.toLowerCase() +
          " lid, " + (side.eyeProjectionLabel || "neutral").toLowerCase() +
          " projection (measured from your side photo)"
        : "eye area held back by " + weakPart.name + " at " + weakPart.v.toFixed(0) +
          "/100 (projection read from your side photo)";
  }

  console.debug("[combineAnalysis]", {
    frontOverall: front.overall.toFixed(1),
    projectionFromProfile: side.eyeProjectionLabel,
    gonialStrength: gonialStrength.toFixed(2),
    mandibleStrength: mandibleStrength.toFixed(2),
    ramusStrength: ramusStrength.toFixed(2),
    profileQuality: profileQuality.toFixed(2),
    profileBonus: profileBonus.toFixed(2),
    combinedScore: combinedScore.toFixed(1),
    frontTier: front.tier,
    combinedTier,
  });

  return {
    ...front,
    // The eye area with its projection reading taken from the side profile, so the
    // report never contradicts itself about the same eye.
    eyeArea: reconciledEyeArea,
    // The evidence map came from the front scan, so its eyeArea entry is the
    // frontal estimate. Re-point it at the reconciled reading, otherwise the
    // explanation text would describe numbers the panel no longer shows.
    evidence: {
      ...front.evidence,
      eyeArea: reconciledEyeArea.evidence,
    },
    // The profile half, for the UI's "what the side view added" section.
    side,
    hasSide: true,
    // Potential, re-projected from the merged score (see the note above).
    potential: recomputedPotential,
    profileQuality,
    profileBonus,
    // The single merged result the report shows.
    combinedScore,
    combinedTier,
    combinedTierGroup,
    // Whether the side photo changed the tier -- the one genuinely interesting
    // thing about the merge, so it is precomputed for the UI copy.
    profileChangedTier: combinedTier !== front.tier,
  };
}

// Convenience wrapper: run both photos and merge, in the right order.
// `sideImgEl` may be null/undefined for a front-only scan.
export async function analyzeFaceWithProfile(frontImgEl, sideImgEl) {
  const front = await analyzeFrontPhoto(frontImgEl);
  let side = null;
  if (sideImgEl) {
    try {
      side = await analyzeSidePhoto(sideImgEl);
    } catch (err) {
      console.warn("side photo analysis failed:", err);
    }
  }
  return combineAnalysis(front, side);
}
