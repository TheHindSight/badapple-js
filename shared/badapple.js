/*
 * BadApple shared engine (v2).
 *
 * Decodes the real Bad Apple!! frames (extracted by tools/extract_frames.py,
 * embedded in frames-data.js) and gives every themed app one tiny API:
 *
 *   await BadApple.load()                     -> resolves with meta once decoded
 *   BadApple.cols / rows / fps / frameCount / duration
 *   BadApple.getBit(frame, x, y)              -> 1 = bright source pixel, 0 = dark
 *   BadApple.frameIndexAt(t, loop=true)       -> integer frame index for time t (s)
 *   BadApple.sampleCoverage(cols, rows, f,out)-> Float32Array, fraction of DARK (ink)
 *   BadApple.sample(cols, rows, f, opts)      -> Uint8Array 0/1 (1 = ink/silhouette)
 *   BadApple.createPlayer({ onFrame, ... })   -> playback clock (music drives it)
 *   BadApple.makeAudio()                      -> the singleton <audio> (real song)
 *   BadApple.enableSound()                    -> arm first-gesture autostart
 *   BadApple.fx                               -> toast/flash/shake/confetti/dvd/...
 *   BadApple.createEggMenu({eggs:[...]})      -> easter-egg menu + Konami code
 *
 * Audio: the song is a SINGLETON shared by every player/control, its URL derived
 * from this script's own location (works from any folder). The player makes the
 * SONG the master clock whenever it is playing, so the video locks exactly to the
 * music; browsers block autoplay, so the first click/key anywhere starts it.
 */
