// Verify the boot guard's layout maths: does the header clear the banner, and is
// the page content offset by the banner's measured height?
export default async function run(page) {
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const banner = document.querySelector(".boot-alert");
    const header = document.querySelector(".site-header");
    if (!banner || !header) {
      return {
        banner: !!banner,
        header: !!header,
        note: "one or both missing",
      };
    }
    const br = banner.getBoundingClientRect();
    const hr = header.getBoundingClientRect();
    const cs = getComputedStyle(document.body);

    return {
      bannerHeight: Math.round(br.height),
      bannerBottom: Math.round(br.bottom),
      cssVar: cs.getPropertyValue("--boot-alert-h").trim(),
      headerTop: Math.round(hr.top),
      // The header must start at or below the banner's bottom edge, or the nav
      // is covered and unclickable.
      navIsClickable: hr.top >= br.bottom - 1,
      bodyPaddingTop: cs.paddingTop,
      // The hero's own top padding is counted from the padded body, so the pill
      // should sit below the banner too.
      heroPillTop: (() => {
        const pill = document.querySelector(".hero .pill");
        return pill ? Math.round(pill.getBoundingClientRect().top) : null;
      })(),
      hasBootClass: document.body.classList.contains("has-boot-alert"),
    };
  });
}
