// Interactive 0-100 gradient scale widget. Hovering (or tapping, on touch)
// previews the value/tier at that point on the track even before a real
// score is set; setScaleValue() then slides a marker to the actual result.

const TIER_TICKS = [
  { pos: 0, label: "Needs work" },
  { pos: 40, label: "Average" },
  { pos: 60, label: "Above avg" },
  { pos: 75, label: "Chad" },
  { pos: 88, label: "Mogger" },
];

export function createScale(mountEl, { withTicks = false, tierForFn = null } = {}) {
  mountEl.innerHTML = "";

  const scale = document.createElement("div");
  scale.className = "scale";

  const track = document.createElement("div");
  track.className = "scale-track";

  const hoverLine = document.createElement("div");
  hoverLine.className = "scale-hover-line";

  const tooltip = document.createElement("div");
  tooltip.className = "scale-tooltip";

  const marker = document.createElement("div");
  marker.className = "scale-marker unset";

  track.appendChild(hoverLine);
  track.appendChild(tooltip);
  track.appendChild(marker);
  scale.appendChild(track);

  if (withTicks) {
    const ticksEl = document.createElement("div");
    ticksEl.className = "scale-ticks";
    for (const t of TIER_TICKS) {
      const span = document.createElement("span");
      span.style.left = `${t.pos}%`;
      span.textContent = t.label;
      ticksEl.appendChild(span);
    }
    scale.appendChild(ticksEl);
  }

  const preview = (clientX) => {
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    hoverLine.style.left = `${pct}%`;
    tooltip.style.left = `${pct}%`;
    tooltip.textContent = tierForFn
      ? `${pct.toFixed(0)} · ${tierForFn(pct)}`
      : pct.toFixed(0);
    hoverLine.style.display = "block";
    tooltip.style.display = "block";
  };

  track.addEventListener("mousemove", (e) => preview(e.clientX));
  track.addEventListener("mouseleave", () => {
    hoverLine.style.display = "none";
    tooltip.style.display = "none";
  });
  track.addEventListener("click", (e) => {
    preview(e.clientX);
    setTimeout(() => {
      hoverLine.style.display = "none";
      tooltip.style.display = "none";
    }, 1500);
  });

  mountEl.appendChild(scale);
  return marker;
}

export function setScaleValue(marker, value) {
  marker.style.left = `${Math.max(0, Math.min(100, value))}%`;
  marker.classList.remove("unset");
}
