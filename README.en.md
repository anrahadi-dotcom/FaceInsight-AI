# FaceInsight AI

🌐 **English** | [English](README.en.md)

**Face analysis from a photo, right in your browser. Your photo never leaves your device.**

FaceInsight AI reads your photo, measures your facial proportions, and gives you a full report: scores, a plain-language explanation of each one, and practical tips you can start using right away. Everything runs on your own device. No server, no account, no API key.


## Why this project exists

Most face analysis apps ask you to upload your photo to someone else's server, and the result is usually a single number with no explanation. FaceInsight AI is built to fix both:

1. **Privacy.** Your photo is processed inside the browser tab and disappears when you close it. There is no upload endpoint at all.
2. **Transparency.** Every score comes from geometry you can trace back to a specific point on the face. It is not a black box that suddenly spits out a number.

---

## Key features

- **478-point face scan.** Mapped automatically with Google's MediaPipe FaceLandmarker.
- **10 scored metrics.** Symmetry, golden ratio, face shape, canthal tilt, facial harmony, skin quality, skin clarity, eye shape, face fat, and jawline.
- **Detailed eye-area analysis.** The score is not a single number. You can see how each part is weighted (canthal tilt 30%, eye projection 25%, eyelid exposure 25%, brow and eye spacing 20%), so it is clear which part is lifting or dragging the score.
- **Optional side-profile analysis.** Add a profile photo to unlock a report on the gonial angle, ramus, mandible, eye projection, nose, and profile line.
- **Photo quality check.** The app checks detection confidence, lighting, sharpness, and head angle. If the photo is not good enough, it tells you instead of giving a made-up score.
- **Potential and strengths.** Shows which areas can still be improved (skin, face fat, jaw definition, eyelid exposure) and your four strongest features.
- **Tips that adapt to your result.** Advice is picked based on the weakest scores in your photo, so two different people do not get the same tips.

---

## How to use it

1. **Upload a photo.** Use a sharp, evenly lit, front-facing shot. Drag and drop it or click to browse.
2. **Wait for the scan.** Facial landmarks are detected and measured right in the browser, usually in about 10 seconds.
3. **Read your report.** You get a score, a tier, an explanation of each metric, and the tips worth tackling first.

You can add a side photo in the second slot for a fuller profile report.

---

## How it works

| Step | What happens | Technology |
|---|---|---|
| 1. Face detection | The photo is read and 478 facial points are mapped | MediaPipe FaceLandmarker |
| 2. Head-angle check | The app decides whether the photo is front, three-quarter, or side view from the 3D depth of the face points | Z-axis data from the MediaPipe mesh |
| 3. Measurement | Distances, angles, and ratios between points become a score for each metric | Geometry calculations in `js/faceEngine.js` |
| 4. Gender detection | Used only to pick tier names and tip wording, never to change the scores | face-api.js (TinyFaceDetector + AgeGenderNet) |
| 5. Report | Scores are combined by weight, matched to a tier, and tips are selected | `js/tips.js` |

For photos where the head is turned close to 90°, the main model often fails to find a face. That is why there are fallback detectors (BlazeFace and SSD MobileNet) that can at least confirm a face is present in the photo.

---

## Privacy

- Your photo is only read by your browser tab and is never sent to any server.
- There are no accounts, no database, and no stored results.
- The only internet connections are for downloading the **AI model files** and fonts from public CDNs (jsDelivr and Google Storage). Once downloaded, your browser caches them.

---

## Tech stack

- Plain HTML, CSS, and JavaScript (ES Modules). **No framework and no build step.**
- [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) `0.10.14` for face mapping.
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) `0.22.2` for gender detection and the side-profile fallback detector.
- Inter and Space Grotesk fonts from Google Fonts.

All the models and libraries above are free and need no API key.

---

## Running it locally

The site uses ES Modules, so it cannot be opened directly through `file://`. Serve it through a local server. Pick whichever you already have installed:

**Option A: Node.js**
```bash
npx serve . -l 5501
```

**Option B: Python**
```bash
python -m http.server 5501
```

**Option C: VS Code**
Install the *Live Server* extension, right-click `index.html`, and choose *Open with Live Server*.

Then open `http://localhost:5501` in **Google Chrome**. Firefox and Safari can load the site, but the gender-detection model has only been tested in Chrome.

> You need an internet connection on the first load, since the AI models are downloaded from a CDN. The site is fully static, so it can be hosted on any static hosting service (Vercel, Netlify, GitHub Pages, and so on).

---

## Folder structure

```
index.html            Main page (hero, features, scanner, FAQ, footer)
css/style.css         All styling
css/responsive.css    Adjustments for phone and tablet screens
js/main.js            Runs the UI: upload, drag & drop, progress bar, results
js/faceEngine.js      Face detection + all the scoring logic
js/scale.js           The interactive 0-100 gradient scale
js/tips.js            Tip library, picked by gender and scan result
js/ui/                Page components: nav menu, FAQ, scroll animations, toast
tools/                Developer-only scripts for testing and tuning the scores
test_photos/          Test photos used to tune the scores
```

---

## Limitations (so it is clear from the start)

- **This is not a scientific or medical tool.** Scores are calculated from facial geometry and hand-tuned using a small set of test photos. Results are for fun and general direction, not a valid measure of attractiveness.
- **Photo quality matters a lot.** Blurry or dark photos, or ones with heavy filters, will make the scores jump around.
- **Gender detection can be wrong.** If detection fails, the system defaults to "male". This only affects tier names and tip wording, not the scores.
- **The MediaPipe iris model is deliberately not used.** Its iris circle has a fixed size and is not clipped by the eyelids, so it cannot serve as a reference for measuring the white of the eye (sclera). The proof is in `tools/probeIris.mjs`. Instead, the visible sclera is read from the eye opening.
- **Tiers are just helper labels.** Tier names (Low Tier up to True Adam for men, and up to Eve for women) follow terms popular in the looksmaxxing community and are not an official standard. The score cutoffs are tuned from the available test photos.

---

## Notes for whoever picks this up next

- The constants in `js/faceEngine.js` (weights, tier cutoffs, head-angle thresholds) have comments explaining the reason behind each number. Read them before changing anything.
- The scripts in `tools/` (for example `probeIris.mjs`, `probeProfile.mjs`, `scoringCheck.mjs`) are used to pick thresholds from real detections. Run them before changing any constant they cover.
- `.env*` and `.vercel/` are in `.gitignore` because they hold deploy tokens and are not part of this project.

---

## Contact

Built by **anrahadi**
📧 anrahadi02@gmail.com
🐙 [github.com/anrahadi-dotcom](https://github.com/anrahadi-dotcom)

_This project was made for educational and portfolio purposes. The scores are geometric estimates for fun, not a medical measurement._
