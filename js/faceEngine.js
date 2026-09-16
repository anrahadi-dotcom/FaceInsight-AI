import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

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
  [234, 454],  // jaw/temple width
];

const MIDLINE_TOP = 10;    // forehead
const MIDLINE_BOTTOM = 152; // chin
const SCALE_LEFT = 33;
const SCALE_RIGHT = 263;

let faceLandmarker = null;
let loadingPromise = null;

export function ensureLandmarker() {
  if (faceLandmarker) return Promise.resolve(faceLandmarker);
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      numFaces: 1,
    });
    return faceLandmarker;
  })();

  return loadingPromise;
}

export function tierFor(score) {
  if (score >= 88) return "mogger";
  if (score >= 75) return "chad";
  if (score >= 60) return "above average";
  if (score >= 40) return "average";
  return "needs work";
}

function toPixels(landmark, w, h) {
  return { x: landmark.x * w, y: landmark.y * h };
}

// Reflects point P across the line through A and B.
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

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeSymmetryScore(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const axisA = px(MIDLINE_TOP);
  const axisB = px(MIDLINE_BOTTOM);
  const scale = dist(px(SCALE_LEFT), px(SCALE_RIGHT));

  let totalDeviation = 0;
  for (const [li, ri] of SYMMETRY_PAIRS) {
    const l = px(li);
    const r = px(ri);
    const rReflected = reflectAcrossLine(r, axisA, axisB);
    totalDeviation += dist(l, rReflected) / scale;
  }
  const avgDeviation = totalDeviation / SYMMETRY_PAIRS.length;

  // Heuristic mapping, not scientifically calibrated -- treat as relative,
  // not absolute (see frontend/app.js in the sibling standalone demo for
  // the same constant and rationale).
  const score = 100 - avgDeviation * 220;
  return Math.max(0, Math.min(100, score));
}

function computeGoldenRatioScore(landmarks, w, h) {
  const px = (i) => toPixels(landmarks[i], w, h);
  const faceLength = dist(px(MIDLINE_TOP), px(MIDLINE_BOTTOM));
  const faceWidth = dist(px(234), px(454)); // jaw/temple width

  if (faceWidth === 0) return 0;
  const ratio = faceLength / faceWidth;
  const target = 1.618;
  const deviation = Math.abs(ratio - target) / target;

  const score = 100 - deviation * 150;
  return Math.max(0, Math.min(100, score));
}

// Runs detection + scoring on an already-loaded <img> element.
// Returns null if no face was found.
export async function analyzeFace(imgEl) {
  const landmarker = await ensureLandmarker();

  if (imgEl.decode) {
    try {
      await imgEl.decode();
    } catch {
      // Some browsers throw if the image is already decoded/detached;
      // detect() below will fail loudly on a genuinely bad image anyway.
    }
  }

  const w = imgEl.naturalWidth || imgEl.width;
  const h = imgEl.naturalHeight || imgEl.height;

  const result = landmarker.detect(imgEl);
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return null;
  }

  const landmarks = result.faceLandmarks[0];
  const symmetry = computeSymmetryScore(landmarks, w, h);
  const golden = computeGoldenRatioScore(landmarks, w, h);
  const overall = (symmetry + golden) / 2;

  return { symmetry, golden, overall, tier: tierFor(overall) };
}
