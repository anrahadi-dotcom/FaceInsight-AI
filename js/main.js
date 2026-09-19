import {
  analyzeFrontPhoto,
  analyzeSidePhoto,
  combineAnalysis,
  tierFor,
  tiersFor,
  ModelLoadError,
  clearNasolabialAngleFromSide,
} from "./faceEngine.js";
import { createScale, setScaleValue, renderTicks } from "./scale.js";
import { tipsForAnalysis, tipsHeadingFor } from "./tips.js";
import { initUI, showToast } from "./ui/index.js";
import { printScanReport } from "./report-export.js";
import { onConnectionChange, connectionNotice } from "./connectivity.js";
// Hairstyle advice, now rendered INSIDE the scan result from the scan's own
// analysis (no second upload, no second model run). renderHairPlan(analysis) fills
// the #scanHairPanel placed above Scan reliability; it is a no-op if that panel is
// absent, so this import is safe.
import { renderHairPlan } from "./hairstyle-ui.js";

// Initialize UI chrome (nav sticky/drawer, reveal animations, stat counters, FAQ
// accordion, card spotlight, footer year). This runs EXACTLY ONCE.
//
// The old version called initUI() from both the DOMContentLoaded listener and an
// `if (document.readyState !== "loading")` guard. A <script type="module"> runs
// after the HTML is parsed, so readyState is already "interactive" when this file
// executes -- the guard fired immediately AND DOMContentLoaded fired again a
// moment later. initUI() therefore ran twice, binding every handler twice: the
// nav toggle and each FAQ button had two click listeners, so one click toggled
// open then immediately closed again and nothing appeared to happen. Binding
// once fixes both the mobile menu and the FAQ accordion.
let uiInitialized = false;
function initOnce() {
  if (uiInitialized) return;
  uiInitialized = true;
  initUI();
  initHeroCardAnimation();
  initReportSection();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOnce);
} else {
  initOnce();
}

let currentGender = "male";

const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const uploadBox = document.getElementById("uploadBox");
const uploadStack = document.getElementById("uploadStack");
const fileNameEl = document.getElementById("fileName");
const clearImageBtn = document.getElementById("clearImage");

// Explicit "is a photo loaded" state for each slot.
//
// WHY: the old check was `preview.src && preview.src !== window.location.href`,
// which is FRAGILE. An empty <img> resolves `src` to the document URL, and that
// only equals `window.location.href` when the URL is EXACTLY the document URL.
// Click any in-page nav link first (e.g. #features) and `location.href` gains a
// hash, so the empty preview's src no longer matches it -- and an EMPTY slot is
// then treated as having a photo. The scan runs on a zero-size image and throws
// (the reported "upload error" + the scan that never finishes). Tracking loaded
// state as a boolean removes the URL-string comparison entirely.
let hasFrontPhoto = false;
let hasSidePhoto = false;

// Side-photo slot (optional). Produces the profile report only -- never a tier.
const sideImageInput = document.getElementById("sideImageInput");
const sidePreview = document.getElementById("sidePreview");
const sideUploadBox = document.getElementById("sideUploadBox");
const sideFileNameEl = document.getElementById("sideFileName");
const clearSideImageBtn = document.getElementById("clearSideImage");
const analyzeBtn = document.getElementById("analyze-btn");
const resetBtn = document.getElementById("resetBtn");
const loading = document.getElementById("loading");
const progress = document.querySelector(".progress");
const loadingText = document.getElementById("loading-text");
const photoScanOverlay = document.getElementById("photoScanOverlay");
const photoScanBadge = document.getElementById("photoScanBadge");
// The side slot gets the same scan effect, in the violet/indigo the palette
// reserves for the profile pass. It runs during the SECOND phase of the scan,
// so the two slots visibly show which photo is being read at each moment
// instead of the front slot animating for the whole duration.
const sideScanOverlay = document.getElementById("sideScanOverlay");
const sideScanBadge = document.getElementById("sideScanBadge");

const scanStatus = document.getElementById("scan-status");
const scanResults = document.getElementById("scanResults");
const scanOverallScoreEl = document.getElementById("scanOverallScore");
const scanTierEl = document.getElementById("scanTier");
const scanSymmetryScoreEl = document.getElementById("scanSymmetryScore");
const scanGoldenScoreEl = document.getElementById("scanGoldenScore");
const scanFaceShapeEl = document.getElementById("scanFaceShape");
const scanCanthalTiltEl = document.getElementById("scanCanthalTilt");
const scanHarmonyEl = document.getElementById("scanHarmony");
const scanSkinQualityEl = document.getElementById("scanSkinQuality");
const scanSkinAcneEl = document.getElementById("scanSkinAcne");
const scanFaceFatEl = document.getElementById("scanFaceFat");
const scanJawlineEl = document.getElementById("scanJawline");
const scanEyeShapeEl = document.getElementById("scanEyeShape");
// Nose: the score cell plus the shape name beneath it.
const scanNoseEl = document.getElementById("scanNose");
const scanNoseShapeEl = document.getElementById("scanNoseShape");
const scanProfileEl = document.getElementById("scanProfile");
const scanTierValueEl = document.getElementById("scanTier");

// Eye-area composite
const scanEyeAreaValueEl = document.getElementById("scanEyeAreaValue");

// Evidence ("why") lines -- the plain-language reason behind each metric.
const scanSymmetryWhyEl = document.getElementById("scanSymmetryWhy");
const scanGoldenWhyEl = document.getElementById("scanGoldenWhy");
const scanFaceFatWhyEl = document.getElementById("scanFaceFatWhy");
const scanJawlineWhyEl = document.getElementById("scanJawlineWhy");
const scanEyeAreaWhyEl = document.getElementById("scanEyeAreaWhy");
const scanEyeCanthalEl = document.getElementById("scanEyeCanthal");
const scanEyeProjectionEl = document.getElementById("scanEyeProjection");
const scanEyeEyelidEl = document.getElementById("scanEyeEyelid");
const scanEyeBrowEl = document.getElementById("scanEyeBrow");
const scanEyeCanthalBar = document.getElementById("scanEyeCanthalBar");
const scanEyeProjectionBar = document.getElementById("scanEyeProjectionBar");
const scanEyeEyelidBar = document.getElementById("scanEyeEyelidBar");
const scanEyeBrowBar = document.getElementById("scanEyeBrowBar");
const scanEyeLidExposureEl = document.getElementById("scanEyeLidExposure");
const scanEyeScleralEl = document.getElementById("scanEyeScleral");
const scanEyeIntercanthalEl = document.getElementById("scanEyeIntercanthal");
const scanEyeBrowDistEl = document.getElementById("scanEyeBrowDist");

// Combined-verdict additions
const scanVerdictRing = document.getElementById("scanVerdictRing");
const scanSourcesEl = document.getElementById("scanSources");
const scanVerdictNoteEl = document.getElementById("scanVerdictNote");
const scanMergePanel = document.getElementById("scanMergePanel");
const scanMergeTier = document.getElementById("scanMergeTier");
const scanMergeNote = document.getElementById("scanMergeNote");
const scanMergeGonialEl = document.getElementById("scanMergeGonial");
const scanMergeMandibleEl = document.getElementById("scanMergeMandible");
const scanMergeRamusEl = document.getElementById("scanMergeRamus");
const scanMergeGonialBar = document.getElementById("scanMergeGonialBar");
const scanMergeMandibleBar = document.getElementById("scanMergeMandibleBar");
const scanMergeRamusBar = document.getElementById("scanMergeRamusBar");
const scanSideProfileTypeEl = document.getElementById("scanSideProfileType");

// Potential
const scanPotentialScoreEl = document.getElementById("scanPotentialScore");
const scanPotentialTierEl = document.getElementById("scanPotentialTier");
const scanPotentialNoteEl = document.getElementById("scanPotentialNote");

// Strengths (the card opposite Potential)
const scanStrengthListEl = document.getElementById("scanStrengthList");
const scanStrengthCountEl = document.getElementById("scanStrengthCount");
const scanStrengthPanel = document.getElementById("scanStrengthPanel");

// What's holding your potential (below the potential/strengths pair)
const scanLimitsPanel = document.getElementById("scanLimitsPanel");
const scanLimitsListEl = document.getElementById("scanLimitsList");
const scanLimitsCountEl = document.getElementById("scanLimitsCount");

// Scan reliability
const scanReliabilityBadge = document.getElementById("scanReliabilityBadge");
const scanConfidenceEl = document.getElementById("scanConfidence");
const scanLightingEl = document.getElementById("scanLighting");
const scanSharpnessEl = document.getElementById("scanSharpness");
const scanHeadPoseEl = document.getElementById("scanHeadPose");
const scanIrisEl = document.getElementById("scanIris");
const scanQualityNoteEl = document.getElementById("scanQualityNote");
const scanSideProfilePanel = document.getElementById("scanSideProfilePanel");
const scanSideConfidenceEl = document.getElementById("scanSideConfidence");
const scanSideHintEl = document.getElementById("scanSideHint");
const scanSideGonialEl = document.getElementById("scanSideGonial");
const scanSideRamusEl = document.getElementById("scanSideRamus");
const scanSideMandibleEl = document.getElementById("scanSideMandible");
const scanSideEyeProjectionEl = document.getElementById("scanSideEyeProjection");
const scanSideNoseEl = document.getElementById("scanSideNose");
const scanTipsHeadingEl = document.getElementById("scanTipsHeading");
const scanTipsListEl = document.getElementById("scanTipsList");

const overallScaleEl = document.getElementById("scanOverallScale");
const symmetryScaleEl = document.getElementById("scanSymmetryScale");
const goldenScaleEl = document.getElementById("scanGoldenScale");

let scanOverallMarker, scanOverallTicksEl, scanSymmetryMarker, scanGoldenMarker;

if (overallScaleEl) {
  const scaleObj = createScale(overallScaleEl, {
    ticks: tiersFor(currentGender),
    tierForFn: (score) => tierFor(score, currentGender),
  });
  scanOverallMarker = scaleObj.marker;
  scanOverallTicksEl = scaleObj.ticksEl;
}

if (symmetryScaleEl) {
  const scaleObj = createScale(symmetryScaleEl, {
    tierForFn: (score) => tierFor(score, currentGender),
  });
  scanSymmetryMarker = scaleObj.marker;
}

if (goldenScaleEl) {
  const scaleObj = createScale(goldenScaleEl, {
    tierForFn: (score) => tierFor(score, currentGender),
  });
  scanGoldenMarker = scaleObj.marker;
}

