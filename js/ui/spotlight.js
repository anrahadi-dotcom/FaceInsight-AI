// Cursor-following spotlight for cards. Writes the pointer position into the
// --mx / --my custom properties that the CSS radial-gradient reads. Skipped on
// touch devices, where there is no hover to track.

export function initSpotlight(selector = ".spotlight") {
  const cards = Array.from(document.querySelectorAll(selector));
  if (!cards.length) return;

  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!finePointer) return;

  cards.forEach((card) => {
    const onMove = (event) => {
      const rect = card.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty("--mx", `${x.toFixed(2)}%`);
      card.style.setProperty("--my", `${y.toFixed(2)}%`);
    };

    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", () => {
      card.style.removeProperty("--mx");
      card.style.removeProperty("--my");
    });
  });
}
