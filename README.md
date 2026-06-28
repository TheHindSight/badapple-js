# Bad Apple, but it's everything

The real Bad Apple!! animation, decoded once and replayed inside 34 different
app interfaces (Minesweeper, Google Maps, a terminal, a Game Boy, and more).
All rendering goes through one shared "forms" API, so every app is a thin page
that just picks a form and a theme.

## Quick start

No build step. Open the files in a modern Chromium or Firefox browser.

- `index.html` - the gallery. Every tile is a live preview; click one to open
  that app full screen.
- `apps/<slug>/index.html` - an individual app. Opens directly, including from
  `file://` (double-click).

Audio is muted until you interact, because browsers block autoplay. Click
anywhere (or press a key) once and the sound starts, locked in sync with the
video. There is no on-screen UI; the page only plays the animation.

## How an app is built

Each `apps/<slug>/index.html` is a small page that loads three scripts and sets
one options object:

```html
<div id="stage"></div>
<script>window.BADAPPLE_OPTS = { form: "elements", target: "stage", black: "X", cols: 48 };</script>
<script src="../../shared/frames-data.js"></script>
<script src="../../shared/badapple.js"></script>
<script src="../../shared/badapple-anywhere.js"></script>
```

`badapple-anywhere.js` auto-loads the engine if needed, reads `BADAPPLE_OPTS`,
and starts playing. That is the entire app.

## The forms API

`shared/badapple-anywhere.js` exposes `window.BadAppleAnywhere`.

### Options (`window.BADAPPLE_OPTS` or `BadAppleAnywhere.start(opts)`)

| Option    | Meaning |
|-----------|---------|
| `form`    | Which renderer to use (see below). Default `"video"`. |
| `target`  | Element or id (`"stage"` or `"#stage"`) to render into. Omit for a floating box. |
| `black`   | What to show where the figure is (the `elements` form). |
| `white`   | What to show where the background is (the `elements` form). |
| `cols`, `rows` | Grid / sample resolution (the `elements` and `ascii` forms). |
| `sound`   | `true` by default. Audio is the master clock, so video stays in sync. |
| `opacity` | Initial opacity, 0 to 1. |
| `loop`    | `true` by default. |

`black` and `white` accept any of:

- an element, e.g. `document.querySelector(".logo")`
- an id string, `"logo"` or `"#logo"` (the element is cloned into each pixel)
- an HTML string, `"<img src='chrome.svg'>"`
- plain text or a single character, `"X"`
- a function that returns a fresh node

Example: use a Chrome logo as the black pixels.

```html
<img id="chrome" src="chrome.svg" hidden>
<div id="stage"></div>
<script>window.BADAPPLE_OPTS = { form: "elements", target: "stage", black: "#chrome", cols: 64 };</script>
```

### Built-in forms

| Form       | What it does |
|------------|--------------|
| `video`    | The real animation drawn to a canvas. |
| `full`     | Fullscreen, click-through pixel overlay. |
| `ascii`    | Monospace ASCII shadow. |
| `elements` | Tiles your own elements as the black/white pixels. |
| `infect`   | The page's own text lights up to form the silhouette. |
| `chrome`   | Animates the favicon and the tab title only. |

### Methods

```js
BadAppleAnywhere.start(opts)   // start, or reconfigure if already running
BadAppleAnywhere.mode(name)    // switch form at runtime
BadAppleAnywhere.play()
BadAppleAnywhere.pause()
BadAppleAnywhere.toggle()
BadAppleAnywhere.stop()        // remove everything
BadAppleAnywhere.forms()       // list registered form names
BadAppleAnywhere.player        // the underlying player
```

### Custom forms

Register your own renderer. The factory receives an `env` with engine helpers
and returns an object with `start`, `stop`, and `render(frameIndex)`:

```js
BadAppleAnywhere.register("rings", function (env) {
  // env: BA, opts(), paintVideo(f), sample(c, r, f), sampleCoverage(c, r, f),
  //      getBit(f, x, y), el(), drag(), resolveNode(), mount([w, h]), Z
  return {
    start()   { /* build your DOM */ },
    stop()    { /* tear it down */ },
    render(f) { /* draw frame f */ },
    host()    { /* optional: element to apply opacity to */ }
  };
});
BadAppleAnywhere.start({ form: "rings" });
```

## Using it on any web page

The same script can play Bad Apple on a site you do not own, but the assets
must be served over HTTP (not `file://`). Serve the folder, then point the
script at it:

```bash
# from the repo root
python -m http.server 8000
# shared/ is now at http://localhost:8000/shared/
```

In the page's DevTools console:

```js
window.BADAPPLE_BASE = "http://localhost:8000/shared/";
var s = document.createElement("script");
s.src = window.BADAPPLE_BASE + "badapple-anywhere.js?" + Date.now();
document.documentElement.appendChild(s);
```

Sites with a strict Content-Security-Policy will refuse injected scripts.

## Project layout

```
index.html                     gallery of all apps
apps/<slug>/index.html         one app each (generated)
shared/frames-data.js          the encoded animation (about 1 MB)
shared/badapple.js             the decode + playback engine
shared/badapple-anywhere.js    the forms API
shared/bad_apple.mp4           the audio track
tools/extract_frames.py        rebuild frames-data.js from the source video
tools/gen_apps.mjs             regenerate all app pages
tools/lint_apps.mjs            validate every app page
```

## Regenerate and validate

```bash
node tools/gen_apps.mjs      # rewrite all apps/<slug>/index.html
node tools/lint_apps.mjs     # check every app wires up the engine correctly
```

Rebuild the animation data from the source video (needs the OpenCV venv):

```bash
badapple-terminal/.venv/Scripts/python tools/extract_frames.py
```

## Notes

The frames are extracted with OpenCV, packed to 1-bit 120x90, XOR-delta + gzip
+ base64, and decoded in the browser with `DecompressionStream`. Bad Apple!! is
by Alstroemeria Records (a Touhou arrange). This is a fan and technical homage.