// ------------------------------------------------------------------ Connectivity strip
//
// A slim strip that appears only when the browser goes offline, saying which
// mode the app is in. Without it, a user who pulls the plug and runs a scan that
// SUCCEEDS (model served from cache) sees nothing change and assumes the offline
// handling is missing. The strip is what makes that case legible.
//
// It never blocks a scan: it reports, it does not prevent. Blocking a scan that
// would have worked is a worse failure than letting one run.
(function initConnectivityStrip() {
  const strip = document.getElementById("connectivityStrip");
  if (!strip) return;

  const textEl = strip.querySelector(".conn-strip__text");

  onConnectionChange(function (state) {
    const notice = connectionNotice(state);
    if (!notice) {
      strip.classList.remove("is-visible", "is-warn");
      document.body.classList.remove("has-conn-strip");
      window.setTimeout(() => {
        if (!strip.classList.contains("is-visible")) strip.hidden = true;
      }, 250);
      return;
    }

    if (textEl) textEl.textContent = notice.text;
    strip.hidden = false;
    strip.classList.toggle("is-warn", notice.tone === "warn");
    document.body.classList.add("has-conn-strip");
    // Next frame so the entrance transition runs.
    window.requestAnimationFrame(() => strip.classList.add("is-visible"));
  });
})();

// ------------------------------------------------------------------ Image Preview & Upload

function showPreview(file) {
  if (!file) return;

  const url = URL.createObjectURL(file);
  preview.src = url;
  hasFrontPhoto = true;
  if (uploadBox) uploadBox.classList.add("has-image");
  if (uploadStack) uploadStack.classList.add("has-image");

  clearLandmarkCanvas();

  if (fileNameEl) {
    fileNameEl.textContent = file.name;
  }

  if (analyzeBtn) {
    analyzeBtn.disabled = false;
    analyzeBtn.classList.remove("disabled");
    analyzeBtn.innerHTML = `
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="4.2" />
      </svg>
      <span>Analyze my face</span>
    `;
  }

  if (resetBtn) {
    resetBtn.hidden = false;
    resetBtn.style.display = "inline-flex";
  }

  if (scanResults) {
    scanResults.classList.remove("is-visible");
    scanResults.classList.remove("visible");
    scanResults.classList.add("hidden");
    scanResults.style.display = "none";
  }

  if (scanStatus) {
    scanStatus.textContent = "";
    // Remove EVERY state class, not just is-visible. Leaving is-note/is-side-only
    // behind kept the amber styling attached to the element, so a later message
    // inherited colours from a state that no longer applied.
    scanStatus.classList.remove("is-visible", "is-note", "is-side-only");
    // The front photo is present now, so the side-only blocker no longer
    // applies -- drop the guard's ownership flag so it can't linger.
    delete scanStatus.dataset.source;
  }

  updateSideOnlyGuard();

  showToast(`Front photo "${file.name}" loaded`, "info");
}

// ------------------------------------------------------------------ Side-only guard
// The tier and the score can ONLY come from the front photo: a profile has no
// mirrored pairs to measure symmetry from and no frontal width ratios to run the
// golden-ratio pass on. So a side-only session cannot produce a grade at all.
//
// Previously that was true but SILENT: the Analyze button simply sat disabled
// with no explanation, so a user who dropped in a profile shot first had no way
// to know why nothing was happening or what to do about it. This makes the
// blocker explicit and actionable.

// Steers the user back to the front slot and to itself as the target of the
// "open slot 1" affordance.
const sideNeedsFrontBtn = document.getElementById("sideNeedsFront");
const sideTagNoteEl = document.querySelector(".photo-slot--side .photo-slot__tag em");

if (sideNeedsFrontBtn) {
  sideNeedsFrontBtn.addEventListener("click", function () {
    if (frontSlot) {
      frontSlot.scrollIntoView({ behavior: "smooth", block: "center" });
      // Move the caret, not just the viewport: focusing the slot means the user
      // can press Enter to open the picker without hunting for the box.
      const box = document.getElementById("uploadBox");
      // Focus WITHOUT the visible ring. The ring is a keyboard affordance, and
      // lighting it up on a pointer click left slot 1 outlined in cyan for the
      // rest of the session -- so during a later scan the FRONT slot looked
      // active while the SIDE overlay was the one animating. A blurred focus
      // keeps the keyboard behaviour and drops the false signal.
      if (box) box.focus({ preventScroll: true, focusVisible: false });
    }
    showToast("Add your front photo in slot 1 to get a tier", "info");
  });
}

// A pointer press anywhere else takes the stray focus ring off the front slot.
// Without this, clicking into the page never dismissed it, because the focused
// element was a <label> with tabindex, not something the click landed on.
document.addEventListener(
  "pointerdown",
  function (event) {
    const box = document.getElementById("uploadBox");
    if (!box || !box.contains(event.target)) {
      // Only blur if the front slot is the one holding focus.
      if (document.activeElement === box) box.blur();
    }
  },
  true
);

// Shown once the user has supplied a side photo and still has no front photo.
// The side overlay's animation is a 3s loop. If analyzeSidePhoto() resolves
// faster than that -- which it does on a small or already-decoded image -- the
// overlay appears and vanishes inside one frame, so the user never sees the
// effect they were meant to see. Holding it open for a floor of one full
// animation cycle means the sweep always reads as a sweep. The scan result is
// NOT delayed by this: the report renders when it is ready, and this only caps
// how briefly the decoration may flash.
const SIDE_OVERLAY_MIN_MS = 1100;

// Hard ceiling on a single model call. MediaPipe's loader can sit unresolved
// forever when its WASM bundle is blocked or half-downloaded -- neither resolving
// nor rejecting -- which left the scan parked at 95% with the spinner running and
// the button dead, the worst failure mode the app had. A timeout turns that
// silent hang into a normal, reportable error.
//
// 25s is chosen deliberately: a genuine first load over a slow connection can
// take 15-20s, so a shorter limit would abort scans that were about to succeed.
const MODEL_CALL_TIMEOUT_MS = 25000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ModelLoadError(
          "blocked",
          new Error(`${label} did not respond within ${ms}ms`)
        )
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function holdSideOverlay(startedAt) {
  const elapsed = Date.now() - startedAt;
  const remaining = SIDE_OVERLAY_MIN_MS - elapsed;
  return remaining > 0 ? new Promise((r) => setTimeout(r, remaining)) : Promise.resolve();
}

const SIDE_ONLY_WARNING =
  "⚠️ A side profile can't be rated — it has no front-facing geometry to measure " +
  "symmetry or the golden ratio against. Add your FRONT photo in slot 1 to get a " +
  "score and a tier; the side photo then adds the profile analysis on top.";

function setSideOnlyWarning(on) {
  if (!scanStatus) return;
  // Never clobber a scan result message (e.g. "no face detected") that the user
  // still needs to read -- this is a precondition hint, not a verdict, so it
  // yields to anything the scanner has already said (until a slot changes).
  if (on && scanStatus.dataset.source === "scan") return;
  // Same courtesy in reverse: a scan message on screen means the message slot is
  // already answering the user, so a no-op recompute must not blank it.
  if (!on && scanStatus.dataset.source === "scan") return;

  if (on) {
    scanStatus.textContent = SIDE_ONLY_WARNING;
    scanStatus.classList.add("is-visible", "is-note", "is-side-only");
    scanStatus.dataset.source = "guard";
  } else {
    // Only the guard clears its own message; a scan-owned message stays put.
    // The state classes are wiped regardless of who owns the text, so a stale
    // is-note/is-side-only can never recolour a later scan message.
    if (scanStatus.dataset.source === "guard") scanStatus.textContent = "";
    scanStatus.classList.remove("is-visible", "is-note", "is-side-only");
    delete scanStatus.dataset.source;
  }
}

// Recompute the guard from the two slot flags. Called on every change to either
// slot, and after a scan finishes (which is when a mis-slotted profile photo
// gets detected and moves the goalposts).
function updateSideOnlyGuard() {
  const sideOnly = hasSidePhoto && !hasFrontPhoto;
  setSideOnlyWarning(sideOnly);

  // The button is the loudest, most local version of the same message: it sits
  // in the side slot itself, where the user just acted, and clicking it moves
  // them to the control they actually need.
  if (sideNeedsFrontBtn) sideNeedsFrontBtn.hidden = !sideOnly;

  // "The front photo is what sets your tier" is already in the label, so it is
  // switched to explicit not-rated-without-one wording at the exact moment that
  // becomes true.
  if (sideTagNoteEl) {
    sideTagNoteEl.textContent = sideOnly
      ? "not rated on its own · needs a front photo"
      : "optional · unlocks the profile report";
  }

  // The disabled button gets a reason too, so "why can't I click this?" is
  // answered on the control itself and not only in the banner below it.
  if (analyzeBtn && !hasFrontPhoto) {
    analyzeBtn.title = hasSidePhoto
      ? "A front photo is required — a side profile can't be rated"
      : "Add a front photo to enable the scan";
    analyzeBtn.setAttribute(
      "aria-label",
      hasSidePhoto
        ? "Analyze my face — disabled: a front photo is required to rate a face"
        : "Analyze my face — disabled: add a front photo first"
    );
  } else if (analyzeBtn) {
    analyzeBtn.removeAttribute("title");
    analyzeBtn.removeAttribute("aria-label");
  }
}

// Side-photo slot. Unlike the front slot this does NOT arm/disable the analyze
// button: the front photo is what the scan requires, so arming is driven purely
// by the front slot (see showPreview above). A side photo is purely additive.
function showSidePreview(file) {
  if (!file || !sidePreview) return;

  const url = URL.createObjectURL(file);
  sidePreview.src = url;
  hasSidePhoto = true;
  if (sideUploadBox) sideUploadBox.classList.add("has-image");
  if (sideFileNameEl) sideFileNameEl.textContent = file.name;

  // A loaded/removed side photo invalidates any existing report, so collapse the
  // results until the user scans again -- otherwise the profile half would show
  // numbers for a photo that is no longer selected.
  if (scanResults) {
    scanResults.classList.remove("is-visible", "visible");
    scanResults.classList.add("hidden");
    scanResults.style.display = "none";
  }
  if (resetBtn) {
    resetBtn.hidden = false;
    resetBtn.style.display = "inline-flex";
  }

  // A side photo on its own cannot produce a rating, so say that immediately
  // rather than letting the user wonder why Analyze never becomes clickable.
  updateSideOnlyGuard();

  showToast(`Side photo "${file.name}" loaded`, "info");
}

