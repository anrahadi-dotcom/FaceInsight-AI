// Site chrome: sticky header state, reading-progress bar, the mobile
// navigation drawer, active-link highlighting and the back-to-top button.

const MOBILE_BREAKPOINT = 768;
const STUCK_AFTER_PX = 8;
const TO_TOP_AFTER_PX = 620;

export function initNav() {
  const header = document.getElementById("siteHeader");
  const navLinks = document.getElementById("navLinks");
  const navToggle = document.getElementById("navToggle");
  const progressBar = document.getElementById("scrollProgressBar");
  const toTop = document.getElementById("toTop");

  if (!header || !navLinks || !navToggle) return;

  const drawer = createDrawer(navToggle, navLinks);
  const spy = createScrollSpy(navLinks);

  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = window.scrollY;

      header.classList.toggle("is-stuck", y > STUCK_AFTER_PX);
      toTop?.classList.toggle("is-visible", y > TO_TOP_AFTER_PX);

      if (progressBar) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = max > 0 ? Math.min(1, y / max) : 0;
        progressBar.style.width = `${ratio * 100}%`;
      }

      spy.update();
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    if (window.innerWidth > MOBILE_BREAKPOINT) drawer.close();
    spy.update();
  });

  // Any in-page link closes the drawer before the smooth scroll starts.
  navLinks.addEventListener("click", (event) => {
    if (event.target.closest("a")) drawer.close();
  });

  toTop?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  onScroll();
}

/* --------------------------------------------------------------- drawer */

function createDrawer(navToggle, navLinks) {
  const setOpen = (open) => {
    navLinks.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute(
      "aria-label",
      open ? "Close navigation menu" : "Open navigation menu"
    );
  };

  navToggle.addEventListener("click", () => {
    setOpen(!navLinks.classList.contains("is-open"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (window.innerWidth > MOBILE_BREAKPOINT) return;
    if (!navLinks.classList.contains("is-open")) return;
    const inNav = navLinks.contains(event.target) || navToggle.contains(event.target);
    if (!inNav) setOpen(false);
  });

  return {
    close: () => setOpen(false),
  };
}

/* ----------------------------------------------------------- scroll spy */

function createScrollSpy(navLinks) {
  const links = Array.from(navLinks.querySelectorAll(".nav-link"));
  const targets = links
    .map((link) => {
      const hash = link.getAttribute("href");
      const section = hash && hash.length > 1 ? document.querySelector(hash) : null;
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  let active = null;

  const update = () => {
    if (!targets.length) return;

    const headerHeight =
      document.getElementById("siteHeader")?.offsetHeight ?? 74;
    const probe = headerHeight + 96;

    let current = targets[0];

    for (const entry of targets) {
      if (entry.section.getBoundingClientRect().top <= probe) current = entry;
    }

    const atBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 4;
    if (atBottom) current = targets[targets.length - 1];

    if (current.link === active) return;

    active?.classList.remove("is-active");
    current.link.classList.add("is-active");
    active = current.link;
  };

  return { update };
}
