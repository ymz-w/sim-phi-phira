/* global APP, hook */
/*
 * Runtime performance tuning for the simulator.
 *
 * Nothing here changes gameplay rules: we only
 *   1. cap the render frame rate (120 Hz tablets otherwise render 120 fps),
 *   2. cap the render resolution (the canvas otherwise runs at devicePixelRatio),
 *   3. avoid a forced layout (getBoundingClientRect) on every single frame.
 *
 * All three are pure wrappers around the objects the engine already exposes
 * (hook.app / hook.frameAnimater), so the upstream core stays untouched.
 */
(function () {
  'use strict';

  var PERF_KEY = 'spp.perf';
  var FPS_KEY = 'spp.perfFps';
  var FPS_CHOICES = [0, 30, 45, 60];

  var enabled = false;
  var fps = 60;

  function el(id) { return document.getElementById(id); }

  function readPrefs() {
    var saved = null;
    try { saved = localStorage.getItem(PERF_KEY); } catch (e) { saved = null; }
    var coarse = false;
    try { coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch (e) { coarse = false; }
    enabled = saved === null ? !!coarse : saved === '1';

    var savedFps = null;
    try { savedFps = localStorage.getItem(FPS_KEY); } catch (e) { savedFps = null; }
    fps = savedFps === null ? 60 : Number(savedFps);
    if (FPS_CHOICES.indexOf(fps) < 0) fps = 60;
  }

  function apply() {
    if (!window.hook || !hook.app || !hook.frameAnimater) return false;
    var dpr = window.devicePixelRatio || 1;

    // effective device-pixels per CSS pixel
    var factor = 1;
    if (enabled) {
      var target = 1.25; // ~720p-ish on a 854px-wide stage, still crisp
      factor = Math.min(1, target / dpr);
    }

    try { hook.app.setLowResFactor(factor); } catch (e) { console.warn('[perf] lowres', e); }
    try { hook.frameAnimater.setFrameRate(fps); } catch (e) { console.warn('[perf] fps', e); }
    return true;
  }

  // The engine calls resizeCanvas() every frame, and that calls
  // getBoundingClientRect() - a forced layout on every tick. Replace it with
  // a ResizeObserver-driven version that only re-syncs when the stage really
  // changed size.
  function patchResizeCanvas() {
    var app = hook.app;
    var stage = document.getElementById('stage');
    if (!app || !stage || !window.ResizeObserver || app.__sppResizePatched) return;
    app.__sppResizePatched = true;

    var dirty = true;
    var observer = new ResizeObserver(function () { dirty = true; });
    observer.observe(stage);

    var original = app.resizeCanvas.bind(app);
    app.resizeCanvas = function () {
      if (!dirty) return;
      dirty = false;
      return original();
    };
  }

  function init() {
    readPrefs();

    var checkbox = el('perf-mode');
    if (checkbox) {
      checkbox.checked = enabled;
      checkbox.addEventListener('change', function () {
        enabled = checkbox.checked;
        try { localStorage.setItem(PERF_KEY, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
        apply();
      });
    }

    var select = el('perf-fps');
    if (select) {
      select.value = String(fps);
      select.addEventListener('change', function () {
        fps = Number(select.value);
        if (FPS_CHOICES.indexOf(fps) < 0) fps = 0;
        try { localStorage.setItem(FPS_KEY, String(fps)); } catch (e) { /* ignore */ }
        apply();
      });
    }

    var tries = 0;
    (function waitHook() {
      if (window.hook && hook.app && hook.frameAnimater) {
        patchResizeCanvas();
        apply();
        return;
      }
      if (tries++ < 300) setTimeout(waitHook, 120);
    })();

    var resizeTimer = null;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(apply, 400);
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  APP.perf = {
    init: init,
    apply: apply,
    isEnabled: function () { return enabled; },
    setEnabled: function (value) {
      enabled = !!value;
      var checkbox = el('perf-mode');
      if (checkbox) checkbox.checked = enabled;
      try { localStorage.setItem(PERF_KEY, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
      apply();
    }
  };
})();
