// ============================================================================
// Connectivity awareness.
//
// WHY THIS EXISTS
//
// Everything the engine needs is cached by the browser after the first successful
// load: the MediaPipe WASM bundle, the .task model and the face-api weights. So
// once a user has scanned once, switching off WiFi changes nothing -- the scan
// still completes, and correctly so. The user then sees "no error", concludes the
// error handling is broken, and has no way to know the app is simply running from
// cache.
//
// That is a real gap in the UI, not in the loading logic: the app should say
// WHICH mode it is in, so "no error while offline" reads as a feature rather than
// a missing feature.
//
// This module answers one question -- "can the model still be reached?" -- and
// exposes the answer as a state the two scan sections can render:
//
//   "online"      first load is possible; nothing to say
//   "cached"      offline, but the model is already in memory; scanning still works
//   "unavailable" offline with no cached model; scanning will fail
//
// It never blocks anything. It only labels what is already true, because
// preventing a scan that would have worked is worse than letting one run.
// ============================================================================

const listeners = new Set();

// "online" | "cached" | "unavailable"
let state = "online";
// Set by faceEngine once the model is resident in memory.
let modelReady = false;

function computeState() {
  const online =
    typeof navigator === "undefined" ? true : navigator.onLine !== false;
  if (online) return "online";
  return modelReady ? "cached" : "unavailable";
}

function publish() {
  const next = computeState();
  if (next === state) return;
  state = next;
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (error) {
      console.error("connectivity listener failed:", error);
    }
  });
}

/**
 * Record that the face model is loaded and usable. Call this from the engine the
 * moment a model call succeeds -- it is what distinguishes "offline but fine"
 * from "offline and broken".
 */
export function markModelReady() {
  if (modelReady) return;
  modelReady = true;
  publish();
}

/** Current state, for a caller that needs it without subscribing. */
export function getConnectionState() {
  return computeState();
}

/**
 * Subscribe to state changes. Returns an unsubscribe function so a caller can
 * clean up (the sections are long-lived, but tests are not).
 */
export function onConnectionChange(fn) {
  listeners.add(fn);
  // Fire immediately with the current value so the caller does not have to
  // special-case "what was it before I subscribed".
  fn(computeState());
  return () => listeners.delete(fn);
}

/**
 * The message to show for a state, or null when there is nothing worth saying.
 * Wording is deliberately non-alarming for "cached": the app is working.
 */
export function connectionNotice(current) {
  switch (current) {
    case "cached":
      return {
        tone: "info",
        text:
          "You are offline — the face model is running from your browser's cache, so " +
          "the scan still works. Results may be treated as final once you reconnect.",
      };
    case "unavailable":
      return {
        tone: "warn",
        text:
          "You are offline and the face model is not cached yet. Reconnect once to " +
          "download it (about 15–20 MB); after that it works offline.",
      };
    default:
      return null;
  }
}

// Wire the browser's own events. Both are registered once, at module load, so
// every subscriber shares a single source of truth.
if (typeof window !== "undefined") {
  window.addEventListener("online", publish);
  window.addEventListener("offline", publish);
}
