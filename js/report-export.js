// ============================================================================
// PDF export for the scan report.
//
// WHY window.print() AND NOT A PDF LIBRARY
//
// jsPDF, pdfmake and friends all add 200-400KB fetched from a CDN, and this app
// has already been bitten by a blocked CDN taking the whole page down. A print
// stylesheet adds ZERO network dependency, works offline, and every browser's
// print dialog already offers "Save as PDF" -- so the user gets a real PDF file
// without the app shipping a PDF engine.
//
// The trade-off, stated honestly: the page is printed by the browser's layout
// engine, so the output is a paginated document rather than a pixel-perfect
// canvas. For a report of numbers and text that is the better trade -- the text
// stays selectable and searchable, which a canvas-rendered PDF would lose.
//
// HOW IT WORKS
// 1. Collect the rendered report values from the DOM (the same numbers the user
//    is looking at -- nothing is recomputed, so the PDF can never disagree with
//    the screen).
// 2. Put a dedicated, print-only report block in the document.
// 3. Add a class to <body> that hides everything except that block.
// 4. Call print(). The class is removed afterwards, on both paths.
// ============================================================================

const PRINT_CLASS = "printing-report";

// Grab text from an element by id, with a fallback so a missing label prints as
// an em dash rather than "undefined".
function textOf(id) {
  const el = document.getElementById(id);
  const t = el ? el.textContent.trim() : "";
  return t || "\u2014";
}

// The scan's own detail cards. These live in #scanResults and use the
// .scan-detail-card structure -- NOT .report-row, which belongs to the separate
// "what you get" demo section (#reportList) further up the page. Reading the
// wrong container produced a report with a Verdict and no measurements at all.
function readDetailCards() {
  const out = [];
  document.querySelectorAll("#scanResults .scan-detail-card").forEach((card) => {
    const label = card.querySelector("h4");
    const value = card.querySelector("p");
    if (!label || !value) return;
    const v = value.textContent.trim();
    // Skip anything unmeasured: a report full of "--" reads as broken.
    if (!v || v === "--" || v === "\u2014" || /^n\/?a\b/i.test(v)) return;
    out.push({ label: label.textContent.trim(), value: v });
  });
  return out;
}

// The eye-area sub-block, which has its own markup and its own heading.
function readEyeReadings() {
  const out = [];
  const panel = document.getElementById("scanEyePanel");
  if (!panel) return out;
  panel.querySelectorAll(".scan-eye-item").forEach((item) => {
    const label = item.querySelector(".scan-eye-item__label");
    const value = item.querySelector(".scan-eye-item__value");
    if (!label || !value) return;
    const v = value.textContent.trim();
    if (!v || v === "--") return;
    out.push({ label: label.textContent.trim(), value: v });
  });
  return out;
}

// The two headline scale readings, which are styled differently to the cards.
function readHeadlineMetrics() {
  const pairs = [
    ["Symmetry", "scanSymmetryScore"],
    ["Facial harmony", "scanGoldenScore"],
    ["Eye area", "scanEyeAreaValue"],
    ["Potential", "scanPotentialScore"],
  ];
  return pairs
    .map(([label, id]) => {
      const el = document.getElementById(id);
      const v = el ? el.textContent.trim() : "";
      return v && v !== "--" ? { label, value: v } : null;
    })
    .filter(Boolean);
}

// The profile panel's four readings, when a side photo was supplied.
function readSideReadings() {
  const out = [];
  const panel = document.getElementById("scanSideProfilePanel");
  if (!panel || panel.classList.contains("hidden")) return out;
  panel.querySelectorAll(".scan-side-item").forEach((item) => {
    const label = item.querySelector(".scan-side-item__label");
    const value = item.querySelector(".scan-side-item__value");
    if (label && value) {
      out.push({ label: label.textContent.trim(), value: value.textContent.trim() });
    }
  });
  return out;
}

function readStrengthList() {
  const out = [];
  document.querySelectorAll("#scanStrengthList .scan-strength-item").forEach((item) => {
    const name = item.querySelector(".scan-strength-item__name");
    const score = item.querySelector(".scan-strength-item__score");
    if (name) {
      out.push({
        name: name.textContent.trim(),
        score: score ? score.textContent.trim() : "",
      });
    }
  });
  return out;
}

function readTips() {
  return [...document.querySelectorAll("#scanTipsList li")]
    .map((li) => li.textContent.trim())
    .filter(Boolean);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  // Built from parts so the delimiter order is readable at a glance.
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

  function section(title, inner) {
  const wrap = document.createElement("section");
  wrap.className = "print-block";
  const h = document.createElement("h2");
  h.textContent = title;
  wrap.appendChild(h);
  if (typeof inner === "string") {
    const p = document.createElement("p");
    p.className = "print-text";
    p.textContent = inner;
    wrap.appendChild(p);
  } else {
    wrap.appendChild(inner);
  }
  return wrap;
}

function definitionList(pairs) {
  const dl = document.createElement("dl");
  dl.className = "print-dl";
  pairs.forEach(({ label, value }) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  });
  return dl;
}