function clearSidePhoto() {
  if (sideImageInput) sideImageInput.value = "";
  if (sidePreview) sidePreview.src = "";
  hasSidePhoto = false;
  if (sideUploadBox) sideUploadBox.classList.remove("has-image");
  if (sideFileNameEl) sideFileNameEl.textContent = "";
  updateSideOnlyGuard();
}

function clearLandmarkCanvas() {
  const canvas = document.getElementById("landmarkCanvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawLandmarksOnCanvas(landmarks) {
  const canvas = document.getElementById("landmarkCanvas");
  if (!canvas || !preview) return;

  const rect = preview.getBoundingClientRect();
  const width = preview.naturalWidth || rect.width || 600;
  const height = preview.naturalHeight || rect.height || 600;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  if (!landmarks || !landmarks.length) return;

  // Draw connecting feature contours.
  // Neon cyan (#00F0FF) for the mesh lines: it is the one hue that stays
  // readable on top of every skin tone, which is exactly why the palette
  // reserves it for the canvas overlay rather than general UI chrome.
  ctx.strokeStyle = "rgba(0, 240, 255, 0.5)";
  ctx.lineWidth = Math.max(1.2, width / 450);
  ctx.shadowColor = "rgba(0, 240, 255, 0.55)";
  ctx.shadowBlur = 3;

  const eyeLeft = [33, 160, 158, 133, 153, 144, 33];
  const eyeRight = [362, 385, 387, 263, 373, 380, 362];
  const noseBridge = [168, 6, 197, 195, 5, 4, 1];
  const lipsOuter = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];

  [eyeLeft, eyeRight, noseBridge, lipsOuter].forEach((path) => {
    ctx.beginPath();
    path.forEach((idx, i) => {
      const pt = landmarks[idx];
      if (pt) {
        const x = pt.x * width;
        const y = pt.y * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  });

  // Draw glowing dots for landmarks
  landmarks.forEach((pt, i) => {
    const x = pt.x * width;
    const y = pt.y * height;

    if (i % 3 === 0 || [33, 133, 263, 362, 1, 61, 291, 10, 152, 116, 345].includes(i)) {
      // Anchor points glow in Emerald (#10B981), the rest of the mesh in neon
      // cyan. Two brightness levels keep the anchors findable in a dense cloud
      // without leaving the palette.
      ctx.fillStyle = i % 10 === 0 ? "#10b981" : "#00f0ff";
      ctx.shadowColor = i % 10 === 0 ? "rgba(16, 185, 129, 0.85)" : "rgba(0, 240, 255, 0.85)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, width / 350), 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  ctx.shadowBlur = 0;
}

function resetScanner(message = "Scanner reset") {
  if (imageInput) imageInput.value = "";
  if (preview) preview.src = "";
  hasFrontPhoto = false;
  if (uploadBox) uploadBox.classList.remove("has-image");
  if (uploadStack) uploadStack.classList.remove("has-image");
  if (fileNameEl) fileNameEl.textContent = "";

  // Reset clears BOTH slots -- "Reset" means start over, and leaving a stale side
  // photo selected would silently attach a profile report to the next scan.
  clearSidePhoto();

  clearLandmarkCanvas();

  if (photoScanOverlay) {
    photoScanOverlay.classList.add("hidden");
  }
  // A reset must also stop the side beam -- otherwise a leftover running
  // animation sits over a slot whose photo has just been cleared.
  if (sideScanOverlay) {
    sideScanOverlay.classList.add("hidden");
  }

  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = `
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="4.2" />
      </svg>
      <span>Analyze my face</span>
    `;
  }

  if (resetBtn) {
    resetBtn.hidden = true;
    resetBtn.style.display = "none";
  }

  if (scanResults) {
    scanResults.classList.remove("is-visible");
    scanResults.classList.remove("visible");
    scanResults.classList.add("hidden");
    scanResults.style.display = "none";
  }

    if (scanStatus) {
      scanStatus.textContent = "";
      scanStatus.classList.remove("is-visible");
      delete scanStatus.dataset.source;
    }

    // resetScanner() clears BOTH slots (see the clearSidePhoto call above), so
    // this lands on a blank scanner. Run the guard anyway: it clears any stale
    // side-only banner and gives the now-disabled button the "add a front
    // photo" reason instead of leaving it dead and unexplained.
    updateSideOnlyGuard();

    // Collapse the profile panel too, so a fresh scan never opens with the previous
    // side photo's numbers still on screen.
    if (scanSideProfilePanel) scanSideProfilePanel.classList.add("hidden");

    if (loading) {
      loading.style.display = "none";
      loading.classList.remove("is-active");
    }

    if (message) {
      showToast(message, "info");
    }
  }

if (imageInput) {
  imageInput.addEventListener("change", function () {
    const file = imageInput.files[0];
    if (file) showPreview(file);
  });
}

// Side slot: change input, its own clear button, and drag & drop. Kept entirely
// separate from the front slot so each box has independent state.
if (sideImageInput) {
  sideImageInput.addEventListener("change", function () {
    const file = sideImageInput.files[0];
    if (file) showSidePreview(file);
  });
}

if (clearSideImageBtn) {
  clearSideImageBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    clearSidePhoto();
    showToast("Side photo removed", "info");
  });
}

if (sideUploadBox) {
  ["dragenter", "dragover"].forEach((evt) => {
    sideUploadBox.addEventListener(evt, function (e) {
      e.preventDefault();
      sideUploadBox.classList.add("drag-active", "is-dragging");
    });
  });

  ["dragleave", "dragend"].forEach((evt) => {
    sideUploadBox.addEventListener(evt, function () {
      sideUploadBox.classList.remove("drag-active", "is-dragging");
    });
  });

  sideUploadBox.addEventListener("drop", function (e) {
    e.preventDefault();
    sideUploadBox.classList.remove("drag-active", "is-dragging");

    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) {
      showToast("Please drop a valid image file (JPG/PNG)", "error");
      return;
    }

    if (sideImageInput) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      sideImageInput.files = dataTransfer.files;
    }
    showSidePreview(file);
  });
}

if (clearImageBtn) {
  clearImageBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    resetScanner("Photo removed");
  });
}

if (resetBtn) {
  resetBtn.addEventListener("click", function (e) {
    e.preventDefault();
    resetScanner("Scanner reset");
  });
}

// Drag & drop highlight & drop handler
if (uploadBox) {
  ["dragenter", "dragover"].forEach((evt) => {
    uploadBox.addEventListener(evt, function (e) {
      e.preventDefault();
      uploadBox.classList.add("drag-active");
      uploadBox.classList.add("is-dragging");
    });
  });

  ["dragleave", "dragend"].forEach((evt) => {
    uploadBox.addEventListener(evt, function () {
      uploadBox.classList.remove("drag-active");
      uploadBox.classList.remove("is-dragging");
    });
  });

  uploadBox.addEventListener("drop", function (e) {
    e.preventDefault();
    uploadBox.classList.remove("drag-active");
    uploadBox.classList.remove("is-dragging");

    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) {
      showToast("Please drop a valid image file (JPG/PNG)", "error");
      return;
    }

    if (imageInput) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      imageInput.files = dataTransfer.files;
    }
    showPreview(file);
  });
}

// ------------------------------------------------------------------ Face Analysis Action

