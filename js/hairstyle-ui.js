// ============================================================================
// Controller for the AI Hairstyle section.
//
// Kept in its OWN module, with its own state and its own DOM ids, so it shares
// nothing with main.js's scanner except the engine functions it imports. The two
// tools therefore cannot break each other: no shared element, no shared flag,
// no shared handler. (main.js is already long and load-bearing; adding a second
// flow inside it would have meant every scanner change risking the hair tool.)
//
// It calls analyzeFrontPhoto directly rather than reusing the scanner's photo,
// which is the point of the feature being separate -- a user can try a different
// photo here without disturbing the scan they already ran above.
// ============================================================================

import { analyzeFrontPhoto, ModelLoadError } from "./faceEngine.js";
import { recommendHairstyles } from "./hairstyle.js";

const input = document.getElementById("hairInput");
const drop = document.getElementById("hairDrop");
const preview = document.getElementById("hairPreview");
const fileNameEl = document.getElementById("hairFileName");
const analyzeBtn = document.getElementById("hairAnalyzeBtn");
const resetBtn = document.getElementById("hairResetBtn");
const loading = document.getElementById("hairLoading");
const loadingText = document.getElementById("hairLoadingText");
const progress = loading ? loading.querySelector(".progress") : null;
const statusEl = document.getElementById("hairStatus");
const results = document.getElementById("hairResults");
const placeholder = document.getElementById("hairPlaceholder");
const shapeValueEl = document.getElementById("hairShapeValue");
const shapeSummaryEl = document.getElementById("hairShapeSummary");
const shapeAvoidEl = document.getElementById("hairShapeAvoid");
const noteEl = document.getElementById("hairNote");
const cutHeadingEl = document.getElementById("hairCutHeading");
const cutListEl = document.getElementById("hairCutList");

