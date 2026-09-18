// Interactive 0-100 gradient scale widget. Hovering (or tapping, on touch)
// previews the value/tier at that point on the track even before a real
// score is set; setScaleValue() then slides a marker to the actual result.

export function renderTicks(ticksEl, ticks) {
  ticksEl.innerHTML = "";
  ticks.forEach((t, i) => {
    const span = document.createElement("span");
    span.style.left = `${t.pos}%`;
    // Stagger alternating labels onto a second row -- six tight tiers
    // would otherwise overlap each other's text.
    if (i % 2 === 1) span.classList.add("tick-low");
    span.textContent = t.label;
    ticksEl.appendChild(span);
  });
}

export function createScale(mountEl, { ticks = null, tierForFn = null } = {}) {
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

  let ticksEl = null;
  if (ticks) {
    ticksEl = document.createElement("div");
    ticksEl.className = "scale-ticks";
    renderTicks(ticksEl, ticks);
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
  return { marker, ticksEl };
}

export function setScaleValue(marker, value) {
  marker.style.left = `${Math.max(0, Math.min(100, value))}%`;
  marker.classList.remove("unset");
}
