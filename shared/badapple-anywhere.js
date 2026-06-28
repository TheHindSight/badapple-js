/*
 * Bad Apple ANYWHERE — render the real Bad Apple!! in many "forms", on any page
 * or inside your own elements, with synced sound. Built on the shared engine
 * (frames-data.js + badapple.js).
 *
 * ---------------------------------------------------------------------------
 * QUICK START
 *   <script src="shared/badapple-anywhere.js"></script>
 * Auto-loads the engine from its own folder (or window.BADAPPLE_BASE) and runs.
 *
 * CHOOSE A FORM (the "kind" of Bad Apple):
 *   window.BADAPPLE_OPTS = { form:"elements", black:"#chrome-logo", cols:64 };
 * ...before the <script>, or at runtime:
 *   BadAppleAnywhere.start({ form:"elements", black:"#chrome-logo", cols:64 });
 *
 * BUILT-IN FORMS:
 *   "video"    real video, drawn into a floating box or your `target` element
 *   "full"     fullscreen click-through pixel overlay
 *   "ascii"    monospace ASCII-shadow
 *   "elements" tile YOUR OWN elements as the pixels (see `black`/`white` below)
 *   "infect"   the page's own text lights up to form the silhouette
 *   "chrome"   animate the favicon + tab title only
 *
 * OPTIONS (all optional):
 *   form    : form name (default "video")
 *   target  : element or id (or "#id") to render INTO (video/ascii/elements).
 *             Omitted -> a floating, draggable box.
 *   black   : what to show where the figure (ink) is — for the "elements" form.
 *   white   : what to show where the background is — for the "elements" form.
 *             black/white accept: an element, an id / "#id" string (the element
 *             is cloned), an HTML string ("<img src=...>"), a plain string/emoji
 *             ("🍎"), or a function returning a fresh node.
 *   cols,rows : grid/sample resolution (elements & ascii).
 *   sound   : true (default) — synced audio; first click/key starts it.
 *   opacity : 0..1 initial opacity.
 *   hud     : false to hide the control bar.
 *
 * CUSTOM FORMS — register your own renderer:
 *   BadAppleAnywhere.register("rings", function (env) {
 *     // env: { BA, opts(), paintVideo(f), sample(c,r,f), sampleCoverage(c,r,f),
 *     //        getBit(f,x,y), el(), drag(), resolveNode(), mount([w,h]), Z }
 *     return {
 *       start()      { ... build your DOM ... },
 *       stop()       { ... tear it down ... },
 *       render(f)    { ... draw frame f ... },   // f = integer frame index
 *       host()       { return <element to apply opacity to> }  // optional
 *     };
 *   });
 *   BadAppleAnywhere.start({ form:"rings" });
 *
 * API: BadAppleAnywhere.{ start(opts), mode(name), register(name,fn), forms(),
 *                         play(), pause(), toggle(), stop(), player, __live }
 */
