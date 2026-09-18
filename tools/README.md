# tools/ — development harness

Scripts used to drive the real app in a headless browser and check that a change
actually works _in the page_, rather than reading the source and assuming it does.
None of this ships: nothing in `index.html`, `css/` or `js/` imports from here.

## Running anything here

Every script under `checks/`, `probes/`, `repros/` and `shots/` exports
`async (page, ui) => result` for the browser-automation runner, so they all take
the same shape:

```bash
# 1. Serve the app. The port matters: the scripts default to 5501.
python -m http.server 5501

# 2. Run a script against it.
node <browser-automation>/browser.mjs http://localhost:5501/index.html \
  --script ./tools/checks/verifyStrengths.mjs
```

`ORIGIN` overrides the default `http://localhost:5501` when you serve elsewhere.

**Serve over HTTP, never open `index.html` from disk.** The app is ES modules, so
`file://` blocks every `import` and `js/main.js` never runs — a script then
reports a blank, error-free page and looks like a pass. That false pass is the
single easiest way to waste an afternoon here.

## Layout

| Folder    | What lives there                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks/` | Assertions about the shipped app: does the scorer's output match, does a real scan render the card, does the UI still work after a change. **Start here.**          |
| `probes/` | Read-only investigations into what the engine reports for a given input (eye area, iris, profile line, soft tissue). No assertions — they print numbers to look at. |
| `repros/` | Minimal builds that reproduce one specific bug, plus the tuning scripts used while fixing it. Kept because the bug can come back.                                   |
| `shots/`  | Screenshot helpers. These write PNGs next to themselves; delete them after looking.                                                                                 |

## `verifyStrengths.mjs` and its output

`checks/verifyStrengths.mjs` checks the "Your strengths" feature at two levels:
the engine's picks for four real photos, and the card as rendered in the DOM.

It **warms the landmarker up first** and waits 1500ms before the first detect.
That is deliberate: `analyzeFrontPhoto` loads the model lazily, and a cold call
returns `noFace`, which makes every strength list come back empty and looks like
an engine bug when it is only model-load latency. If you see `engineStrengths`
full of `[]`, check the warm-up before suspecting `computeStrengths`.

Console output from these runs is scratch — read it, then delete it. Do not
leave it in the repo root: a stray dotfile named like `.json` reads as
configuration and gets mistaken for part of the app.
