// Lightweight toast notifications. Used by the scanner (photo added, scan
// failed, low-quality warning) and by any other module that needs to tell the
// user something without blocking the flow.

const ICONS = {
  success:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  info:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};

const DEFAULT_DURATION = 4200;

function stack() {
  return document.getElementById("toastStack");
}

/**
 * Shows a toast. `type` is one of "info" | "success" | "error".
 * Returns a function that dismisses the toast early.
 */
export function showToast(message, type = "info", duration = DEFAULT_DURATION) {
  const container = stack();
  if (!container || !message) return () => {};

  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "toast__icon";
  icon.innerHTML = ICONS[type] || ICONS.info;

  const text = document.createElement("span");
  text.className = "toast__text";
  text.textContent = message;

  el.append(icon, text);
  container.appendChild(el);

  let timer = null;

  const dismiss = () => {
    if (timer) clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    // Fallback in case animations are disabled by prefers-reduced-motion.
    setTimeout(() => el.remove(), 400);
  };

  if (duration > 0) timer = setTimeout(dismiss, duration);

  return dismiss;
}
