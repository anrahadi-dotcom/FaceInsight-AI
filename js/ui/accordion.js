// FAQ accordion. One panel open at a time, driven by a class so the open and
// close transitions both come from CSS (grid-template-rows 0fr -> 1fr, which
// animates without needing a measured height).

export function initAccordion(selector = ".faq-item") {
  const items = Array.from(document.querySelectorAll(selector));
  if (!items.length) return;

  const closeItem = (item) => {
    item.classList.remove("is-open");
    item.querySelector(".faq-question")?.setAttribute("aria-expanded", "false");
  };

  const openItem = (item) => {
    item.classList.add("is-open");
    item.querySelector(".faq-question")?.setAttribute("aria-expanded", "true");
  };

  items.forEach((item) => {
    const button = item.querySelector(".faq-question");
    if (!button) return;

    button.addEventListener("click", () => {
      const willOpen = !item.classList.contains("is-open");

      items.forEach((other) => {
        if (other !== item) closeItem(other);
      });

      if (willOpen) openItem(item);
      else closeItem(item);
    });
  });
}