(function (global) {
  "use strict";

  var DATA = global.BADAPPLE_DATA;
  if (!DATA) {
    console.error("BADAPPLE_DATA missing — load frames-data.js before badapple.js");
  }
  var meta = DATA ? DATA.meta : { cols: 120, rows: 90, fps: 30, frameCount: 0, bytesPerFrame: 0, duration: 0 };

  var COLS = meta.cols, ROWS = meta.rows, BPF = meta.bytesPerFrame, COUNT = meta.frameCount;
  var frames = null;          // Uint8Array, absolute packed frames (after un-delta)
  var loadPromise = null;

  // Derive sibling asset URLs from this engine script's own <script src>.
  var ENGINE_SRC = (document.currentScript && document.currentScript.src) || "";
  var SHARED_DIR = ENGINE_SRC ? ENGINE_SRC.replace(/badapple\.js(\?.*)?$/i, "") : "";
  var AUDIO_URL = SHARED_DIR ? SHARED_DIR + "bad_apple.mp4" : "";

  var sharedAudio = null;     // singleton <audio> (the real song)
  var soundArmed = false;     // first-gesture autostart installed?
  var gestureHandler = null;
  var hintEl = null;
  var lastPlayer = null;      // most recent player (target for sound-arm)

  // ----- decode --------------------------------------------------------------
  function b64ToU8(b64) {
    var bin = atob(b64), n = bin.length, u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  async function gunzip(u8) {
    if (typeof DecompressionStream !== "undefined") {
      var ds = new DecompressionStream("gzip");
      var stream = new Blob([u8]).stream().pipeThrough(ds);
      var buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    }
    throw new Error("DecompressionStream unavailable — please use a modern browser.");
  }
  function undelta(flat) {
    for (var f = 1; f < COUNT; f++) {
      var base = f * BPF, prev = base - BPF;
      for (var b = 0; b < BPF; b++) flat[base + b] ^= flat[prev + b];
    }
    return flat;
  }
  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async function () {
      var raw = await gunzip(b64ToU8(DATA.b64));
      frames = undelta(raw);
      return meta;
    })();
    return loadPromise;
  }

  // ----- sampling ------------------------------------------------------------
  function getBit(f, x, y) {
    if (f < 0) f = 0; else if (f >= COUNT) f = COUNT - 1;
    var idx = y * COLS + x;
    return (frames[f * BPF + (idx >> 3)] >> (7 - (idx & 7))) & 1;   // 1 = bright
  }
  function frameIndexAt(t, loop) {
    var f = Math.floor(t * meta.fps);
    if (loop === false) { if (f < 0) f = 0; else if (f >= COUNT) f = COUNT - 1; }
    else f = ((f % COUNT) + COUNT) % COUNT;
    return f;
  }
  function sampleCoverage(tc, tr, f, out) {
    out = out || new Float32Array(tc * tr);
    for (var ty = 0; ty < tr; ty++) {
      var sy0 = (ty * ROWS / tr) | 0, sy1 = ((ty + 1) * ROWS / tr) | 0;
      if (sy1 <= sy0) sy1 = sy0 + 1; if (sy1 > ROWS) sy1 = ROWS;
      for (var tx = 0; tx < tc; tx++) {
        var sx0 = (tx * COLS / tc) | 0, sx1 = ((tx + 1) * COLS / tc) | 0;
        if (sx1 <= sx0) sx1 = sx0 + 1; if (sx1 > COLS) sx1 = COLS;
        var dark = 0, tot = 0;
        for (var y = sy0; y < sy1; y++) for (var x = sx0; x < sx1; x++) { if (getBit(f, x, y) === 0) dark++; tot++; }
        out[ty * tc + tx] = tot ? dark / tot : 0;
      }
    }
    return out;
  }
  function sample(tc, tr, f, opts) {
    opts = opts || {};
    var thr = opts.threshold == null ? 0.5 : opts.threshold, inv = !!opts.invert;
    var cov = sampleCoverage(tc, tr, f), out = new Uint8Array(tc * tr);
    for (var i = 0; i < out.length; i++) { var on = cov[i] >= thr; out[i] = (inv ? !on : on) ? 1 : 0; }
    return out;
  }

  // ----- audio (singleton + first-gesture autostart) -------------------------
  function makeAudio(relPath) {
    if (!sharedAudio) {
      sharedAudio = document.createElement("audio");
      sharedAudio.src = relPath || AUDIO_URL || "../../shared/bad_apple.mp4";
      sharedAudio.preload = "auto";
      sharedAudio.loop = true;                 // music loops with the looping video
      sharedAudio.setAttribute("playsinline", "");
    }
    return sharedAudio;
  }
  function ensureHint() {
    if (global.BADAPPLE_NO_HINT) return;
    if (hintEl || !document.body) return;
    hintEl = document.createElement("div");
    hintEl.textContent = "🔊 click anywhere for sound";
    hintEl.setAttribute("style",
      "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;" +
      "pointer-events:none;font:600 12px/1.4 system-ui,'Segoe UI',Arial,sans-serif;color:#fff;" +
      "background:rgba(0,0,0,.62);border:1px solid rgba(255,255,255,.28);padding:7px 14px;" +
      "border-radius:999px;letter-spacing:.2px;box-shadow:0 6px 24px rgba(0,0,0,.45);transition:opacity .45s;");
    document.body.appendChild(hintEl);
  }
  function hideHint() {
    if (!hintEl) return;
    var h = hintEl; hintEl = null; h.style.opacity = "0";
    setTimeout(function () { if (h && h.parentNode) h.parentNode.removeChild(h); }, 500);
  }
  function cleanupArm() {
    if (!gestureHandler) return;
    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) { document.removeEventListener(ev, gestureHandler); });
    gestureHandler = null;
  }
  function armSound() {
    var a = makeAudio();
    if (soundArmed) return a;
    soundArmed = true;
    a.addEventListener("playing", function () { cleanupArm(); hideHint(); });
    gestureHandler = function () {
      a.muted = false;
      try { if (lastPlayer) a.currentTime = lastPlayer.time() % (a.duration || meta.duration); } catch (e) {}
      var p = a.play(); if (p && p.catch) p.catch(function () {});
    };
    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, gestureHandler, { passive: true });
    });
    ensureHint();
    return a;
  }

  // ----- playback clock (song = master when playing) -------------------------
  function createPlayer(opts) {
    opts = opts || {};
    var fps = opts.fps || meta.fps;
    var count = COUNT, duration = count / fps;
    var loop = opts.loop !== false;
    var onFrame = opts.onFrame || function () {};
    var onTick = opts.onTick || null;
    var wantSound = opts.sound !== false;
    var audio = opts.audio || (wantSound ? makeAudio() : null);

    var playing = false, t = 0, speed = 1, lastTs = null, rafId = null, lastFrame = -1;

    function frameAt(time) {
      var f = Math.floor(time * fps);
      if (loop) f = ((f % count) + count) % count; else f = Math.max(0, Math.min(count - 1, f));
      return f;
    }
    function audioIsMaster() {
      return wantSound && audio && !audio.paused && audio.readyState >= 2 && isFinite(audio.duration) && audio.duration > 0;
    }
    function syncAudio() {
      if (!audio) return;
      try {
        audio.playbackRate = speed;
        var ad = audio.duration;
        if (ad && isFinite(ad)) { var want = t % ad; if (Math.abs(audio.currentTime - want) > 0.25) audio.currentTime = want; }
      } catch (e) {}
    }
    function emit(force) {
      var f = frameAt(t);
      if (force || f !== lastFrame) { lastFrame = f; onFrame(f, t); }
      if (onTick) onTick(t, f, playing);
    }
    function tick(ts) {
      if (!playing) return;
      if (lastTs == null) lastTs = ts;
      var dt = (ts - lastTs) / 1000; lastTs = ts;
      if (audioIsMaster()) {
        t = audio.currentTime;                  // video locks exactly to the song
        if (loop) t = ((t % duration) + duration) % duration;
      } else {
        t += dt * speed;
        if (loop) t = ((t % duration) + duration) % duration;
        else if (t >= duration) { t = duration; playing = false; }
      }
      emit(false);
      if (playing) rafId = requestAnimationFrame(tick);
    }

    var api = {
      play: function () {
        if (playing) return;
        playing = true; lastTs = null;
        if (audio) { syncAudio(); var p = audio.play(); if (p && p.catch) p.catch(function () {}); }
        rafId = requestAnimationFrame(tick);
      },
      pause: function () {
        playing = false;
        if (rafId) cancelAnimationFrame(rafId);
        if (audio) try { audio.pause(); } catch (e) {}
      },
      toggle: function () { playing ? api.pause() : api.play(); },
      seek: function (time) {
        t = loop ? ((time % duration) + duration) % duration : Math.max(0, Math.min(duration, time));
        if (audio) { try { audio.currentTime = t % (audio.duration || duration); } catch (e) {} }
        syncAudio(); emit(true);
      },
      seekFrame: function (f) { api.seek(f / fps); },
      step: function (d) { api.pause(); api.seek(t + (d || 1) / fps); },
      setSpeed: function (s) { speed = s; syncAudio(); },
      setAudio: function (el) { audio = el; wantSound = true; },
      isPlaying: function () { return playing; },
      time: function () { return t; },
      frame: function () { return frameAt(t); },
      duration: duration, frameCount: count, fps: fps
    };

    lastPlayer = api;
    if (wantSound) armSound();
    // Render the first frame AFTER the caller's synchronous code finishes, so an
    // onFrame referencing the player const being assigned can't hit the TDZ.
    if (typeof queueMicrotask === "function") queueMicrotask(function () { emit(true); });
    else Promise.resolve().then(function () { emit(true); });
    return api;
  }

  // ----- easter-egg menu + FX toolkit ----------------------------------------
  var fxCss = false;
  function injectFxCss() {
    if (fxCss || !document.head) return; fxCss = true;
    var s = document.createElement("style");
    s.textContent = [
      ".ba-egg-trigger{position:fixed;left:14px;bottom:14px;z-index:2147483640;width:40px;height:40px;border-radius:50%;",
      "border:1px solid rgba(255,255,255,.32);background:rgba(20,20,26,.74);color:#fff;font-size:18px;cursor:pointer;",
      "-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);box-shadow:0 4px 18px rgba(0,0,0,.45);transition:transform .15s,box-shadow .15s;}",
      ".ba-egg-trigger:hover{transform:scale(1.09) rotate(8deg);box-shadow:0 0 0 2px var(--ba-egg-accent,#8ab4f8),0 6px 22px rgba(0,0,0,.5);}",
      ".ba-egg-panel{position:fixed;left:14px;bottom:64px;z-index:2147483641;width:272px;max-height:64vh;overflow:auto;",
      "background:rgba(15,16,22,.95);color:#eee;border:1px solid rgba(255,255,255,.16);border-radius:12px;",
      "box-shadow:0 14px 50px rgba(0,0,0,.6);font:13px/1.4 system-ui,'Segoe UI',Arial,sans-serif;",
      "opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;transition:.16s;}",
      ".ba-egg-panel.open{opacity:1;transform:none;pointer-events:auto;}",
      ".ba-egg-head{display:flex;justify-content:space-between;align-items:center;padding:11px 13px;font-weight:700;",
      "border-bottom:1px solid rgba(255,255,255,.1);color:var(--ba-egg-accent,#8ab4f8);letter-spacing:.3px;}",
      ".ba-egg-x{cursor:pointer;opacity:.7;font-size:17px;line-height:1;}.ba-egg-x:hover{opacity:1;}",
      ".ba-egg-list{display:flex;flex-direction:column;padding:6px;}",
      ".ba-egg-item{display:block;text-align:left;background:none;border:0;border-radius:8px;color:#eee;padding:8px 10px;cursor:pointer;font:inherit;width:100%;}",
      ".ba-egg-item:hover{background:rgba(255,255,255,.09);}",
      ".ba-egg-item b{font-weight:600;display:block;}",
      ".ba-egg-item small{font-size:11px;opacity:.58;}",
      ".ba-egg-foot{padding:8px 13px;font-size:11px;opacity:.5;border-top:1px solid rgba(255,255,255,.1);}",
      ".ba-toast{position:fixed;left:50%;top:17%;transform:translateX(-50%);z-index:2147483645;background:rgba(0,0,0,.84);",
      "color:#fff;padding:10px 18px;border-radius:10px;font:600 14px system-ui,sans-serif;border:1px solid rgba(255,255,255,.2);",
      "box-shadow:0 8px 30px rgba(0,0,0,.5);transition:opacity .4s,transform .4s;pointer-events:none;}",
      ".ba-bigtext{position:fixed;inset:0;z-index:2147483644;display:flex;align-items:center;justify-content:center;",
      "font:800 min(15vw,160px)/1 system-ui,sans-serif;color:#fff;pointer-events:none;mix-blend-mode:difference;text-align:center;}",
      ".ba-flash{position:fixed;inset:0;z-index:2147483643;pointer-events:none;opacity:.85;transition:opacity .5s;}",
      ".ba-confetti{position:fixed;top:-44px;z-index:2147483642;pointer-events:none;will-change:transform;}",
      "@keyframes ba-fall{to{transform:translateY(112vh) rotate(420deg);}}",
      ".ba-shake{animation:ba-shake .5s;}@keyframes ba-shake{10%,90%{transform:translate(-2px,0)}30%,70%{transform:translate(6px,0)}50%{transform:translate(-9px,0)}}",
      ".ba-rainbow{animation:ba-hue 4s linear infinite;}@keyframes ba-hue{to{filter:hue-rotate(360deg)}}",
      ".ba-invert{filter:invert(1) hue-rotate(180deg)!important;}",
      ".ba-glitch{animation:ba-glitch .22s steps(2) infinite;}@keyframes ba-glitch{0%{transform:translate(0)}25%{transform:translate(-3px,1px)}50%{transform:translate(3px,-2px)}75%{transform:translate(-2px,2px)}}",
      ".ba-dvd{position:fixed;z-index:2147483642;font:800 22px system-ui,sans-serif;color:#fff;pointer-events:none;will-change:left,top;white-space:nowrap;}"
    ].join("");
    document.head.appendChild(s);
  }

  var fx = {
    toast: function (msg, ms) {
      injectFxCss(); var d = document.createElement("div"); d.className = "ba-toast"; d.textContent = msg;
      document.body.appendChild(d);
      setTimeout(function () { d.style.opacity = "0"; d.style.transform = "translateX(-50%) translateY(-8px)"; }, ms || 1500);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, (ms || 1500) + 450);
      return d;
    },
    bigText: function (msg, ms) {
      injectFxCss(); var d = document.createElement("div"); d.className = "ba-bigtext"; d.textContent = msg;
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 1200); return d;
    },
    flash: function (color, ms) {
      injectFxCss(); var d = document.createElement("div"); d.className = "ba-flash"; d.style.background = color || "#fff";
      document.body.appendChild(d); requestAnimationFrame(function () { d.style.opacity = "0"; });
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 520);
    },
    shake: function (el) { el = el || document.body; injectFxCss(); el.classList.remove("ba-shake"); void el.offsetWidth; el.classList.add("ba-shake"); setTimeout(function () { el.classList.remove("ba-shake"); }, 600); },
    invert: function (el) { (el || document.documentElement).classList.toggle("ba-invert"); injectFxCss(); },
    rainbow: function (el) { (el || document.documentElement).classList.toggle("ba-rainbow"); injectFxCss(); },
    glitch: function (el, ms) { el = el || document.body; injectFxCss(); el.classList.add("ba-glitch"); setTimeout(function () { el.classList.remove("ba-glitch"); }, ms || 900); },
    confetti: function (emoji, count) {
      injectFxCss(); emoji = emoji || "🍎"; count = count || 26;
      for (var i = 0; i < count; i++) {
        var d = document.createElement("div"); d.className = "ba-confetti"; d.textContent = emoji;
        var dur = 2.2 + (i % 7) * 0.35, delay = (i % 11) * 0.11;
        d.style.left = (3 + (i * 97) % 92) + "vw";
        d.style.fontSize = (16 + (i % 5) * 8) + "px";
        d.style.animation = "ba-fall " + dur + "s linear " + delay + "s forwards";
        document.body.appendChild(d);
        (function (node, tot) { setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, tot); })(d, (dur + delay) * 1000 + 250);
      }
    },
    appleRain: function (n) { fx.confetti("🍎", n || 30); },
    dvd: function (text, ms) {
      injectFxCss(); var d = document.createElement("div"); d.className = "ba-dvd"; d.textContent = text || "BAD APPLE";
      document.body.appendChild(d);
      var x = 40, y = 40, vx = 2.3, vy = 1.9, hue = 0, stop = false;
      function step() {
        if (stop) return;
        var maxX = innerWidth - d.offsetWidth, maxY = innerHeight - d.offsetHeight;
        x += vx; y += vy;
        if (x <= 0 || x >= maxX) { vx = -vx; hue = (hue + 53) % 360; d.style.color = "hsl(" + hue + ",90%,62%)"; }
        if (y <= 0 || y >= maxY) { vy = -vy; hue = (hue + 53) % 360; d.style.color = "hsl(" + hue + ",90%,62%)"; }
        d.style.left = x + "px"; d.style.top = y + "px"; requestAnimationFrame(step);
      }
      step();
      setTimeout(function () { stop = true; if (d.parentNode) d.parentNode.removeChild(d); }, ms || 9000);
    }
  };

  var KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
  function installKonami(cb) {
    var pos = 0;
    document.addEventListener("keydown", function (e) {
      var k = e.key.toLowerCase();
      if (k === KONAMI[pos]) { pos++; if (pos === KONAMI.length) { pos = 0; try { cb(); } catch (err) {} } }
      else { pos = (k === KONAMI[0]) ? 1 : 0; }
    });
  }

  function createEggMenu(opts) {
    opts = opts || {};
    var eggs = opts.eggs || [];
    injectFxCss();
    var trigger = null;
    if (opts.trigger !== false) {
      trigger = document.createElement("button");
      trigger.className = "ba-egg-trigger";
      trigger.title = opts.title || "Secrets / easter eggs";
      trigger.textContent = opts.triggerLabel || "✨";
      if (document.body) document.body.appendChild(trigger);
    }
    var panel = document.createElement("div");
    panel.className = "ba-egg-panel";
    panel.innerHTML = '<div class="ba-egg-head"><span>' + (opts.title || "✨ Secrets") +
      '</span><span class="ba-egg-x" role="button" aria-label="close">×</span></div><div class="ba-egg-list"></div>' +
      (opts.footer ? '<div class="ba-egg-foot">' + opts.footer + "</div>" : "");
    if (document.body) document.body.appendChild(panel);
    var listEl = panel.querySelector(".ba-egg-list");
    eggs.forEach(function (egg, i) {
      var item = document.createElement("button");
      item.className = "ba-egg-item";
      item.innerHTML = "<b>" + (egg.label || ("Egg " + (i + 1))) + (egg.key ? " <small>[" + egg.key + "]</small>" : "") +
        "</b>" + (egg.desc ? "<small>" + egg.desc + "</small>" : "");
      item.addEventListener("click", function (e) { e.stopPropagation(); try { egg.run && egg.run(); } catch (err) { console.error(err); } });
      listEl.appendChild(item);
    });
    function open() { panel.classList.add("open"); }
    function close() { panel.classList.remove("open"); }
    function toggle() { panel.classList.toggle("open"); }
    if (trigger) trigger.addEventListener("click", function (e) { e.stopPropagation(); toggle(); });
    panel.querySelector(".ba-egg-x").addEventListener("click", close);
    document.addEventListener("click", function (e) {
      if (panel.classList.contains("open") && !panel.contains(e.target) && e.target !== trigger) close();
    });
    if (opts.shortcuts !== false) {
      document.addEventListener("keydown", function (e) {
        if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        eggs.forEach(function (egg) {
          if (egg.key && egg.key.length === 1 && e.key.toLowerCase() === egg.key.toLowerCase()) {
            try { egg.run && egg.run(); } catch (err) {}
          }
        });
      });
    }
    installKonami(opts.konami || function () {
      fx.toast("✨ Konami code!");
      var last = eggs[eggs.length - 1]; if (last && last.run) try { last.run(); } catch (e) {}
    });
    var accent = (opts.theme && opts.theme.accent) || opts.accent;
    if (accent) { panel.style.setProperty("--ba-egg-accent", accent); if (trigger) trigger.style.setProperty("--ba-egg-accent", accent); }
    return { open: open, close: close, toggle: toggle, panel: panel, trigger: trigger,
      openFrom: function (el) { if (el) el.addEventListener("click", function (e) { e.stopPropagation(); toggle(); }); return this; } };
  }

  global.BadApple = {
    load: load,
    get ready() { return load(); },
    cols: COLS, rows: ROWS, fps: meta.fps, frameCount: COUNT, duration: meta.duration, meta: meta,
    getBit: getBit, frameIndexAt: frameIndexAt, sampleCoverage: sampleCoverage, sample: sample,
    createPlayer: createPlayer,
    makeAudio: makeAudio,
    audioElement: function () { return sharedAudio || makeAudio(); },
    enableSound: function () { return armSound(); },
    fx: fx,
    createEggMenu: createEggMenu,
    installKonami: installKonami,
    version: 2
  };
})(typeof window !== "undefined" ? window : this);