/**
 * Build the print-only report from what is currently on screen.
 * Returns the element, or null when there is no report to print.
 */
export function buildPrintReport() {
  const results = document.getElementById("scanResults");
  // Printing before a scan would produce an empty sheet, so refuse instead.
  if (!results || results.classList.contains("hidden")) return null;

  const report = document.createElement("article");
  report.className = "print-report";

  const head = document.createElement("header");
  head.className = "print-head";
  const title = document.createElement("h1");
  title.textContent = "FaceInsight AI \u2014 Facial analysis report";
  const meta = document.createElement("p");
  meta.className = "print-meta";
  meta.textContent = "Generated " + stamp() + " \u00B7 analysed on-device";
  head.append(title, meta);
  report.appendChild(head);

  // Verdict: the tier and the overall score, which are the headline findings,
  // plus the plain-language note when the page is showing one.
  const verdictPairs = [
    { label: "Overall score", value: textOf("scanOverallScore") },
    { label: "Tier", value: textOf("scanTier") },
  ];
  const noteEl = document.getElementById("scanVerdictNote");
  const noteText = noteEl ? noteEl.textContent.trim() : "";
  const verdictBody = document.createElement("div");
  verdictBody.appendChild(definitionList(verdictPairs));
  if (noteText) {
    const p = document.createElement("p");
    p.className = "print-text";
    p.textContent = noteText;
    verdictBody.appendChild(p);
  }
  report.appendChild(section("Verdict", verdictBody));

  // Headline readings, then the detail cards, then the eye sub-block. Three
  // separate groups because the page presents them that way -- merging them
  // would lose the hierarchy the report already has on screen.
  const headline = readHeadlineMetrics();
  if (headline.length) {
    report.appendChild(section("Headline readings", definitionList(headline)));
  }

  const details = readDetailCards();
  if (details.length) {
    report.appendChild(section("Measurements", definitionList(details)));
  }

  const eye = readEyeReadings();
  if (eye.length) {
    report.appendChild(section("Eye area composite", definitionList(eye)));
  }

  // Side-profile readings, only when they exist.
  const side = readSideReadings();
  if (side.length) {
    report.appendChild(section("Side profile (measured from slot 2)", definitionList(side)));
  }

  // Strengths.
  const strengths = readStrengthList();
  if (strengths.length) {
    const ul = document.createElement("ul");
    ul.className = "print-list";
    strengths.forEach((s) => {
      const li = document.createElement("li");
      li.textContent = s.score ? s.name + " \u2014 " + s.score : s.name;
      ul.appendChild(li);
    });
    report.appendChild(section("Your strengths", ul));
  }

  // Tips / plan.
  const tips = readTips();
  if (tips.length) {
    const ul = document.createElement("ul");
    ul.className = "print-list print-list--tips";
    tips.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
    report.appendChild(section("Grooming plan", ul));
  }

  const disc = document.createElement("p");
  disc.className = "print-disclaimer";
  disc.textContent =
    "These readings are geometric measurements taken from a single photograph, not a " +
    "medical or psychological assessment. Lighting, lens distortion and head angle all " +
    "affect them. Weight them as one opinion, not a verdict.";
  report.appendChild(disc);

  return report;
}

/**
 * Print the current report. Returns true when a print was started, false when
 * there was nothing to print (the caller shows a message in that case).
 */
export function printScanReport() {
  const report = buildPrintReport();
  if (!report) return false;

  // Remove any previous print block so repeated exports cannot stack up.
  document.querySelectorAll(".print-report").forEach((el) => el.remove());

  document.body.appendChild(report);
  document.body.classList.add(PRINT_CLASS);

  // The report must stay in the DOM for the WHOLE time the print dialog is open.
  //
  // CLEANUP FIX. The previous version removed the block on a hard 8-second timer.
  // Where window.print() blocks synchronously that is harmless (the timer only
  // starts once the dialog closes), but several browsers return from print()
  // immediately and render the dialog asynchronously -- and a user who takes a
  // moment to pick "Save as PDF" would then have the block deleted out from under
  // the open dialog, printing a BLANK page. That matches the reported "I click
  // Download PDF and nothing comes out". Cleanup is now driven by `afterprint`
  // (which fires after the dialog closes, whether printed or cancelled) with only
  // a long, generous fallback, so the report cannot disappear while printing.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener("afterprint", cleanup);
    document.body.classList.remove(PRINT_CLASS);
    if (report.parentNode) report.parentNode.removeChild(report);
  };
  window.addEventListener("afterprint", cleanup);
  // Safety net only: long enough that it can never fire during a normal print
  // session, short enough that a browser which never fires afterprint still tidies
  // up. (2 minutes, not 8 seconds.)
  window.setTimeout(cleanup, 120000);

  window.print();
  return true;
}
