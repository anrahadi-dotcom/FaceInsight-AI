// ============================================================================
// Hairstyle rendering, now MERGED INTO the scan result.
//
// This file used to be the controller for a standalone "AI Hairstyle" section
// with its OWN upload box and its OWN nav link. That meant a user who wanted both
// a scan and haircut advice had to upload the same face twice, and the two results
// sat in different parts of the page -- the reported "this feels needlessly
// complicated". The haircuts now ride on the SAME analysis the scan already
// produced (no second photo, no second model run) and render inside #scanResults.
//
// The piece main.js needs is `renderHairPlan`, a pure DOM builder: give it a
// container element and a plan from recommendHairstyles() and it fills the
// container. The old section's own listeners are gone with the section.
// ============================================================================

import { recommendHairstyles } from "./hairstyle.js";

// ----------------------------------------------------------------------------
// The list builder. Used by main.js when it renders the haircuts inside the scan
// result through renderHairPlan() below.
// A short plain-language "what to ask the barber for" line per length, so
// expanding a card tells the user something they did not already have.
const LENGTH_ASK = {
  veryshort: "Ask for a single short guard all over, with the sides faded into the top.",
  short: "Ask for short, textured length on top with the sides tapered close.",
  medium: "Ask for medium length left on top, blended into the sides rather than faded tight.",
  long: "Ask for length kept past the jaw with soft layers, so it can still be tied back.",
};

function fillCutList(listEl, plan) {
  listEl.innerHTML = "";
  plan.cuts.forEach((cut, index) => {
    const li = document.createElement("li");
    // The card is a BUTTON-like row: clicking it opens the detail below. The
    // earlier version rendered a plain <li> that LOOKED tappable but did nothing,
    // which is the reported "the haircut buttons do nothing" -- there was no
    // interaction to begin with. It is now a real toggle with aria-expanded.
    li.className = "hair-cut";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-expanded", "false");

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
    // The reason names the measured shape, so the advice is traceable back to a
    // number the user can see on the card above it.
    why.textContent = `${plan.shape} face — ${cut.why}`;

    // Name and tags on one row (see .hair-cut__top).
    const tags = document.createElement("div");
    tags.className = "hair-cut__tags";
    cut.tags.forEach((tag) => {
      const t = document.createElement("span");
      // The era tag is curation metadata, not advice -- hidden by CSS.
      t.className =
        /^\d{4}$/.test(tag) ? "hair-cut__tag hair-cut__tag--era" : "hair-cut__tag";
      t.textContent = tag;
      tags.appendChild(t);
    });

    const top = document.createElement("div");
    top.className = "hair-cut__top";
    top.append(name, tags);

    // The detail revealed on click: what to ask for, plus a chevron hint that the
    // row opens. Hidden until the row is expanded.
    const detail = document.createElement("div");
    detail.className = "hair-cut__detail";
    detail.hidden = true;
    const ask = LENGTH_ASK[cut.length];
    if (ask) {
      const p = document.createElement("p");
      p.className = "hair-cut__ask";
      p.textContent = ask;
      detail.appendChild(p);
    }
    const p2 = document.createElement("p");
    p2.className = "hair-cut__note";
    p2.textContent =
      "Bring this photo or say the name — a barber can adapt it to your hair type.";
    detail.appendChild(p2);

    body.append(top, why, detail);
    li.append(rank, body);
    li.style.animationDelay = `${index * 60}ms`;

    const toggle = () => {
      const open = detail.hidden;
      detail.hidden = !open;
      li.classList.toggle("is-open", open);
      li.setAttribute("aria-expanded", String(open));
    };
    li.addEventListener("click", toggle);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    listEl.appendChild(li);
  });
}

/**
 * Render the haircut advice for a completed scan into the scan result panel.
 *
 * `analysis` is the SAME object the scan just produced -- this function does not
 * take a photo and does not re-run the model, which is the whole point of the
 * merge. It returns true when a plan was written, false when the face could not
 * be measured well enough to judge shape (the panel is then hidden).
 *
 * Called from main.js after a successful scan.
 */
// The analysis of the CURRENT scan, kept so the length buttons can re-rank the
// haircuts without another photo or model run. Cleared when a scan yields no
// usable shape.
let currentAnalysis = null;
let currentLength = "any";
let lengthWired = false;

function paintPlan(plan) {
  const shapeEl = document.getElementById("scanHairShape");
  const summaryEl = document.getElementById("scanHairSummary");
  const avoidEl = document.getElementById("scanHairAvoid");
  const cutListEl = document.getElementById("scanHairCutList");
  if (!plan) return;
  if (shapeEl) shapeEl.textContent = plan.shape;
  if (summaryEl) summaryEl.textContent = plan.summary;
  if (avoidEl) avoidEl.textContent = plan.avoid;
  if (cutListEl) fillCutList(cutListEl, plan);
}

// Wire the length buttons ONCE. Each click re-ranks from the stored analysis;
// there is no second upload and no model call, so it is instant.
function wireLengthButtons() {
  if (lengthWired) return;
  const box = document.getElementById("scanHairLengthBtns");
  if (!box) return;
  lengthWired = true;
  box.addEventListener("click", (event) => {
    const btn = event.target.closest(".scan-hair__len-btn");
    if (!btn || !currentAnalysis) return;
    currentLength = btn.dataset.length || "any";
    [...box.querySelectorAll(".scan-hair__len-btn")].forEach((b) =>
      b.classList.toggle("is-active", b === btn),
    );
    paintPlan(recommendHairstyles(currentAnalysis, { length: currentLength }));
  });
}

/**
 * Render the haircut advice for a completed scan into the scan result panel.
 *
 * `analysis` is the SAME object the scan just produced -- this function does not
 * take a photo and does not re-run the model, which is the whole point of the
 * merge. It returns true when a plan was written, false when the face could not
 * be measured well enough to judge shape (the panel is then hidden).
 *
 * Called from main.js after a successful scan.
 */
export function renderHairPlan(analysis) {
  const panel = document.getElementById("scanHairPanel");
  if (!panel) return false;

  const usable =
    analysis &&
    analysis.frontalMetricsMeasured !== false &&
    analysis.overallMeasured !== false &&
    !analysis.noFace;
  if (!usable) {
    currentAnalysis = null;
    panel.classList.add("hidden");
    return false;
  }

  // A new scan resets the length choice to "Any" so the buttons and the list
  // never disagree (a previous "Long" selection would otherwise leave the buttons
  // showing Long while a fresh face rendered "Any" cuts).
  currentAnalysis = analysis;
  currentLength = "any";
  const box = document.getElementById("scanHairLengthBtns");
  if (box) {
    [...box.querySelectorAll(".scan-hair__len-btn")].forEach((b) =>
      b.classList.toggle("is-active", b.dataset.length === "any"),
    );
  }
  wireLengthButtons();

  const plan = recommendHairstyles(analysis, { length: currentLength });
  if (!plan) {
    // No reliable shape -> no advice. Hide rather than invent a recommendation.
    panel.classList.add("hidden");
    return false;
  }

  paintPlan(plan);
  panel.classList.remove("hidden");
  return true;
}