// Single entry point for the page chrome. Keeps main.js focused on the face
// scanner by hiding the nav / reveal / accordion / spotlight wiring here.

import { initNav } from "./nav.js";
import { initReveal } from "./reveal.js";
import { initAccordion } from "./accordion.js";
import { initSpotlight } from "./spotlight.js";

export { showToast } from "./toast.js";
export { prefersReducedMotion } from "./reveal.js";

export function initUI() {
  initNav();
  initReveal();
  initAccordion();
  initSpotlight();
  stampFooterYear();
  dropNoJsClass();
}

// The <body> ships with class="no-js" so that, without JavaScript, nothing is
// hidden behind an animation that will never run. Nothing ever removed it, so
// the guard in style.css (`body:not(.no-js) [data-reveal] { opacity: 0 }`) never
// matched and the scroll-reveal animation was silently dead -- every [data-reveal]
// block was simply always visible.
//
// It is dropped HERE, at the end of initUI, and not earlier: initReveal() has to
// have registered its IntersectionObserver first, otherwise removing the class
// would hide every reveal block and leave them waiting for an observer that is
// not there yet. As written, the moment the class is gone the observer already
// owns the elements, so they cannot be stranded at opacity 0.
function dropNoJsClass() {
  document.body.classList.remove("no-js");
}

function stampFooterYear() {
  const yearEl = document.getElementById("year");
  if (!yearEl) return;
  yearEl.textContent = String(new Date().getFullYear());
}