(function (global) {
  "use strict";

  // Re-running while live = toggle off (handy for bookmarklets/consoles).
  if (global.BadAppleAnywhere && global.BadAppleAnywhere.__live) {
    try { global.BadAppleAnywhere.stop(); } catch (e) {}
    return;
  }

  // No UI at all: suppress the engine's "click for sound" hint. Audio still
  // unlocks silently on the first user gesture (browser autoplay policy).
  global.BADAPPLE_NO_HINT = true;

  // ---- locate the shared engine ---------------------------------------------
  var SELF = (document.currentScript && document.currentScript.src) || "";
  var DIR = global.BADAPPLE_BASE ||
            (SELF ? SELF.replace(/badapple-anywhere\.js(\?.*)?$/i, "") : "");

  function inject(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error("could not load " + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  async function ensureEngine() {
    if (global.BadApple) return;
    if (!global.BADAPPLE_DATA) {
      if (!DIR) throw new Error("Set window.BADAPPLE_BASE to the folder with frames-data.js + badapple.js");
      await inject(DIR + "frames-data.js");
    }
    if (!global.BadApple) await inject(DIR + "badapple.js");
    if (!global.BadApple) throw new Error("Bad Apple engine missing after load");
  }

  // ---- frame buffer (native-resolution video) -------------------------------
  var BA = null, off, offCtx, vimg;
  function paintVideo(f) {                 // real video: white bg, black figure
    if (!off) {
      off = document.createElement("canvas");
      off.width = BA.cols; off.height = BA.rows;
      offCtx = off.getContext("2d");
      vimg = offCtx.createImageData(BA.cols, BA.rows);
    }
    var d = vimg.data, cols = BA.cols, rows = BA.rows, n = cols * rows;
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var v = BA.getBit(f, i % cols, (i / cols) | 0) ? 255 : 0;
      d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
    }
    offCtx.putImageData(vimg, 0, 0);
    return off;
  }

  // ---- DOM helpers -----------------------------------------------------------
  var Z = 2147483600;
  function el(tag, css, parent) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    (parent || document.body).appendChild(e);
    return e;
  }
  function drag(handle, target) {
    var sx, sy, ox, oy, on = false;
    handle.style.cursor = "move";
    handle.addEventListener("pointerdown", function (e) {
      on = true; sx = e.clientX; sy = e.clientY;
      var r = target.getBoundingClientRect(); ox = r.left; oy = r.top;
      target.style.right = "auto"; target.style.bottom = "auto";
      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", function (e) {
      if (!on) return;
      target.style.left = Math.max(0, ox + e.clientX - sx) + "px";
      target.style.top  = Math.max(0, oy + e.clientY - sy) + "px";
    });
    handle.addEventListener("pointerup", function () { on = false; });
  }
  function resolveTarget(spec) {
    if (!spec) return null;
    if (spec.nodeType) return spec;
    var s = String(spec);
    return document.getElementById(s[0] === "#" ? s.slice(1) : s);
  }
  // Turn a user spec into a FRESH node (clone). Used for black/white pixels.
  function resolveNode(spec) {
    if (spec == null) return null;
    if (typeof spec === "function") { try { return spec(); } catch (e) { return null; } }
    if (spec.nodeType) return stripId(spec.cloneNode(true));
    var s = String(spec);
    var ref = document.getElementById(s[0] === "#" ? s.slice(1) : s);
    if (ref) return stripId(ref.cloneNode(true));
    if (/<[a-z][\s\S]*>/i.test(s)) { var t = document.createElement("div"); t.innerHTML = s; return t.firstElementChild || t; }
    var sp = document.createElement("span"); sp.textContent = s; return sp;
  }
  function stripId(node) {
    if (node && node.removeAttribute) node.removeAttribute("id");
    if (node && node.querySelectorAll) node.querySelectorAll("[id]").forEach(function (n) { n.removeAttribute("id"); });
    return node;
  }

  // A host for a form: either the user's `target` element, or a floating box.
  function mount(prefSize) {
    var t = resolveTarget(options.target);
    if (t) {
      var savedHTML = t.innerHTML, savedPos = getComputedStyle(t).position;
      t.innerHTML = "";
      if (savedPos === "static") t.style.position = "relative";
      var inner = el("div", "position:absolute;inset:0;overflow:hidden;", t);
      return { root: inner, host: t, cleanup: function () { t.innerHTML = savedHTML; if (savedPos === "static") t.style.position = ""; } };
    }
    var w = (prefSize && prefSize[0]) || 360, h = (prefSize && prefSize[1]) || 270;
    var box = el("div",
      "position:fixed;right:18px;bottom:18px;z-index:" + (Z + 5) + ";width:" + w + "px;height:" + h + "px;" +
      "background:#000;overflow:hidden;");
    return { root: box, host: box, cleanup: function () { box.remove(); } };
  }

  // ---------------------------------------------------------------------------
  //  Form registry
  // ---------------------------------------------------------------------------
  var registry = {};
  var BUILTIN_ORDER = ["video", "full", "elements", "ascii", "infect", "chrome"];
  function register(name, factory) { registry[name] = factory; return api; }

  var ENV = {
    get BA() { return BA; },
    opts: function () { return options; },
    paintVideo: paintVideo,
    sample: function (c, r, f, o) { return BA.sample(c, r, f, o); },
    sampleCoverage: function (c, r, f, out) { return BA.sampleCoverage(c, r, f, out); },
    getBit: function (f, x, y) { return BA.getBit(f, x, y); },
    el: el, drag: drag, resolveNode: resolveNode, resolveTarget: resolveTarget, mount: mount, Z: Z
  };

  // video: real video into a floating box or a target element
  register("video", function (env) {
    var m, cv, ctx;
    return {
      start: function () {
        m = env.mount([360, 270]);
        cv = env.el("canvas", "display:block;width:100%;height:100%;background:#fff;image-rendering:pixelated;", m.root);
        cv.width = BA.cols; cv.height = BA.rows;
        ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
      },
      stop: function () { m && m.cleanup(); },
      render: function (f) { ctx.drawImage(env.paintVideo(f), 0, 0, BA.cols, BA.rows); },
      host: function () { return m && m.host; }
    };
  });

  // full: fullscreen click-through pixel overlay
  register("full", function (env) {
    var cv, ctx;
    return {
      start: function () {
        cv = env.el("canvas",
          "position:fixed;inset:0;z-index:" + (env.Z + 2) + ";width:100vw;height:100vh;" +
          "pointer-events:none;background:#fff;image-rendering:pixelated;");
        cv.width = BA.cols; cv.height = BA.rows;
        ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
      },
      stop: function () { if (cv) cv.remove(); cv = null; },
      render: function (f) { ctx.drawImage(env.paintVideo(f), 0, 0, BA.cols, BA.rows); },
      host: function () { return cv; }
    };
  });

  // ascii: monospace ASCII-shadow
  register("ascii", function (env) {
    var m, pre, CHARS = " .:-=+*#%@";
    return {
      start: function () {
        m = env.mount([520, 300]);
        pre = env.el("div",
          "width:100%;height:100%;margin:0;background:#000;color:#0f0;overflow:hidden;" +
          "font:7px/7px ui-monospace,Consolas,monospace;white-space:pre;", m.root);
      },
      stop: function () { m && m.cleanup(); },
      render: function (f) {
        var o = env.opts(), TC = o.cols || 100, TR = o.rows || 50;
        var cov = env.sampleCoverage(TC, TR, f), s = "", n = CHARS.length - 1;
        for (var y = 0; y < TR; y++) {
          for (var x = 0; x < TC; x++) s += CHARS[Math.round(cov[y * TC + x] * n)];
          s += "\n";
        }
        pre.textContent = s;
      },
      host: function () { return m && m.host; }
    };
  });

  // elements: tile YOUR OWN elements as the black/white pixels
  register("elements", function (env) {
    var m, cells = [], last = null, GC, GR;
    return {
      start: function () {
        var o = env.opts();
        GC = o.cols || 48;
        GR = o.rows || Math.max(1, Math.round(GC * BA.rows / BA.cols));
        var blackTpl = env.resolveNode(o.black != null ? o.black : "⬛");
        var whiteTpl = o.white != null ? env.resolveNode(o.white) : null;
        m = env.mount([Math.min(GC * 12, 600), Math.min(GR * 12, 600)]);
        var grid = env.el("div",
          "width:100%;height:100%;display:grid;line-height:0;" +
          "grid-template-columns:repeat(" + GC + ",1fr);grid-template-rows:repeat(" + GR + ",1fr);", m.root);
        cells = []; last = null;
        var frag = document.createDocumentFragment();
        for (var i = 0; i < GC * GR; i++) {
          var cell = document.createElement("div");
          cell.style.cssText = "position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;";
          var b = blackTpl.cloneNode(true); fit(b); cell.appendChild(b);
          var w = whiteTpl ? whiteTpl.cloneNode(true) : null; if (w) { fit(w); cell.appendChild(w); }
          cells.push({ b: b, w: w });
          frag.appendChild(cell);
        }
        grid.appendChild(frag);
        var rect = grid.getBoundingClientRect();          // scale glyphs to cells
        if (rect.height) grid.style.fontSize = Math.max(6, Math.floor(rect.height / GR * 0.85)) + "px";
        grid.style.lineHeight = "1";
      },
      stop: function () { m && m.cleanup(); cells = []; },
      render: function (f) {
        var ink = env.sample(GC, GR, f);             // Uint8: 1 = figure/ink
        if (!last) { last = new Uint8Array(ink.length); last.fill(2); }
        for (var i = 0; i < ink.length; i++) {
          if (ink[i] === last[i]) continue;
          last[i] = ink[i];
          var c = cells[i], on = ink[i] === 1;
          c.b.style.display = on ? "" : "none";
          if (c.w) c.w.style.display = on ? "none" : "";
        }
      },
      host: function () { return m && m.host; }
    };
    function fit(node) { if (node && node.style) { node.style.maxWidth = "100%"; node.style.maxHeight = "100%"; } }
  });

  // infect: the page's own text forms the silhouette
  register("infect", function (env) {
    var nodes = [], saved = [];
    return {
      start: function () {
        nodes = []; saved = [];
        var skip = /^(script|style|noscript|title|svg|canvas)$/i;
        var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: function (n) {
            if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            var p = n.parentElement;
            if (!p || skip.test(p.tagName)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        var n;
        while ((n = walk.nextNode())) {
          var p = n.parentElement;
          if (nodes.indexOf(p) >= 0) continue;
          nodes.push(p);
          saved.push({ el: p, color: p.style.color, op: p.style.opacity, tr: p.style.transition });
          p.style.transition = "opacity .12s linear, color .12s linear";
        }
      },
      stop: function () {
        saved.forEach(function (s) { s.el.style.color = s.color; s.el.style.opacity = s.op; s.el.style.transition = s.tr; });
        nodes = []; saved = [];
      },
      render: function (f) {
        for (var i = 0; i < nodes.length; i++) {
          var p = nodes[i], r = p.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight || !r.width) { p.style.opacity = "0.05"; continue; }
          var sx = Math.min(BA.cols - 1, Math.max(0, ((r.left + r.width / 2) / innerWidth * BA.cols) | 0));
          var sy = Math.min(BA.rows - 1, Math.max(0, ((r.top + r.height / 2) / innerHeight * BA.rows) | 0));
          var ink = env.getBit(f, sx, sy) === 0;
          p.style.opacity = ink ? "1" : "0.05";
          if (ink) p.style.color = "#fff";
        }
      },
      host: function () { return null; }
    };
  });

  // chrome: favicon + tab title only
  register("chrome", function (env) {
    var fcv, fctx, link, savedHref, savedTitle, lastF = -1;
    return {
      start: function () {
        fcv = document.createElement("canvas"); fcv.width = fcv.height = 32;
        fctx = fcv.getContext("2d"); fctx.imageSmoothingEnabled = false;
        link = document.querySelector("link[rel~='icon']");
        if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
        savedHref = link.getAttribute("href"); savedTitle = document.title;
      },
      stop: function () {
        if (link) { if (savedHref == null) link.remove(); else link.setAttribute("href", savedHref); }
        if (savedTitle != null) document.title = savedTitle;
      },
      render: function (f) {
        if (f === lastF) return; lastF = f;
        fctx.fillStyle = "#fff"; fctx.fillRect(0, 0, 32, 32);
        fctx.drawImage(env.paintVideo(f), 0, 0, 32, 32);
        try { link.setAttribute("href", fcv.toDataURL("image/png")); } catch (e) {}
        document.title = "🍎 " + (f % 2 ? "Bad Apple" : "bad apple") + " ♪";
      },
      host: function () { return null; }
    };
  });

  // ---------------------------------------------------------------------------
  //  Controller (no UI — just renders + plays)
  // ---------------------------------------------------------------------------
  var options = { form: "video", sound: true, opacity: 1, loop: true };
  if (global.BADAPPLE_OPTS) for (var k in global.BADAPPLE_OPTS) options[k] = global.BADAPPLE_OPTS[k];

  var player = null, current = null, currentName = null;

  function applyOpacity() {
    var h = current && current.host && current.host();
    if (h && h.style) h.style.opacity = options.opacity;
  }
  function setForm(name) {
    if (!registry[name]) { console.warn("[Bad Apple] no form '" + name + "'"); return; }
    if (current) try { current.stop(); } catch (e) {}
    currentName = name; options.form = name;
    current = registry[name](ENV);
    current.start();
    if (player) current.render(player.frame());
    applyOpacity();
  }

  // ---------------------------------------------------------------------------
  var api = {
    __live: true,
    player: null,
    register: register,
    forms: function () { return Object.keys(registry); },
    mode: function (name) { if (player) setForm(name); else options.form = name; return api; },
    start: function (opts) {
      if (opts) for (var key in opts) options[key] = opts[key];
      if (!BA) return api;             // not loaded yet; options stored for boot
      if (!player) boot(); else setForm(options.form);
      return api;
    },
    play: function () { player && player.play(); return api; },
    pause: function () { player && player.pause(); return api; },
    toggle: function () { player && player.toggle(); return api; },
    stop: function () {
      api.__live = false;
      try { player && player.pause(); } catch (e) {}
      try { current && current.stop(); } catch (e) {}
      var a = BA && BA.audioElement && BA.audioElement(); if (a) try { a.pause(); } catch (e) {}
      global.BadAppleAnywhere = { __live: false, register: register };
    }
  };
  global.BadAppleAnywhere = api;

  function boot() {
    player = BA.createPlayer({
      loop: options.loop !== false,
      sound: options.sound !== false,
      onFrame: function (f) { if (current) current.render(f); }
    });
    api.player = player;
    setForm(options.form);
    player.play();
  }

  ensureEngine()
    .then(function () { BA = global.BadApple; return BA.load(); })
    .then(function () { boot(); })
    .catch(function (err) {
      console.error("[Bad Apple anywhere]", err);
      global.BadAppleAnywhere = { __live: false, register: register };
    });

})(typeof window !== "undefined" ? window : this);