if (analyzeBtn) {
  analyzeBtn.addEventListener("click", async function () {
    // Tracked explicitly (see hasFrontPhoto) -- NO comparison against
    // window.location.href, which broke as soon as the URL carried a hash.
    const hasImage = hasFrontPhoto;

    if (!hasImage) {
      // The button is disabled in this state, so reaching here means the click
      // came from an assistive technology or a script. Either way the reason is
      // the same, and it is not "you forgot to upload" when a side photo sits
      // right there on screen.
      showToast(
        hasSidePhoto
          ? "A side profile can't be rated — add a front photo in slot 1"
          : "Please select or drop a photo first",
        "error"
      );
      updateSideOnlyGuard();
      return;
    }

    if (loading) {
      loading.style.display = "flex";
      loading.classList.add("is-active");
    }

    if (scanStatus) scanStatus.textContent = "";

    // FRONT overlay on for phase 1. The side overlay stays hidden until the
    // scan actually reaches the profile photo (below), so the user can see
    // which of their two photos is being read right now.
    if (photoScanOverlay) {
      photoScanOverlay.classList.remove("hidden");
      photoScanOverlay.style.opacity = "1";
    }
    if (sideScanOverlay) {
      sideScanOverlay.classList.add("hidden");
      sideScanOverlay.style.opacity = "1";
    }

    if (photoScanBadge) {
      photoScanBadge.textContent = "Scanning landmarks...";
    }
    if (sideScanBadge) {
      sideScanBadge.textContent = "Reading profile line...";
    }

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Scanning face...";

    let percent = 0;
    const interval = setInterval(function () {
      percent += 2;
      if (percent > 95) percent = 95;

      if (progress) progress.style.width = percent + "%";
      if (loadingText) {
        // Past 80% the side photo is the one being measured, so the badges hand
      // over at the same moment the beam does. Keeping the front badge reading
      // "generating report" while the side slot is animating would contradict
      // what is on screen.
      if (percent < 25) {
          loadingText.textContent = `📷 Reading image... ${percent}%`;
          if (photoScanBadge) photoScanBadge.textContent = "Reading image pixels...";
        } else if (percent < 55) {
          loadingText.textContent = `🔍 Detecting landmarks... ${percent}%`;
          if (photoScanBadge) photoScanBadge.textContent = "Mapping 478 landmarks...";
        } else if (percent < 80) {
          loadingText.textContent = `📐 Measuring symmetry... ${percent}%`;
          if (photoScanBadge) photoScanBadge.textContent = "Measuring symmetry & ratio...";
        } else {
          loadingText.textContent = `🧠 Generating AI report... ${percent}%`;
          if (photoScanBadge) photoScanBadge.textContent = "Front pass complete";
          if (sideScanBadge && sideScanOverlay && !sideScanOverlay.classList.contains("hidden")) {
            sideScanBadge.textContent = "Measuring gonial · ramus · mandible...";
          }
        }
      }
    }, 35);

    // SCAN ORDER MATTERS: the front photo is scanned first and is the ONLY source
    // of the score and the tier. The side photo is scanned after it and produces
    // the profile half of the report, never a grade. Doing it in this order is
    // what keeps the two from tangling: if the front scan fails there is no tier
    // to confuse with profile numbers, and the side scan can be skipped entirely
    // rather than run against a photo that isn't a profile.
    let analysis = null;
    let sideAnalysis = null;
    // Tracked explicitly (see hasSidePhoto). The old src-vs-location.href check
    // could report a phantom side photo after the URL gained a hash.
    const hasSide = hasSidePhoto;
    // EVERYTHING from here to the finally is inside ONE try. This is the fix for
    // the "stuck at 95%": previously only the two analyze* calls were guarded, so
    // any throw in between -- most of all combineAnalysis(), which was NOT wrapped
    // -- skipped clearInterval() below. The interval then kept ticking with the
    // bar pinned at 95%, the button stayed disabled and the overlay never hid. The
    // finally guarantees the timer is always stopped and the UI always recovers,
    // whatever throws.
    // Set when the face model itself could not be fetched. Tracked separately
    // from `analysis === null` because the two need completely different
    // messages: a blocked CDN is not the same problem as a photo without a face,
    // and telling the user "no face detected" when the model never loaded sends
    // them off retaking photos that were never the issue.
    let modelLoadFailure = null;

    try {
      try {
        // Clear the parked side-profile angle FIRST. Without this, a scan that
        // used a side photo leaves its nasolabial angle behind, and the next
        // front-only scan folds that stale reading into its nose score -- a
        // measurement taken from a photo this report knows nothing about.
        clearNasolabialAngleFromSide();
        analysis = await withTimeout(
          analyzeFrontPhoto(preview),
          MODEL_CALL_TIMEOUT_MS,
          "The face model"
        );
        // The engine reports a failed model download as a property on the result
        // rather than an exception, so that this handler's own cleanup always
        // runs (see the note in analyzeFrontPhoto). Read it here.
        // The engine can report a failed model load in two ways: as a property on
        // the result, or (older shape) as a thrown ModelLoadError. Both are
        // checked, and the check is on the VALUE rather than a truthiness test of
        // `analysis`, so a result of `{noFace:true, modelLoadError:null}` -- a
        // genuine no-face photo -- is correctly NOT treated as a load failure.
        const reportedLoadError = analysis && analysis.modelLoadError;
        if (reportedLoadError) {
          modelLoadFailure = reportedLoadError;
          analysis = null;
        } else if (analysis && analysis.noFace && analysis.landmarks === null) {
          // `noFace` alone is NOT enough: the engine deliberately fills
          // `landmarks` with a synthetic face (generateFallbackLandmarks) so that
          // nothing downstream throws, which means `landmarks === null` is never
          // true on this path. `isFallback` is the honest flag for "no mesh was
          // ever produced", and noFace+isFallback together mean the model gave
          // us nothing -- whether because it failed to load or because the photo
          // genuinely has no face. Either way the user must be told, so the
          // message here covers both and points at the likelier cause first.
          modelLoadFailure = new ModelLoadError(
            navigator.onLine === false ? "offline" : "unknown",
            new Error("no mesh produced; landmarks were synthetic")
          );
          analysis = null;
        }
      } catch (error) {
        if (error instanceof ModelLoadError) {
          modelLoadFailure = error;
        }
        console.error("Front analysis error:", error);
      }
      if (hasSide) {
        if (loadingText) loadingText.textContent = "🔎 Reading side profile...";
        // Phase 2: hand the animation over to the side slot. Both are left
        // visible -- the front beam still reads as "done, holding result",
        // which is why it is dimmed rather than removed.
        if (photoScanOverlay) photoScanOverlay.style.opacity = "0.35";
        if (sideScanOverlay) {
          sideScanOverlay.classList.remove("hidden");
          sideScanOverlay.style.opacity = "1";
        }
        if (photoScanBadge) photoScanBadge.textContent = "Front pass complete";
        if (sideScanBadge) sideScanBadge.textContent = "Measuring profile line...";
        const sideStartedAt = Date.now();
        try {
          sideAnalysis = await withTimeout(
            analyzeSidePhoto(sidePreview),
            MODEL_CALL_TIMEOUT_MS,
            "The profile model"
          );
        } catch (error) {
          // The model is already warm by now, so a failure here is not a load
          // problem -- but do not let a ModelLoadError slip past unlabelled
          // either, since the front pass may have failed for the same reason.
          if (error instanceof ModelLoadError && !modelLoadFailure) {
            modelLoadFailure = error;
          }
          console.error("Side analysis error:", error);
        }
        // Keep the beam on screen long enough to be seen (see SIDE_OVERLAY_MIN_MS).
        await holdSideOverlay(sideStartedAt);
      }
      // Merge the two into ONE result. The tier and score come from the front
      // photo; the side photo contributes through the structure a front view can't
      // see (see combineAnalysis in faceEngine.js). Everything below renders this
      // single object -- there is no second report.
      // Guarded: a malformed result must degrade to the front-only analysis, never
      // abort the whole scan and leave the bar stuck.
      let combined = null;
      try {
        combined = combineAnalysis(analysis, sideAnalysis);
      } catch (error) {
        console.error("Combine analysis error:", error);
      }
      if (combined) {
        analysis = combined;
        // Keep the raw side result for the profile section's field-by-field render.
        sideAnalysis = combined.side;
      }
    } finally {
      // Runs even if something above threw, so the progress bar can always finish.
      clearInterval(interval);
    }

    if (progress) progress.style.width = "100%";
    if (loadingText) loadingText.textContent = "100%";

    setTimeout(() => {
      // UI RECOVERY FIRST, in its own block: hiding the overlay and re-enabling
      // the button must happen even if rendering the report below throws. Keeping
      // this ahead of the (long) render means a render bug can never leave the
      // user staring at a disabled button again.
      if (loading) {
        loading.style.display = "none";
        loading.classList.remove("is-active");
      }
      if (progress) progress.style.width = "0%";
      if (loadingText) loadingText.textContent = "0%";

      if (photoScanOverlay) {
        photoScanOverlay.classList.add("hidden");
        photoScanOverlay.style.opacity = "1";
      }
      if (sideScanOverlay) {
        sideScanOverlay.classList.add("hidden");
        sideScanOverlay.style.opacity = "1";
      }

      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = `
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
          <circle cx="12" cy="12" r="4.2" />
        </svg>
        <span>Re-analyze photo</span>
      `;

      // MODEL LOAD FAILURE takes priority over everything below. If the model
      // never arrived, there is no analysis to report and the honest thing to do
      // is say so and stop -- running on to "no face detected" would blame the
      // user's photo for a network problem.
      if (modelLoadFailure) {
        if (scanStatus) {
          // Plain text, no emoji: a multi-byte emoji is the one thing that has
          // repeatedly corrupted this file's encoding across edits, and the
          // message reads just as clearly without one.
          scanStatus.textContent =
            modelLoadFailure.message ||
            "The face model could not be loaded. Check your connection and try again.";
          scanStatus.classList.remove("is-note", "is-side-only");
          scanStatus.classList.add("is-visible");
          scanStatus.dataset.source = "scan";
        }
        if (scanResults) {
          scanResults.classList.remove("is-visible", "visible");
          scanResults.classList.add("hidden");
          scanResults.style.display = "none";
        }
        showToast("Face model unavailable — check your connection", "error");
        return;
      }

      if (analysis) {
        // Draw facial landmarks directly on top of the uploaded photo
        if (analysis.landmarks) {
          drawLandmarksOnCanvas(analysis.landmarks);
        }

        // No face at all is a hard stop: every number below would come from
        // synthetic landmarks, so say so and do NOT present a score. This is what
        // previously reported a cropped side-profile photo as a valid front-view
        // scan with fabricated readings.
        const noFace = !!analysis.noFace;

        if (scanStatus) {
          scanStatus.classList.remove("is-note", "is-side-only");
          // The scanner is about to speak, so it takes ownership of the banner.
          // updateSideOnlyGuard() will not overwrite this until the user changes
          // a slot, which is what keeps a real "no face detected" message from
          // being replaced by the generic precondition hint.
          scanStatus.dataset.source = "scan";
          if (noFace) {
            // `suspectedProfile` is set when the mesh model found nothing but the
            // full-range detector DID locate a face -- i.e. almost certainly a side
            // photo in the front slot. Telling the user to use the side slot is far
            // more useful than a generic "no face detected".
            scanStatus.textContent = analysis.suspectedProfile
              ? "This looks like a side/profile photo — it can't set your tier. Drop it in slot 2 instead, and upload a straight-on photo in slot 1."
              : "No face detected in this photo — try a clear, front-facing shot with the whole head in frame.";
            scanStatus.classList.add("is-visible");
          } else if (analysis.lowQuality) {
            scanStatus.textContent = "⚠️ Photo looks soft or low-resolution — try a sharper front-facing shot for higher accuracy.";
            scanStatus.classList.add("is-visible");
            scanStatus.classList.add("is-note");
          } else {
            scanStatus.classList.remove("is-visible");
          }
        }

        // The whole results card is suppressed for a no-face scan: showing a tier
        // and a potential for a photo with no detectable face is worse than
        // showing nothing.
        if (scanResults) {
          if (noFace) {
            scanResults.classList.remove("is-visible", "visible");
            scanResults.classList.add("hidden");
            scanResults.style.display = "none";
            showToast(
              analysis.suspectedProfile
                ? "That looks like a side profile — use slot 2"
                : "No face detected in photo",
              "error"
            );
            return;
          }
        }

        currentGender = analysis.gender;
        if (scanOverallTicksEl) {
          renderTicks(scanOverallTicksEl, tiersFor(currentGender));
        }

        // `overallMeasured` is false when the front photo couldn't produce a real
        // frontal reading. In that case `tier` is null by design and the score must
        // NOT be shown as a verdict (a profile used to be graded "chad lite" off
        // nothing but substituted fallback values).
        const overallMeasured = analysis.overallMeasured !== false;

        // The verdict is the MERGED result: front score plus the capped profile
        // contribution (see combineAnalysis). Fall back to the raw front score when
        // no side photo was scanned.
        const verdictScore = overallMeasured
          ? (typeof analysis.combinedScore === "number" ? analysis.combinedScore : analysis.overall)
          : null;
        const verdictTier = overallMeasured
          ? (analysis.combinedTier || analysis.tier)
          : null;
        const verdictTierGroup = overallMeasured
          ? (analysis.combinedTierGroup || analysis.tierGroup)
          : null;

        if (scanOverallScoreEl) {
          scanOverallScoreEl.textContent =
            verdictScore === null ? "--" : (verdictScore / 10).toFixed(1);
        }
        if (scanTierValueEl) {
          scanTierValueEl.textContent = verdictTier || "";
          // Rank 1-5 drives the tier pill's colour (see .verdict__tier[data-rank]
          // in the stylesheet). The scale is the SAME for both genders -- the
          // labels differ (Chad vs Stacy) but the rank a face reaches is what the
          // colour communicates.
          const TIER_RANK = {
            "low tier": 1,
            "mid tier": 2,
            "high tier": 3,
            "chad lite": 4,
            "stacy lite": 4,
            chad: 5,
            stacy: 5,
            "true adam": 5,
            eve: 5,
          };
          const rank = TIER_RANK[(verdictTier || "").toLowerCase()] || 3;
          scanTierValueEl.setAttribute("data-rank", String(rank));
          scanTierValueEl.classList.toggle("tier-maintain", verdictTierGroup === "maintain");
        }
        // Animate the verdict ring to the merged score.
        if (scanVerdictRing && verdictScore !== null) {
          const circ = 2 * Math.PI * 62;
          scanVerdictRing.style.strokeDasharray = `${circ}`;
          scanVerdictRing.style.strokeDashoffset = `${circ * (1 - verdictScore / 100)}`;
        }

        // Source badge: says plainly which photos produced this verdict.
        if (scanSourcesEl) {
          scanSourcesEl.textContent = analysis.hasSide
            ? "Front + side photo"
            : "Front photo only";
        }

        // One line of plain-language interpretation of the verdict.
        if (scanVerdictNoteEl) {
          if (verdictTier === null) {
            scanVerdictNoteEl.textContent =
              "This photo couldn't be measured as a front view.";
          } else if (analysis.hasSide && analysis.profileBonus > 0.2) {
            scanVerdictNoteEl.textContent =
              "Your side photo added " + analysis.profileBonus.toFixed(1) +
              " points of visible jaw structure, lifting the combined score from " +
              (analysis.overall / 10).toFixed(1) + ".";
          } else if (analysis.tierUp) {
            scanVerdictNoteEl.textContent =
              verdictTier.charAt(0).toUpperCase() + verdictTier.slice(1) +
              " — your structure and skin are both pulling in the same direction.";
          } else if (
            analysis.faceFat &&
            typeof analysis.faceFat.score === "number" &&
            analysis.faceFat.score < 70 &&
            !analysis.hasSide
          ) {
            // A full face is capped by the face-fat band, so the useful line here
            // is what is holding it back -- not a suggestion to upload another
            // photo under a verdict that is already final.
            scanVerdictNoteEl.textContent =
              "Your lower face reads " + analysis.faceFat.label.toLowerCase() +
              ", which caps the tier. That is the single biggest lever you have.";
          } else if (!analysis.hasSide) {
            scanVerdictNoteEl.textContent =
              "Scored from your front photo. Add a side photo to measure the jaw angles a front view can't see.";
          } else {
            scanVerdictNoteEl.textContent =
              "Scored from your front photo, with the side view read for jaw structure.";
          }
        }

        // "What the side photo added" panel: only when a side photo was scanned
        // AND it produced usable profile readings.
        if (scanMergePanel) {
          const side = sideAnalysis;
          if (side && !side.noFace && typeof side.gonialAngle === "number") {
            scanMergePanel.classList.remove("hidden");
            if (scanMergeTier) {
              // Report what actually happened. The old copy keyed off
              // `profileChangedTier`, which compares the merged tier against the
              // FRONT tier -- so when the front photo already read "true adam" and
              // the profile pushed the score from 90.2 to 94.5, it still printed
              // the flat "Profile confirmed", hiding a 4.3-point contribution.
              // The honest statement is about the POINTS the profile added, since
              // the tier label may legitimately stay the same at the top of the
              // scale.
              if (analysis.profileBonus >= 2) {
                scanMergeTier.textContent =
                  "+" + analysis.profileBonus.toFixed(1) +
                  (analysis.profileChangedTier ? " pts \u2192 " + analysis.combinedTier : " pts");
              } else if (analysis.profileBonus > 0.2) {
                scanMergeTier.textContent = "+" + analysis.profileBonus.toFixed(1) + " pts";
              } else {
                scanMergeTier.textContent = "No change";
              }
            }
            if (scanMergeNote) {
              const q = analysis.profileQuality;
              const verdictWord =
                q >= 0.72 ? "strong" : q >= 0.5 ? "solid" : q >= 0.3 ? "average" : "soft";
              scanMergeNote.textContent =
                "Your profile reads " + verdictWord + " (" +
                Math.round(q * 100) + "% profile quality) and contributed " +
                analysis.profileBonus.toFixed(1) + " of a possible 6 points to the combined score.";
            }
            // `v` is a 0-100 strength; the label shows the rounded percentage and
            // the bar width uses the same clamped number.
            const setBar = (el, label, v) => {
              const clamped = Math.max(0, Math.min(100, v));
              if (label) label.textContent = Math.round(clamped) + "%";
              if (el) el.style.width = `${clamped}%`;
            };
            setBar(
              scanMergeGonialBar,
              scanMergeGonialEl,
              Math.max(0, Math.min(100, ((172 - side.gonialAngle) / (172 - 150)) * 100))
            );
            setBar(
              scanMergeMandibleBar,
              scanMergeMandibleEl,
              Math.max(0, Math.min(100, ((side.mandibleRatio - 0.28) / (0.46 - 0.28)) * 100))
            );
            setBar(
              scanMergeRamusBar,
              scanMergeRamusEl,
              Math.max(0, Math.min(100, ((side.ramusRatio - 0.16) / (0.32 - 0.16)) * 100))
            );
          } else {
            scanMergePanel.classList.add("hidden");
          }
        }

        if (scanOverallMarker) {
          if (verdictScore !== null) setScaleValue(scanOverallMarker, verdictScore);
        }

        // On a profile the frontal symmetry/golden-ratio passes are not measuring
        // anything meaningful (see PROFILE_FALLBACK_SCORE in faceEngine.js), so
        // don't show a fabricated percentage that looks real. Show "n/a" instead
        // and let the Face shape / Profile rows carry the reading.
        const frontalMeasured = analysis.frontalMetricsMeasured !== false;
        if (scanSymmetryScoreEl) {
          scanSymmetryScoreEl.textContent = frontalMeasured
            ? analysis.symmetry.toFixed(1) + "%"
            : "n/a (profile)";
        }
        if (scanGoldenScoreEl) {
          scanGoldenScoreEl.textContent = frontalMeasured
            ? analysis.golden.toFixed(1) + "%"
            : "n/a (profile)";
        }
        // Face shape and canthal tilt are frontal reads; the cards are hidden on a
        // profile by the de-stack block below, but the text is blanked too so a
        // stale value can't linger in the DOM behind a hidden card.
        if (scanFaceShapeEl) {
          scanFaceShapeEl.textContent = frontalMeasured ? analysis.faceShape : "n/a (profile)";
        }
        if (scanCanthalTiltEl) {
          scanCanthalTiltEl.textContent = frontalMeasured
            ? analysis.canthalTilt.label
            : "n/a (profile)";
        }
        if (scanHarmonyEl) {
          scanHarmonyEl.textContent = frontalMeasured
            ? analysis.harmony.toFixed(0) + "%"
            : "n/a (profile)";
        }
        if (scanSkinQualityEl) scanSkinQualityEl.textContent = analysis.skinQuality.toFixed(0) + "%";
        if (scanSkinAcneEl) {
          // A "not measurable" reading shows the reason, not a fake percentage.
          scanSkinAcneEl.textContent = analysis.skinAcne
            ? analysis.skinAcne.measured === false
              ? analysis.skinAcne.label
              : analysis.skinAcne.label + " (" + analysis.skinAcne.score.toFixed(0) + "%)"
            : "--";
        }
        // Face fat / jawline / eye shape are frontal readings, so on a profile
        // they read "n/a" like symmetry/golden rather than a collapsed number.
        if (scanFaceFatEl) {
          scanFaceFatEl.textContent = frontalMeasured
            ? analysis.faceFat.label + " (" + analysis.faceFat.score.toFixed(0) + "%)"
            : "n/a (profile)";
        }
        if (scanJawlineEl) {
          scanJawlineEl.textContent = frontalMeasured
            ? analysis.jawline.label + " (" + analysis.jawline.score.toFixed(0) + "%)"
            : "n/a (profile)";
        }

        // Evidence lines: the short reason behind each score. Rendered from
        // analysis.evidence (built in faceEngine.js) so the explanation always
        // comes from the SAME measurements that produced the number, never from
        // copy written separately in the UI. A null (not measurable at this angle)
        // clears the line rather than leaving a stale one from a previous scan.
        const ev = analysis.evidence || {};
        const mc = analysis.metricConfidence || {};
        // Each line is "<reason> · <confidence>%". The confidence rides on the
        // same sentence because keeping them together is the point: a reading and
        // how much to trust it, in one place. A missing confidence (a reading that
        // isn't measurable at this angle) simply drops the suffix.
        const setWhy = (el, text, confLabel) => {
          if (!el) return;
          if (!text) {
            el.textContent = "";
            return;
          }
          el.textContent =
            typeof confLabel === "number" ? text + " · " + confLabel + "% confidence" : text;
        };
        setWhy(scanSymmetryWhyEl, ev.symmetry, mc.symmetry);
        setWhy(scanGoldenWhyEl, ev.golden, mc.golden);
        setWhy(scanFaceFatWhyEl, ev.faceFat, mc.faceFat);
        setWhy(scanJawlineWhyEl, ev.jawline, mc.jawline);
        setWhy(scanEyeAreaWhyEl, ev.eyeArea, mc.eyeArea);
        if (scanEyeShapeEl) {
          scanEyeShapeEl.textContent = frontalMeasured
            ? analysis.eyeShape.label + " (" + analysis.eyeShape.score.toFixed(0) + "%)"
            : "n/a (profile)";
        }
        // Nose. The cell shows SCORE + TIER (the band is what the number means),
        // and the line beneath names the shape, which is the reason for the band.
        //
        // When the assessment is null the cell says so rather than showing a dash:
        // "not measured" is a real answer and a bare "--" reads as a bug.
        if (scanNoseEl) {
          const nose = analysis.nose;
          if (!frontalMeasured) {
            scanNoseEl.textContent = "n/a (profile)";
            if (scanNoseShapeEl) scanNoseShapeEl.textContent = "";
          } else if (!nose) {
            scanNoseEl.textContent = "Not measured";
            if (scanNoseShapeEl) {
              scanNoseShapeEl.textContent =
                "The mesh could not measure a nose on this photo.";
            }
          } else {
            // Score only in the value cell. Appending the tier label here wrapped
            // to two lines in a third-width card, making this card taller than its
            // neighbours and breaking the row's baseline -- the tier belongs with
            // the shape text, which already wraps to multiple lines by design.
            scanNoseEl.textContent = nose.score + " / 100";
            if (scanNoseShapeEl) {
              // Name the shape, and state what it was measured from -- a score
              // from a front photo alone rests on fewer readings than one that
              // also had a profile, and the user can see which they got.
              scanNoseShapeEl.textContent =
                nose.tierLabel +
                " \u00B7 " +
                nose.shape +
                " \u2014 " +
                nose.evidence +
                " (" +
                nose.measuredOn +
                ")";
            }
          }
        }
        // The old "Head angle" row reported whether the front photo was taken from
        // the side. That can no longer happen (profiles go in slot 2), so the row
        // now reports how ON-AXIS the front photo was -- the thing that actually
        // affects how trustworthy the frontal numbers are. A perfectly straight-on
        // shot reads "Straight on"; a slightly turned one is flagged.
        if (scanProfileEl) {
          const yaw = analysis.profile ? analysis.profile.yaw : 0;
          if (analysis.profile && analysis.profile.isProfile) {
            scanProfileEl.textContent = "Too turned (" + analysis.profile.profileType + ")";
          } else if (yaw < 0.06) {
            scanProfileEl.textContent = "Straight on";
          } else if (yaw < 0.12) {
            scanProfileEl.textContent = "Slightly turned";
          } else {
            scanProfileEl.textContent = "Turned — see reliability";
          }
        }

        // LAYOUT NOTE. The old "de-stack" logic lived here: it hid the frontal
        // cards whenever the FRONT photo happened to be taken from the side, so a
        // profile in slot 1 produced a half-empty report. That whole problem is
        // now solved upstream -- the front slot is for a front photo, and profiles
        // go in slot 2 with their own panel. So the frontal cards are simply
        // always shown here, and there is nothing left to toggle. All elements are
        // explicitly un-hidden so a stale class from a previous render can't
        // leave a card invisible.
        [
          scanSymmetryScoreEl && scanSymmetryScoreEl.closest(".scan-card"),
          scanGoldenScoreEl && scanGoldenScoreEl.closest(".scan-card"),
          scanFaceShapeEl && scanFaceShapeEl.closest(".scan-detail-card"),
          scanCanthalTiltEl && scanCanthalTiltEl.closest(".scan-detail-card"),
          scanHarmonyEl && scanHarmonyEl.closest(".scan-detail-card"),
          scanFaceFatEl && scanFaceFatEl.closest(".scan-detail-card"),
          scanJawlineEl && scanJawlineEl.closest(".scan-detail-card"),
          scanEyeShapeEl && scanEyeShapeEl.closest(".scan-detail-card"),
          scanProfileEl && scanProfileEl.closest(".scan-detail-card"),
          document.getElementById("scanEyePanel"),
          scanPotentialScoreEl && scanPotentialScoreEl.closest(".scan-potential"),
        ].forEach((el) => {
          if (el) el.classList.remove("is-hidden-for-profile");
        });

        // Eye area: the composite plus each weighted part, so the user can see
        // WHICH reading is carrying the score and which is holding it back.
        const eyeArea = analysis.eyeArea;
        if (eyeArea) {
          const bar = (el, value) => {
            if (el) el.style.width = `${Math.max(0, Math.min(100, value))}%`;
          };
          if (scanEyeAreaValueEl) {
            scanEyeAreaValueEl.textContent = frontalMeasured
              ? eyeArea.label + " · " + eyeArea.score.toFixed(0) + "%"
              : "n/a (profile)";
          }
          // Sub-scores are shown as an explicit "NN / 100" so they read as a
          // score out of 100 and never as a percentage of the composite (which is
          // what the badge above shows). The parenthetical is the raw measurement
          // the sub-score came from, and it is deliberately DIFFERENT information
          // from the row below: here it is the reading, below it is the metric.
          const parts = eyeArea.scoreParts || {};
          if (scanEyeCanthalEl) {
            scanEyeCanthalEl.textContent = frontalMeasured
              ? parts.canthal.toFixed(0) + " / 100 · " + analysis.canthalTilt.label +
                " tilt (" + analysis.canthalTilt.degrees.toFixed(1) + "\u00B0)"
              : "n/a";
          }
          // Projection is the one sub-reading whose SOURCE changes with the scan,
          // and on a front-only scan it does not score at all (it would just
          // repeat the eyelid reading -- see computeEyeArea). So the card reports
          // the lid-coverage estimate as information and says plainly that a side
          // photo is what turns it into a real, scored measurement.
          if (scanEyeProjectionEl) {
            if (!frontalMeasured) {
              scanEyeProjectionEl.textContent = "n/a";
            } else if (eyeArea.projectionSource === "profile") {
              scanEyeProjectionEl.textContent =
                parts.projection.toFixed(0) + " / 100 · " + eyeArea.projectionLabel +
                " (measured from your side photo)";
            } else {
              // Front-only scan. This part does not score (see computeEyeArea -- it
              // would only repeat the eyelid reading), so saying "not scored" next
              // to a confident-sounding vibe is still confusing. It now states the
              // measurement that IS in play and that this part needs the side view.
              scanEyeProjectionEl.textContent =
                "needs side photo · " + eyeArea.projectionLabel + " so far";
            }
          }
          if (scanEyeEyelidEl) {
            scanEyeEyelidEl.textContent = frontalMeasured
              ? parts.eyelid.toFixed(0) + " / 100 · " + eyeArea.upperLidExposureLabel
              : "n/a";
          }
          if (scanEyeBrowEl) {
            scanEyeBrowEl.textContent = frontalMeasured
              ? parts.brow.toFixed(0) + " / 100"
              : "n/a";
          }
          bar(scanEyeCanthalBar, parts.canthal);
          bar(scanEyeProjectionBar, parts.projection);
          bar(scanEyeEyelidBar, parts.eyelid);
          bar(scanEyeBrowBar, parts.brow);

          // The lid reading answers "what number produced the crease label", which
          // is NOT the same scale as the 0-100 sub-score directly above it (a
          // covered crease scores HIGH but a high coverage percentage is the
          // opposite direction). Printing "20% coverage" next to "88 / 100" read
          // as a contradiction, so the row names the direction explicitly and
          // shows the coverage as the proportion of the lid the fold covers.
          if (scanEyeLidExposureEl) {
            const coverage = Math.round(eyeArea.upperLidExposure * 100);
            scanEyeLidExposureEl.textContent = frontalMeasured
              ? eyeArea.upperLidExposureLabel + " \u2014 the fold covers " + coverage +
                "% of the lid (" + eyeArea.lidSource + ")"
              : "n/a";
          }
          if (scanEyeScleralEl) {
            // Measured from the eye aperture (see computeEyeArea). An iris-anchored
            // reading was proven impossible on this mesh -- the MediaPipe iris ring
            // is not eyelid-clipped -- so this is an aperture band, not an iris
            // position. Labelled low/medium/high.
            const s = eyeArea.scleralShow;
            scanEyeScleralEl.textContent = frontalMeasured
              ? (s >= 0.45 ? "High" : s >= 0.25 ? "Moderate" : "Low") +
                " (" + Math.round(s * 100) + "%)"
              : "n/a";
          }
          if (scanEyeIntercanthalEl) {
            scanEyeIntercanthalEl.textContent = frontalMeasured
              ? eyeArea.intercanthalRatio.toFixed(2) + " · ideal ~1.2"
              : "n/a";
          }
          if (scanEyeBrowDistEl) {
            // The ideal band is shown as a RANGE, matching the engine's free band
            // (BROW_EYE_IDEAL 0.62 +/- 0.12), so a value inside it is visibly fine
            // instead of looking off against a single hard target.
            scanEyeBrowDistEl.textContent = frontalMeasured
              ? eyeArea.browEyeRatio.toFixed(2) + " · ideal 0.50-0.74"
              : "n/a";
          }
        }

        // Potential: the tier this face could realistically reach, and the single
        // fixable reading holding it back the most.
        // potential.measured is false on a profile / no-face scan, where it has no
        // value -- everything below is gated on it so a null never prints.
        const potential = analysis.potential;
        if (potential && potential.measured === false) {
          if (scanPotentialScoreEl) scanPotentialScoreEl.textContent = "--";
          if (scanPotentialTierEl) {
            scanPotentialTierEl.textContent = "Front view only";
            scanPotentialTierEl.classList.remove("is-up");
          }
          if (scanPotentialNoteEl) {
            scanPotentialNoteEl.textContent =
              "Potential is measured from front-facing geometry — retake straight-on to see it.";
          }
        } else if (potential) {
          // At the ceiling the projection is numerically the same as the verdict,
          // so the big number becomes the honest delta (+0.0) rather than printing
          // the same score twice.
          //
          // The badge must NOT say "Maxed" here. "Maxed" asserts the face is at the
          // TOP of the scale, but a low headroom simply means nothing is easily
          // recoverable -- a Chad with no soft-tissue headroom is not a True Adam.
          // So the badge names the tier the face is actually AT, and the note
          // explains that the remaining limit is structural.
          const atCeiling = potential.headroom < 1.5;
          if (scanPotentialScoreEl) {
            // NOT "MAX". The reported bug was that this badge read "MAX" on almost
            // every scan, which was true in the arithmetic (headroom was ~0 for
            // nearly everyone) but wrong as a claim -- a face can be at its OWN
            // ceiling while sitting at 92 of 100, and "MAX" asserts the top of the
            // whole scale. The badge now shows the CEILING VALUE ("92 of 96"),
            // which states where the face can actually reach without overclaiming.
            scanPotentialScoreEl.textContent = atCeiling
              ? Math.round(potential.score) + " of " + Math.round(potential.structureCeiling)
              : "+" + potential.headroom.toFixed(1);
          }
          if (scanPotentialTierEl) {
            // At the ceiling the badge states WHAT the ceiling is, rather than
            // repeating the current tier. Printing "True Adam" next to "+0.0
            // headroom" invites the obvious question (0 headroom, so why a tier?),
            // whereas "Ceiling reached" answers it: this is where the structure
            // tops out. Away from the ceiling the badge names the reachable tier,
            // which is the useful fact there.
            scanPotentialTierEl.textContent = atCeiling
              ? "Ceiling reached"
              : "Reachable: " + potential.tier;
            scanPotentialTierEl.classList.toggle("is-up", !atCeiling && !!potential.tierUp);
          }
          if (scanPotentialNoteEl) {
            const priorityLabel = {
              skin: "skin quality",
              clarity: "skin clarity",
              leanness: "face fat / leanness",
              jaw: "jaw definition",
              "eye-area": "the eye area",
              posture: "posture",
            }[potential.priority] || "your weakest area";
            // No meaningful headroom: the projection equals where the face already
            // is. This is NOT "everything maxed" -- it means the soft-tissue
            // readings (skin, leanness, jaw) are already at target, so the only
            // thing left is bone structure, which habits cannot move. The note says
            // exactly that, and names the one part (usually eye area) that still
            // reads below the best it could be.
            if (potential.headroom < 1.5) {
              scanPotentialNoteEl.textContent =
                "Your improvable readings (skin, leanness, jaw definition) are already at " +
                "target, so there is no quick gain left to promise. The remaining limit is bone " +
                "structure. Weakest part to watch: " + priorityLabel + ".";
            } else if (potential.tierUp) {
              scanPotentialNoteEl.textContent =
                "+" + potential.headroom.toFixed(1) + " points of real headroom — within reach of " +
                potential.tier + " (from " + potential.currentTier + "). Biggest lever: " +
                priorityLabel + ". Structure ceiling: " + potential.structureCeiling.toFixed(0) + ".";
            } else {
              scanPotentialNoteEl.textContent =
                "+" + potential.headroom.toFixed(1) + " points of headroom toward " +
                potential.tier + ". Biggest lever: " + priorityLabel +
                ". Structure ceiling: " + potential.structureCeiling.toFixed(0) + ".";
            }
          }
        }

        // Your strengths: the up-to-four features this face scored highest on,
        // rendered as a ranked list beside the Potential card. The list is built
        // from analysis.strengths (see computeStrengths in faceEngine.js), which is
        // EMPTY on a profile / no-face scan -- in that case the whole card is
        // hidden rather than showing an empty shell.
        const strengths = Array.isArray(analysis.strengths) ? analysis.strengths : [];
        if (scanStrengthPanel) {
          scanStrengthPanel.classList.toggle("is-empty", strengths.length === 0);
        }
        if (scanStrengthCountEl) {
          scanStrengthCountEl.textContent = strengths.length
            ? strengths.length + (strengths.length === 1 ? " strength" : " strengths")
            : "--";
        }
        if (scanStrengthListEl) {
          scanStrengthListEl.innerHTML = "";
          strengths.forEach(function (s, i) {
            const li = document.createElement("li");
            li.className = "scan-strength-item";
            // Rank is shown as a small ordinal chip, so the list reads as a
            // countdown from the single best feature rather than a flat set.
            const rank = document.createElement("span");
            rank.className = "scan-strength-item__rank";
            rank.textContent = String(i + 1);

            const body = document.createElement("div");
            body.className = "scan-strength-item__body";

            const head = document.createElement("div");
            head.className = "scan-strength-item__head";
            const name = document.createElement("span");
            name.className = "scan-strength-item__name";
            name.textContent = s.label || s.key;
            const score = document.createElement("span");
            score.className = "scan-strength-item__score";
            score.textContent = Math.round(s.score) + "/100";
            head.appendChild(name);
            head.appendChild(score);

            const bar = document.createElement("span");
            bar.className = "scan-strength-item__bar";
            const fill = document.createElement("i");
            // Width is set as an inline style because it is a per-item VALUE, and
            // a CSS class cannot carry a 0-100 number.
            fill.style.width = Math.max(0, Math.min(100, s.score)) + "%";
            bar.appendChild(fill);

            const note = document.createElement("p");
            note.className = "scan-strength-item__note";
            note.textContent = s.note || "";

            body.appendChild(head);
            body.appendChild(bar);
            body.appendChild(note);
            li.appendChild(rank);
            li.appendChild(body);
            scanStrengthListEl.appendChild(li);
          });
        }

        // "What's holding your potential?" -- the concrete list of readings keeping
        // this face below its ceiling, biggest lever first, each with a fix line.
        // The panel hides itself when nothing is limiting (an already-elite face),
        // so it never shows an empty shell.
        const limiters = Array.isArray(analysis.limiters) ? analysis.limiters : [];
        if (scanLimitsPanel) {
          scanLimitsPanel.classList.toggle("hidden", limiters.length === 0);
        }
        if (scanLimitsCountEl) {
          scanLimitsCountEl.textContent = limiters.length
            ? limiters.length + (limiters.length === 1 ? " limiter" : " limiters")
            : "--";
        }
        if (scanLimitsListEl) {
          scanLimitsListEl.innerHTML = "";
          limiters.forEach(function (l, i) {
            const li = document.createElement("li");
            li.className = "scan-limit-item";

            const rank = document.createElement("span");
            rank.className = "scan-limit-item__rank";
            rank.textContent = String(i + 1);

            const body = document.createElement("div");
            body.className = "scan-limit-item__body";

            const head = document.createElement("div");
            head.className = "scan-limit-item__head";
            const name = document.createElement("span");
            name.className = "scan-limit-item__name";
            name.textContent = l.label || l.key;
            const score = document.createElement("span");
            score.className = "scan-limit-item__score";
            // Show the reading and how far below target it sits, so the number has
            // a direction: "72/100 · 20 below target" reads as a gap to close.
            score.textContent = l.score + "/100 · " + l.gap + " below";
            head.appendChild(name);
            head.appendChild(score);

            const bar = document.createElement("span");
            bar.className = "scan-limit-item__bar";
            const fill = document.createElement("i");
            fill.style.width = Math.max(0, Math.min(100, l.score)) + "%";
            bar.appendChild(fill);

            const fix = document.createElement("p");
            fix.className = "scan-limit-item__fix";
            fix.textContent = l.fix || "";

            body.appendChild(head);
            body.appendChild(bar);
            if (l.fix) body.appendChild(fix);
            li.appendChild(rank);
            li.appendChild(body);
            li.style.animationDelay = i * 70 + "ms";
            scanLimitsListEl.appendChild(li);
          });
        }

        // Scan reliability: landmark confidence + lighting + sharpness. These are
        // advisory only -- they never change the score, they just say how much to
        // trust it and whether a retake would give a cleaner read.
        const confidence = analysis.confidence;
        const lighting = analysis.lighting;
        if (scanConfidenceEl) {
          scanConfidenceEl.textContent = confidence
            ? confidence.score.toFixed(0) + "% · " + confidence.label
            : "--";
          scanConfidenceEl.classList.toggle(
            "is-warn",
            !!(confidence && confidence.score < 70)
          );
        }
        if (scanLightingEl) {
          scanLightingEl.textContent = lighting && lighting.measured
            ? lighting.label + " (" + lighting.score.toFixed(0) + "%)"
            : "Unknown";
          scanLightingEl.classList.toggle(
            "is-warn",
            !!(lighting && lighting.measured && lighting.score < 55)
          );
        }
        if (scanSharpnessEl) {
          const sharp = analysis.sharpness;
          scanSharpnessEl.textContent = sharp === null
            ? "Unknown"
            : analysis.lowQuality
              ? "Soft (" + Math.round(sharp) + ")"
              : "Sharp (" + Math.round(sharp) + ")";
          scanSharpnessEl.classList.toggle("is-warn", !!analysis.lowQuality);
        }

        // Head pose, measured in 3D from MediaPipe's facial transformation matrix.
        // This is a genuine rotational reading, not an estimate, so it is worth
        // showing: it tells the user which way their head was actually oriented
        // when the numbers were taken.
        if (scanHeadPoseEl) {
          if (confidence && confidence.poseSource === "matrix") {
            const yawDeg = (confidence.yaw * 90).toFixed(0);
            const pitch = confidence.pitchDeg === null ? 0 : confidence.pitchDeg;
            const roll = confidence.rollDeg === null ? 0 : confidence.rollDeg;
            scanHeadPoseEl.textContent =
              "yaw " + yawDeg + "\u00B0 · pitch " + pitch.toFixed(0) +
              "\u00B0 · roll " + roll.toFixed(0) + "\u00B0";
            // A rolled or pitched head distorts every left/right reading, so it is
            // flagged rather than presented as a neutral fact.
            scanHeadPoseEl.classList.toggle(
              "is-warn",
              Math.abs(pitch) > 14 || roll > 12
            );
          } else {
            scanHeadPoseEl.textContent = "3D pose unavailable";
            scanHeadPoseEl.classList.add("is-warn");
          }
        }

        // Iris tracking: whether this capture included the 10 iris points.
        //
        // Reported as pure information and labelled as such. Saying just
        // "Detected" implied the iris feeds the score, which it does not -- an
        // iris-based scleral reading was attempted and reverted (see
        // computeEyeArea), so the phrasing now makes clear it is capture detail,
        // not a scoring input.
        if (scanIrisEl) {
          const hasIris = analysis.eyeArea && analysis.eyeArea.irisAvailable;
          scanIrisEl.textContent = hasIris
            ? "Tracked (info only)"
            : "Not in this capture";
          scanIrisEl.classList.toggle("is-warn", !hasIris);
        }
        if (scanReliabilityBadge) {
          const reliable = !!(confidence && confidence.reliable);
          scanReliabilityBadge.textContent = reliable ? "High reliability" : "Low reliability";
          scanReliabilityBadge.classList.toggle("is-poor", !reliable);
        }
        if (scanQualityNoteEl) {
          const notes = [];
          // Never nag a deliberate side profile about being "tilted" -- that is the
          // whole point of the photo. Its reliability is reported by the profile
          // confidence badge instead.
          const onProfile = !!(analysis.profile && analysis.profile.isProfile);
          if (!onProfile && confidence && confidence.score < 70) {
            notes.push("Retake photo: face too tilted.");
          }
          // Explain a measured roll in plain language. "roll 18 degrees" on its own
          // reads like a fault in the reading rather than a description of the
          // photo, so the note says what it IS and why it matters for a frontal scan.
          if (!onProfile && confidence && confidence.flags.includes("roll")) {
            const roll = confidence.rollDeg === null ? 0 : Math.round(confidence.rollDeg);
            notes.push(
              "Your head was tilted about " + roll +
              " degrees sideways in this photo. Straightening it gives more stable left/right readings."
            );
          }
          if (
            !onProfile &&
            confidence &&
            confidence.flags.includes("pitch") &&
            !confidence.flags.includes("roll")
          ) {
            notes.push(
              "Your head was tipped up or down, which can soften the jaw and chin readings."
            );
          }
          if (onProfile) {
            notes.push("Side-profile scan — frontal metrics are hidden because they can't be measured at this angle.");
          }
          if (confidence && confidence.flags.includes("small-face")) {
            notes.push("Move closer so the face fills more of the frame.");
          }
          if (lighting && lighting.measured && lighting.score < 55) {
            notes.push(
              lighting.meanLum < 60
                ? "Lighting quality: Poor — find even, front-facing light."
                : "Lighting is unbalanced — avoid strong backlight or harsh shadow."
            );
          }
          if (analysis.lowQuality) {
            notes.push("Photo looks soft — a sharper shot gives more stable landmarks.");
          }
          scanQualityNoteEl.textContent = notes.length
            ? notes.join(" ")
            : "Good capture — landmarks, exposure and focus are all solid.";
          scanQualityNoteEl.classList.toggle("is-warn", notes.length > 0);
        }

        // PROFILE REPORT (slot 2). This is now driven entirely by the user's own
        // side photo -- no longer inferred from the front photo's head angle.
        // The two reports no longer overlap: this panel is the ONLY place profile
        // numbers appear, and it never contains a score or a tier.
        if (scanSideProfilePanel) {
          const side = sideAnalysis;
          const sideFields = [
            scanSideGonialEl,
            scanSideRamusEl,
            scanSideMandibleEl,
            scanSideEyeProjectionEl,
            scanSideNoseEl,
            scanSideProfileTypeEl,
          ];

          // No side photo scanned: hide the section completely.
          //
          // It used to stay visible with a "not scanned" badge and a row of
          // dashes, to advertise that the feature existed. In practice a column of
          // empty placeholders reads as an unfinished or broken report, and the
          // upload slot directly above already invites the user to add a side
          // photo. So the clean result is to show nothing at all until there is a
          // profile to show, and let the slot 2 prompt do the advertising.
          if (!side) {
            scanSideProfilePanel.classList.add("hidden");
            // Values are cleared as well as hidden, so a previous scan's numbers
            // can't linger in the DOM behind the hidden panel.
            sideFields.forEach((el) => {
              if (el) el.textContent = "--";
            });
            if (scanSideConfidenceEl) {
              scanSideConfidenceEl.textContent = "";
              scanSideConfidenceEl.classList.remove("is-partial");
            }
          } else if (side.noFace || side.gonialAngle === null) {
            // A side photo was uploaded but couldn't be measured. Show the panel
            // with a clear reason instead of numbers -- the full-range detector
            // tells us which of the two cases it is.
            scanSideProfilePanel.classList.remove("hidden");
            if (scanSideConfidenceEl) {
              scanSideConfidenceEl.textContent = side.faceFound ? "Too turned" : "Not detected";
              scanSideConfidenceEl.classList.add("is-partial");
            }
            if (scanSideHintEl) {
              scanSideHintEl.textContent = side.message || "";
            }
            sideFields.forEach((el) => {
              if (el) el.textContent = "--";
            });
          } else {
            scanSideProfilePanel.classList.remove("hidden");
            if (scanSideHintEl) {
              scanSideHintEl.textContent =
                "Measured from your side photo. Gonial angle is the jaw-corner angle (smaller = sharper); " +
                "ramus is the height of the vertical jaw branch; mandible is the jaw body length; eye projection " +
                "is how far the eye sits ahead of (prominent) or behind (deep-set) the brow.";
            }
            if (scanSideConfidenceEl) {
              // Profile confidence now means "how decisive is the turn", which is
              // what actually affects the reading quality. A near-true profile
              // gives clean side numbers; an ambiguous half-turn does not.
              const decisive = side.yaw >= 0.45;
              scanSideConfidenceEl.textContent = decisive ? "Full profile" : "Partial turn";
              scanSideConfidenceEl.classList.toggle("is-partial", !decisive);
            }
            if (scanSideGonialEl) {
              scanSideGonialEl.textContent =
                side.gonialLabel + " (" + side.gonialAngle.toFixed(0) + "\u00B0)";
            }
            if (scanSideRamusEl) {
              scanSideRamusEl.textContent =
                side.ramusLabel + " (" + (side.ramusRatio * 100).toFixed(0) + "%)";
            }
            if (scanSideMandibleEl) {
              scanSideMandibleEl.textContent =
                side.mandibleLabel + " (" + (side.mandibleRatio * 100).toFixed(0) + "%)";
            }
            if (scanSideEyeProjectionEl) {
              scanSideEyeProjectionEl.textContent =
                side.eyeProjectionLabel + " (" + side.eyeProjection.toFixed(3) + ")";
            }
            if (scanSideNoseEl) {
              scanSideNoseEl.textContent =
                side.noseLabel + " (" + side.nasolabialAngle.toFixed(0) + "\u00B0)";
            }
            if (scanSideProfileTypeEl) {
              scanSideProfileTypeEl.textContent = side.profileType || "--";
            }
          }
        }

        if (scanSymmetryMarker && frontalMeasured) setScaleValue(scanSymmetryMarker, analysis.symmetry);
        if (scanGoldenMarker && frontalMeasured) setScaleValue(scanGoldenMarker, analysis.golden);

        // Haircuts for this face, from the SAME analysis -- rendered into the
        // #scanHairPanel that sits above Scan reliability. No second photo, no
        // second model run. Hidden automatically when the shape can't be measured.
        renderHairPlan(analysis);

        if (scanTipsHeadingEl) scanTipsHeadingEl.textContent = tipsHeadingFor(analysis.tierGroup);
        if (scanTipsListEl) {
          scanTipsListEl.innerHTML = "";
          tipsForAnalysis(currentGender, analysis).forEach((tip, i) => {
            const li = document.createElement("li");
            li.textContent = tip;
            li.style.animationDelay = `${i * 80}ms`;
            scanTipsListEl.appendChild(li);
          });
        }

        if (scanResults) {
          scanResults.classList.remove("hidden");
          scanResults.classList.add("is-visible");
          scanResults.classList.add("visible");
          scanResults.style.display = "flex";
          requestAnimationFrame(() => {
            scanResults.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        }

        showToast("Analysis complete!", "success");
      } else {
        if (scanStatus) {
          scanStatus.textContent = "No face detected — please try a clear, front-facing photo.";
          scanStatus.classList.add("is-visible");
        }
        showToast("No face detected in photo", "error");
      }
    }, 400);
  });
}

// ------------------------------------------------------------------ Report Section & Rows

// "Download PDF" on the verdict card. The browser's own print dialog is the PDF
// engine (see js/report-export.js for why), so this just validates that there is
// a report to print and hands off.
(function initReportDownload() {
  const btn = document.getElementById("downloadReportBtn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    const started = printScanReport();
    if (!started) {
      showToast("Run a scan first \u2014 there is no report to export yet", "info");
      return;
    }
    showToast("Choose \"Save as PDF\" in the print dialog", "info");
  });
})();

function initReportSection() {
  const reportSection = document.getElementById("report");
  const overallScoreEl = document.getElementById("overall-score");
  const reportRing = document.getElementById("reportRing");

  if (reportSection && overallScoreEl) {
    let animated = false;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !animated) {
        animated = true;
        let score = 0;
        const target = 9.4;
        const interval = setInterval(() => {
          score += 0.2;
          if (score >= target) {
            score = target;
            clearInterval(interval);
          }
          overallScoreEl.textContent = `${score.toFixed(1)} / 10`;

          if (reportRing) {
            const circumference = 2 * Math.PI * 60; // r=60
            const offset = circumference * (1 - score / 10);
            reportRing.style.strokeDasharray = `${circumference}`;
            reportRing.style.strokeDashoffset = `${offset}`;
          }
        }, 30);
      }
    }, { threshold: 0.2 });

    observer.observe(reportSection);
  }

  // Interactive report rows
  const reportRows = document.querySelectorAll(".report-row");
  reportRows.forEach((row) => {
    const fillVal = row.getAttribute("data-fill");
    const bar = row.querySelector(".report-row__bar i");
    if (bar && fillVal) {
      bar.style.width = `${fillVal}%`;
    }

    row.addEventListener("click", () => {
      const isExpanded = row.getAttribute("aria-expanded") === "true";
      reportRows.forEach((r) => r.setAttribute("aria-expanded", "false"));
      row.setAttribute("aria-expanded", isExpanded ? "false" : "true");
    });

    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        row.click();
      }
    });
  });
}