// Only wire up if the section is actually on the page, so this module is safe to
// import from a page that does not include it.
if (drop && input && analyzeBtn) {
  let hasPhoto = false;
  let busy = false;
  let objectUrl = null;

  // --------------------------------------------------------------- helpers

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.remove("is-note", "is-side-only", "is-visible");
    if (text) {
      statusEl.classList.add("is-visible");
      // "note" = amber caution (bad photo); default = coral (hard failure).
      if (kind === "note") statusEl.classList.add("is-note");
    }
  }

  function setBusy(on) {
    busy = on;
    analyzeBtn.disabled = on || !hasPhoto;
    if (loading) {
      loading.style.display = on ? "flex" : "none";
      loading.classList.toggle("is-active", on);
      loading.setAttribute("aria-hidden", on ? "false" : "true");
    }
    if (progress) progress.style.width = on ? "15%" : "0%";
  }

  // Revoke the previous object URL before replacing it. Without this, every
  // photo a user tries stays in memory for the life of the tab.
  function releaseUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function clearResults() {
    if (results) {
      results.classList.add("hidden");
      results.style.display = "none";
    }
    if (placeholder) placeholder.hidden = false;
    if (cutListEl) cutListEl.innerHTML = "";
  }

  function reset() {
    releaseUrl();
    if (input) input.value = "";
    if (preview) preview.src = "";
    if (fileNameEl) fileNameEl.textContent = "";
    hasPhoto = false;
    if (drop) drop.classList.remove("has-image");
    if (resetBtn) {
      resetBtn.hidden = true;
      resetBtn.style.display = "none";
    }
    setStatus("");
    clearResults();
    setBusy(false);
  }

  // ------------------------------------------------------------ file input

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("That file is not an image — drop a JPG or PNG.", "note");
      return;
    }

    releaseUrl();
    objectUrl = URL.createObjectURL(file);
    if (preview) preview.src = objectUrl;
    if (fileNameEl) fileNameEl.textContent = file.name;

    hasPhoto = true;
    if (drop) drop.classList.add("has-image");
    if (resetBtn) {
      resetBtn.hidden = false;
      resetBtn.style.display = "inline-flex";
    }
    setStatus("");
    clearResults();
    setBusy(false);
  }

  input.addEventListener("change", (event) => {
    loadFile(event.target.files && event.target.files[0]);
  });

  // Drag and drop, mirroring the scanner's behaviour.
  ["dragenter", "dragover"].forEach((type) => {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove("is-dragging");
    });
  });
  drop.addEventListener("drop", (event) => {
    const dt = event.dataTransfer;
    if (dt && dt.files && dt.files.length) loadFile(dt.files[0]);
  });

  // The label opens the picker natively; this only handles the keyboard path,
  // where a focused <label> does not forward Enter to the input.
  drop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  if (resetBtn) resetBtn.addEventListener("click", reset);

  // -------------------------------------------------------------- analysis

  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", async function () {
      if (!hasPhoto || busy) return;

      clearResults();
      setStatus("");
      setBusy(true);
      if (loadingText)
        loadingText.textContent = "📐 Measuring facial proportions... 15%";
      if (progress) progress.style.width = "15%";

      // The engine call is the long pole. The bar advances in steps tied to real
      // phases of work rather than a fake timer marching to 95%, because this
      // section's whole claim is that the numbers are measured, not guessed.
      let tick = null;
      try {
        if (loadingText)
          loadingText.textContent = "🔍 Locating landmarks... 40%";
        if (progress) progress.style.width = "40%";

        const analysis = await analyzeFrontPhoto(preview);

        if (loadingText)
          loadingText.textContent = "📏 Classifying face shape... 80%";
        if (progress) progress.style.width = "80%";

        const plan = recommendHairstyles(analysis);

        if (progress) progress.style.width = "100%";
        if (loadingText) loadingText.textContent = "✅ Done — 100%";

        if (!plan) {
          // The engine measured a face but could not certify the frontal metrics
          // (or found no face). Say that plainly instead of inventing a shape.
          setStatus(
            analysis && analysis.noFace
              ? "No face detected in that photo. Use a clear, straight-on shot with your whole head in frame."
              : "Couldn't measure this photo reliably enough to judge face shape. A sharper, front-facing photo with even lighting will work.",
            "note",
          );
          renderNothing();
          return;
        }

        renderPlan(plan);
      } catch (error) {
        console.error("Hairstyle analysis error:", error);
        if (error instanceof ModelLoadError) {
          // Same distinction the scanner makes: a dead model is not a bad photo.
          setStatus("⚠️ " + error.message);
        } else {
          setStatus(
            "Something went wrong reading that photo. Try again, or use a different image.",
            "note",
          );
        }
        renderNothing();
      } finally {
        if (tick) clearInterval(tick);
        // A short hold so "100%" is legible before the bar resets.
        setTimeout(() => setBusy(false), 400);
      }
    });
  }

  function renderNothing() {
    if (results) {
      results.classList.add("hidden");
      results.style.display = "none";
    }
    if (placeholder) placeholder.hidden = false;
  }

  function renderPlan(plan) {
    if (shapeValueEl) shapeValueEl.textContent = plan.shape;
    if (shapeSummaryEl) shapeSummaryEl.textContent = plan.summary;
    if (shapeAvoidEl) shapeAvoidEl.textContent = plan.avoid;

    if (noteEl) {
      noteEl.textContent = plan.note || "";
      noteEl.hidden = !plan.note;
    }

    if (cutHeadingEl) {
      cutHeadingEl.textContent = plan.cuts.length
        ? `Shortlisted cuts (${plan.cuts.length})`
        : "Shortlisted cuts";
    }

    if (cutListEl) {
      cutListEl.innerHTML = "";
      plan.cuts.forEach((cut, index) => {
        const li = document.createElement("li");
        li.className = "hair-cut";

        const rank = document.createElement("span");
        rank.className = "hair-cut__rank";
        rank.textContent = String(index + 1);

        const body = document.createElement("div");
        body.className = "hair-cut__body";

        const name = document.createElement("strong");
        name.className = "hair-cut__name";
        name.textContent = cut.name;

        const why = document.createElement("p");
        why.className = "hair-cut__why";
        // The reason names the measured shape, so the advice is traceable back to
        // a number the user can see on the card above it.
        why.textContent = `${plan.shape} face — ${cut.why}`;

        const tags = document.createElement("div");
        tags.className = "hair-cut__tags";
        cut.tags.forEach((tag) => {
          const t = document.createElement("span");
          t.className = "hair-cut__tag";
          t.textContent = tag;
          tags.appendChild(t);
        });

        body.append(name, why, tags);
        li.append(rank, body);
        li.style.animationDelay = `${index * 70}ms`;
        cutListEl.appendChild(li);
      });
    }

    if (placeholder) placeholder.hidden = true;
    if (results) {
      results.classList.remove("hidden");
      results.style.display = "flex";
    }
  }

  // Start from a clean slate on every load.
  reset();
}
