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
}

function stampFooterYear() {
  const yearEl = document.getElementById("year");
  if (!yearEl) return;
  yearEl.textContent = String(new Date().getFullYear());
}
