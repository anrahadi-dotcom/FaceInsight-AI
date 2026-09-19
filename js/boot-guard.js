/* ============================================================================
   file:// guard
   ----------------------------------------------------------------------------
   Opened by double-clicking index.html, this page LOOKS alive: the HTML and CSS
   render, the nav is there, the scan and hairstyle sections are visible. But
   `<script type="module">` is blocked by the browser's CORS rules on the file:
   protocol, so js/main.js never loads and every feature is silently inert. The
   page reports NO console error of its own -- there is simply nothing running to
   produce one. A visitor (or a judge) then clicks "Analyze" and concludes the
   app is broken.

   This file exists to turn that silence into a visible explanation.

   It is a CLASSIC script, not a module, and it is deliberately the only script
   on the page that is. A module here would be blocked by the very rule it is
   reporting, so it has to be plain and self-contained: no imports, no bundle, no
   dependency on anything else having loaded.

   It does two things:
     1. If location.protocol is "file:", shows a banner explaining how to serve
        the page properly.
     2. Regardless of protocol, starts a watchdog on the app's own boot. If the
        app has not come up within a few seconds, that is reported too -- which
        also catches a genuinely broken script on a working server, not just the
        file:// case.
   ============================================================================ */

(function () {
  "use strict";

  // The app marks <body class="no-js"> and main.js removes it once it has booted.
  // That makes it a reliable "did the app start?" signal from outside the app.
  var BOOT_CHECK_MS = 4000;
  var isFileProtocol = window.location.protocol === "file:";

  function buildBanner(opts) {
    var wrap = document.createElement("div");
    wrap.className = "boot-alert";
    wrap.setAttribute("role", "alert");

    var icon = document.createElement("span");
    icon.className = "boot-alert__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";

    var body = document.createElement("div");
    body.className = "boot-alert__body";

    var title = document.createElement("strong");
    title.className = "boot-alert__title";
    title.textContent = opts.title;

    var text = document.createElement("p");
    text.className = "boot-alert__text";
    text.textContent = opts.text;

    body.appendChild(title);
    body.appendChild(text);

    if (opts.commands && opts.commands.length) {
      var list = document.createElement("div");
      list.className = "boot-alert__commands";
      opts.commands.forEach(function (line) {
        var code = document.createElement("code");
        code.textContent = line;
        list.appendChild(code);
      });
      body.appendChild(list);
    }

    if (opts.note) {
      var note = document.createElement("p");
      note.className = "boot-alert__note";
      note.textContent = opts.note;
      body.appendChild(note);
    }

    var close = document.createElement("button");
    close.type = "button";
    close.className = "boot-alert__close";
    close.setAttribute("aria-label", "Dismiss this message");
    close.textContent = "\u00D7";
    close.addEventListener("click", function () {
      wrap.classList.add("is-leaving");
      setTimeout(function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        // Only release the header offset once no banner is left.
        if (!document.querySelector(".boot-alert")) {
          document.body.classList.remove("has-boot-alert");
          document.body.style.removeProperty("--boot-alert-h");
        }
      }, 220);
    });

    wrap.appendChild(icon);
    wrap.appendChild(body);
    wrap.appendChild(close);
    return wrap;
  }

  function show(opts) {
    // Only ever show one.
    if (document.querySelector(".boot-alert")) return;
    var banner = buildBanner(opts);
    document.body.appendChild(banner);
    // Lets the CSS keep the fixed header clear of the banner.
    document.body.classList.add("has-boot-alert");

    // Publish the banner's real height so the header and the page content can
    // both offset themselves by it. Measured rather than guessed: the copy wraps
    // to a different number of lines on a phone vs a desktop, and a hard-coded
    // offset would be wrong on one of them. A ResizeObserver keeps it correct if
    // the text reflows (window resize, orientation change).
    var applyHeight = function () {
      var h = Math.ceil(banner.getBoundingClientRect().height);
      document.body.style.setProperty("--boot-alert-h", h + "px");
    };
    applyHeight();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(applyHeight).observe(banner);
    } else {
      window.addEventListener("resize", applyHeight);
    }

    // Next frame, so the entrance transition actually runs.
    window.requestAnimationFrame(function () {
      banner.classList.add("is-visible");
    });
  }

  function fileProtocolMessage() {
    show({
      title:
        "Open this page through a web server, not by double-clicking the file",
      text:
        "Browsers block JavaScript modules on file:// URLs, so the scanner and the " +
        "hairstyle tool cannot start here. The page itself is fine \u2014 it just has " +
        "no running code behind it, which is why nothing responds and no error appears.",
      commands: [
        'cd "c:\\Code\\FaceInsightAI"',
        "python -m http.server 5500",
        "then open http://localhost:5500",
      ],
      note:
        "In VS Code you can instead right-click index.html and choose " +
        '"Open with Live Server". A deployed URL (Vercel, Netlify) always works.',
    });
  }

  function appDidNotStartMessage() {
    show({
      title: "The app's script did not start",
      text:
        "This page loaded but the application code did not run, so the scan and " +
        "hairstyle buttons will do nothing. Check the browser console (F12) for the " +
        "underlying error \u2014 a blocked or unreachable script is the usual cause.",
      note: "Reloading with the console open will show exactly what failed.",
    });
  }

  function boot() {
    if (isFileProtocol) {
      // The definite case: no need to wait for a timeout, the cause is known.
      fileProtocolMessage();
      return;
    }

    // On a real server, give the app a moment and then check whether it booted.
    window.setTimeout(function () {
      var booted = !document.body.classList.contains("no-js");
      if (!booted) appDidNotStartMessage();
    }, BOOT_CHECK_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