// ------------------------------------------------------------------ Hero Live Demo AI Card

function initHeroCardAnimation() {
  const pointsContainer = document.getElementById("faceMeshPoints");
  const heroRing = document.getElementById("heroRing");
  const heroScore = document.getElementById("heroScore");
  const heroTier = document.getElementById("heroTier");
  const heroBar = document.getElementById("heroBar");
  const heroStatus = document.getElementById("heroStatus");
  const heroScanLabel = document.getElementById("heroScanLabel");
  const metricsList = document.querySelectorAll("#heroMetrics .metric");

  if (!pointsContainer) return;

  pointsContainer.innerHTML = "";
  const numPoints = 28;
  for (let i = 0; i < numPoints; i++) {
    const dot = document.createElement("i");
    const x = 15 + Math.random() * 70;
    const y = 15 + Math.random() * 70;
    dot.style.left = `${x}%`;
    dot.style.top = `${y}%`;
    dot.style.animationDelay = `${(Math.random() * 3.2).toFixed(2)}s`;
    pointsContainer.appendChild(dot);
  }

  metricsList.forEach((metric) => {
    const val = metric.getAttribute("data-value") || 90;
    const bar = metric.querySelector(".metric__bar i");
    if (bar) {
      setTimeout(() => {
        bar.style.width = `${val}%`;
      }, 500);
    }
  });

  const statuses = [
    { label: "Mapping 478 landmarks...", status: "Running MediaPipe Vision model...", score: 92, tier: "Chad" },
    { label: "Measuring symmetry...", status: "Bilateral feature alignment...", score: 94, tier: "Chad" },
    { label: "Calculating golden ratio...", status: "Facial harmony & cheekbone span...", score: 91, tier: "Chad" },
    { label: "Analysis complete", status: "On-device process complete", score: 93, tier: "Chad" },
  ];

  let currentIdx = 0;
  const updateDemo = () => {
    const item = statuses[currentIdx];
    if (heroScanLabel) heroScanLabel.textContent = item.label;
    if (heroStatus) heroStatus.textContent = item.status;
    if (heroTier) heroTier.textContent = item.tier;

    if (heroScore) {
      heroScore.textContent = item.score;
    }

    if (heroBar) {
      heroBar.style.width = `${((currentIdx + 1) / statuses.length) * 100}%`;
    }

    if (heroRing) {
      const circumference = 2 * Math.PI * 52;
      const offset = circumference * (1 - item.score / 100);
      heroRing.style.strokeDasharray = `${circumference}`;
      heroRing.style.strokeDashoffset = `${offset}`;
    }

    currentIdx = (currentIdx + 1) % statuses.length;
  };

  updateDemo();
  setInterval(updateDemo, 3500);
}
