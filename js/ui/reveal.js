// Scroll-reveal for [data-reveal] blocks and count-up for [data-count] numbers.
// Elements only animate the first time they enter the viewport, and the whole
// thing is skipped when the user prefers reduced motion.

const REVEAL_THRESHOLD = 0.15;
const COUNT_DURATION_MS = 1300;

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function initReveal() {
  const reveals = Array.from(document.querySelectorAll("[data-reveal]"));
  const counters = Array.from(document.querySelectorAll("[data-count]"));

  if (prefersReducedMotion()) {
    reveals.forEach((el) => el.classList.add("is-revealed"));
    counters.forEach((el) => {
      el.textContent = formatCount(Number(el.dataset.count));
    });
    return;
  }

  reveals.forEach((el) => {
    const delay = Number(el.dataset.revealDelay || 0);
    if (delay > 0) el.style.setProperty("--reveal-delay", `${delay}ms`);
  });

  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    },
    { threshold: REVEAL_THRESHOLD, rootMargin: "0px 0px -8% 0px" }
  );

  reveals.forEach((el) => revealObserver.observe(el));

  if (!counters.length) return;

  const countObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        countUp(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.5 }
  );

  counters.forEach((el) => countObserver.observe(el));
}

function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "0";
}

function countUp(el) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target)) return;

  // "Server uploads: 0" should read as a fact, not count up from nothing.
  if (target === 0) {
    el.textContent = "0";
    return;
  }

  const start = performance.now();

  const step = (now) => {
    const progress = Math.min(1, (now - start) / COUNT_DURATION_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatCount(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}
