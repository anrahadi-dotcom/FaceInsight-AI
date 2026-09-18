// Render the hairstyle section for real, by injecting a plan through the same
// DOM path the controller uses, then screenshot it. This exercises the markup,
// CSS and list-building -- everything except the model download.
export default async function run(page) {
  await page.waitForTimeout(1500);

  // Show the section, then drive its renderer with a real plan from the engine.
  await page.evaluate(async () => {
    const hair = await import("/js/hairstyle.js");
    const plan = hair.recommendHairstyles({
      faceShape: "Round · wide jaw",
      frontalMetricsMeasured: true,
      overallMeasured: true,
      noFace: false,
      faceFat: { score: 38 },
    });

    // Rebuild the list exactly as hairstyle-ui.js does.
    const shapeValueEl = document.getElementById("hairShapeValue");
    const summary = document.getElementById("hairShapeSummary");
    const avoid = document.getElementById("hairShapeAvoid");
    const note = document.getElementById("hairNote");
    const heading = document.getElementById("hairCutHeading");
    const list = document.getElementById("hairCutList");
    const results = document.getElementById("hairResults");
    const placeholder = document.getElementById("hairPlaceholder");

    shapeValueEl.textContent = plan.shape;
    summary.textContent = plan.summary;
    avoid.textContent = plan.avoid;
    note.textContent = plan.note || "";
    note.hidden = !plan.note;
    heading.textContent = `Shortlisted cuts (${plan.cuts.length})`;

    list.innerHTML = "";
    plan.cuts.forEach((cut, i) => {
      const li = document.createElement("li");
      li.className = "hair-cut";
      const rank = document.createElement("span");
      rank.className = "hair-cut__rank";
      rank.textContent = String(i + 1);
      const body = document.createElement("div");
      body.className = "hair-cut__body";
      const name = document.createElement("strong");
      name.className = "hair-cut__name";
      name.textContent = cut.name;
      const why = document.createElement("p");
      why.className = "hair-cut__why";
      why.textContent = `${plan.shape} face — ${cut.why}`;
      const tags = document.createElement("div");
      tags.className = "hair-cut__tags";
      cut.tags.forEach((t) => {
        const s = document.createElement("span");
        s.className = "hair-cut__tag";
        s.textContent = t;
        tags.appendChild(s);
      });
      body.append(name, why, tags);
      li.append(rank, body);
      list.appendChild(li);
    });

    placeholder.hidden = true;
    results.classList.remove("hidden");
    results.style.display = "flex";

    // Also put a photo in the drop slot so the layout is realistic.
    const img = document.getElementById("hairPreview");
    img.src = "/test_photos/jordan_barrett.jpg";
    document.getElementById("hairDrop").classList.add("has-image");
    document.getElementById("hairFileName").textContent = "jordan_barrett.jpg";
  });

  await page.waitForTimeout(900);

  // Frame the RESULTS panel, not the section heading. Scrolling to the heading
  // put the cards below the viewport, so the capture showed the intro copy and
  // nothing that was actually being verified.
  await page.evaluate(() => {
    const el = document.getElementById("hairResults");
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110);
  });
  await page.waitForTimeout(800);

  const box = await page.evaluate(() => ({
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: Math.min(window.innerHeight, 900),
  }));

  await page.screenshot({ path: "tools/shots/_hairstyle.png", clip: box });

  return page.evaluate(() => {
    const cuts = [...document.querySelectorAll(".hair-cut")];
    const r = document.getElementById("hairResults").getBoundingClientRect();
    const firstWhy = document.querySelector(".hair-cut__why");
    return {
      cutCount: cuts.length,
      shape: document.getElementById("hairShapeValue").textContent,
      noteShown: !document.getElementById("hairNote").hidden,
      noteText: document.getElementById("hairNote").textContent.slice(0, 70),
      resultsHeight: Math.round(r.height),
      resultsWidth: Math.round(r.width),
      firstWhyText: firstWhy ? firstWhy.textContent.slice(0, 80) : null,
      // Overflow check: nothing should spill horizontally.
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      shapeColor: getComputedStyle(document.getElementById("hairShapeValue"))
        .color,
      avoidVisible:
        document.getElementById("hairShapeAvoid").textContent.length > 0,
    };
  });
}
