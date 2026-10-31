#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build tooling for sim-phi-phira.

It produces two things from the upstream sim-phi sources:

1. ``css/sim-phi.css``           -- the untouched simulator stylesheet with the
                                    remote Material Icons font stripped out
2. ``js/vendor/sim-phi.bundle.js``-- the simulator engine bundle + inlined
                                    zip worker + embedded Phira note skin +
                                    the result-screen audio fix

and finally the distributable single-file build ``dist/index.html``.

The upstream simulator core (``../sim-phi/origin``) is never modified; the
bundle we start from is the already file://-patched build that ships in
``../sim-phi/phi-h5/bundle.js``.
"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# this build lives in <workspace>/sim-phi-phira-lan/a
UPSTREAM = (ROOT.parent.parent / "sim-phi").resolve()
PHI_H5 = UPSTREAM / "phi-h5"

CSS_FILES = ["css/sim-phi.css", "css/app.css"]
JS_FILES = [
    "js/app/config.js",
    "js/app/util.js",
    "js/app/idb.js",
    "js/app/zip.js",
    "js/app/phira.js",
    "js/app/lan.js",
    "js/app/loader.js",
    "js/app/perf.js",
    "js/app/player-ui.js",
    "js/app/phira-ui.js",
    "js/app/library-ui.js",
    "js/app/app.js",
]

# Material Icons is a remote webfont; file:// cannot load it and the missing
# glyphs are exactly the "broken corner icons" bug of the old build.
def clean_css(css: str) -> str:
    css = re.sub(r"@font-face\s*\{[^}]*Material\s*Icons[^}]*\}", "", css, flags=re.I)
    css = re.sub(r"font-family\s*:\s*'Material Icons'\s*;", "", css, flags=re.I)
    css = re.sub(r"font\s*:\s*[^;]*Material\s+Icons[^;]*;", "", css, flags=re.I)
    # PUA glyphs would render as tofu boxes when the icon font is gone.
    css = re.sub(r"content\s*:\s*'\\[a-fA-F0-9]+'\s*;", 'content: "";', css)
    return css


def build_sim_css() -> str:
    css = ""
    for name in ("style0.css", "style1.css"):
        p = PHI_H5 / name
        if p.exists():
            css += p.read_text(encoding="utf-8") + "\n"
    return clean_css(css)


SKIN_JS = r"""
/* ===== Embedded Phira note skin (Phigros Origin look) ===================== */
const EMBEDDED_SKIN = __SKIN_DATA__;
(function () {
  if (!EMBEDDED_SKIN || !EMBEDDED_SKIN.files) return;

  function dataURItoArrayBuffer(dataURI) {
    const base64 = dataURI.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function loadImage(name) {
    return new Promise(function (resolve, reject) {
      const uri = EMBEDDED_SKIN.files[name];
      if (!uri) return reject(new Error('Missing skin file: ' + name));
      const img = new Image();
      img.onload = function () { createImageBitmap(img).then(resolve, reject); };
      img.onerror = reject;
      img.src = uri;
    });
  }

  async function loadAudio(name) {
    const uri = EMBEDDED_SKIN.files[name];
    if (!uri) throw new Error('Missing skin file: ' + name);
    const buf = dataURItoArrayBuffer(uri);
    let retries = 0;
    while (!(window.hook && hook.audio && hook.audio.actx) && retries < 100) {
      await new Promise(function (r) { setTimeout(r, 100); });
      retries++;
    }
    if (!hook.audio || !hook.audio.actx) throw new Error('AudioContext not available');
    return hook.audio.decode(buf);
  }

  async function applySkin() {
    if (!window.hook || !hook.noteRender) return;
    const cfg = EMBEDDED_SKIN.config || {};
    try {
      const tap = await loadImage('click.png');
      const tapHL = await loadImage('click_mh.png');
      const drag = await loadImage('drag.png');
      const dragHL = await loadImage('drag_mh.png');
      const flick = await loadImage('flick.png');
      const flickHL = await loadImage('flick_mh.png');
      const hold = await loadImage('hold.png');
      const holdHL = await loadImage('hold_mh.png');
      const hitFX = await loadImage('hit_fx.png');

      const tapScale = 1089 / tap.width;
      const dragScale = 1089 / drag.width;
      const flickScale = 1089 / flick.width;
      const holdScale = 1089 / hold.width;

      hook.noteRender.update('Tap', tap, tapScale);
      hook.noteRender.update('TapHL', tapHL, tapScale);
      hook.noteRender.update('Drag', drag, dragScale);
      hook.noteRender.update('DragHL', dragHL, dragScale);
      hook.noteRender.update('Flick', flick, flickScale);
      hook.noteRender.update('FlickHL', flickHL, flickScale);

      const holdTop = (cfg.holdAtlas || [0, 0])[0];
      const holdBottom = (cfg.holdAtlas || [0, 0])[1];
      const holdHead = await createImageBitmap(hold, 0, 0, hold.width, holdTop);
      const holdBody = await createImageBitmap(hold, 0, holdTop, hold.width, hold.height - holdTop - holdBottom);
      const holdEnd = await createImageBitmap(hold, 0, hold.height - holdBottom, hold.width, holdBottom);
      hook.noteRender.update('HoldHead', holdHead, holdScale, !!cfg.holdCompact);
      hook.noteRender.update('Hold', holdBody, holdScale, !!cfg.holdCompact);
      hook.noteRender.update('HoldEnd', holdEnd, holdScale, !!cfg.holdCompact);

      const mh = cfg.holdAtlasMH || cfg.holdAtlas || [0, 0];
      const holdHeadHL = await createImageBitmap(holdHL, 0, 0, holdHL.width, mh[0]);
      const holdBodyHL = await createImageBitmap(holdHL, 0, mh[0], holdHL.width, holdHL.height - mh[0] - mh[1]);
      const holdEndHL = await createImageBitmap(holdHL, 0, holdHL.height - mh[1], holdHL.width, mh[1]);
      hook.noteRender.update('HoldHeadHL', holdHeadHL, holdScale, !!cfg.holdCompact);
      hook.noteRender.update('HoldHL', holdBodyHL, holdScale, !!cfg.holdCompact);
      hook.noteRender.update('HoldEndHL', holdEndHL, holdScale, !!cfg.holdCompact);

      const loadSoundSafe = async function (name, key) {
        try { hook.res[key] = await loadAudio(name); }
        catch (e) { console.warn('[skin] sound skipped: ' + name, e); }
      };
      await Promise.all([
        loadSoundSafe('click.ogg', 'HitSong0'),
        loadSoundSafe('drag.ogg', 'HitSong1'),
        loadSoundSafe('flick.ogg', 'HitSong2')
      ]);

      const hitFx = cfg.hitFx || [8, 4];
      const hitFxScale = cfg.hitFxScale || 1;
      const hideParticles = !!cfg.hideParticles;
      const hitFxDuration = cfg.hitFxDuration ? 1000 * cfg.hitFxDuration : 500;
      const n = hitFxScale / (hitFX.width / hitFx[0] / 256);
      hook.noteRender.updateFX(hitFX, n, hitFX.width / hitFx[0], hitFX.height / hitFx[1], hideParticles, hitFxDuration);

      window.__phiraSkinApplied = true;
      console.log('[sim-phi-phira] Phira note skin applied');
    } catch (e) {
      console.error('[sim-phi-phira] skin failed', e);
    }
  }

  function waitForHook(cb, tries) {
    tries = tries || 0;
    if (window.hook && hook.noteRender && hook.audio && hook.audio.actx) cb();
    else if (tries < 300) setTimeout(function () { waitForHook(cb, tries + 1); }, 100);
  }
  waitForHook(applySkin);
})();
"""

FIX_JS = r"""
/* ===== Fix: electronic noise on the result screen =========================
 * The upstream build cannot download pack.json, so the engine falls back to
 * `V.noise(27.83)` (27.8 s of white noise!) for the four result-screen music
 * tracks and then loops them with `loop: true`.  We replace those buffers
 * with silence so the result screen stays quiet instead of screaming.
 * (The vendor bundle is additionally patched to never allocate the noise.)
 */
(function () {
  var KEYS = ['LevelOver0_v1', 'LevelOver1_v1', 'LevelOver2_v1', 'LevelOver3_v1'];
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (!window.hook || !hook.res || !hook.audio || !hook.audio.actx) {
      if (tries > 600) clearInterval(timer);
      return;
    }
    var ready = KEYS.every(function (k) { return hook.res[k]; });
    if (!ready) {
      if (tries > 600) clearInterval(timer);
      return;
    }
    try {
      var silent = hook.audio.mute(0.5);
      KEYS.forEach(function (k) { hook.res[k] = silent; });
      window.__resultNoiseFixed = true;
      console.log('[sim-phi-phira] result-screen noise silenced');
    } catch (e) {
      console.warn('[sim-phi-phira] result audio fix failed', e);
    }
    clearInterval(timer);
  }, 100);
})();
"""


def embed_skin() -> str:
    skin_dir = PHI_H5 / "skin"
    info = skin_dir / "info.yml"
    files = {}
    for f in sorted(skin_dir.iterdir()):
        if not f.is_file() or f.suffix.lower() == ".yml":
            continue
        mime = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav",
        }.get(f.suffix.lower(), "application/octet-stream")
        files[f.name] = "data:%s;base64,%s" % (
            mime, base64.b64encode(f.read_bytes()).decode("ascii"))
    # tiny YAML reader for the flat skin config
    config = {}
    if info.exists():
        for line in info.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if ":" not in line:
                continue
            key, val = line.split(":", 1)
            key, val = key.strip(), val.strip()
            if val.startswith("[") and val.endswith("]"):
                config[key] = [float(x) for x in val[1:-1].split(",") if x.strip()]
            elif val.lower() in ("true", "false"):
                config[key] = val.lower() == "true"
            else:
                try:
                    config[key] = float(val)
                except ValueError:
                    config[key] = val
    return {"files": files, "config": config}


def build_vendor() -> str:
    bundle = (PHI_H5 / "bundle.js").read_text(encoding="utf-8")
    # Never allocate ~20 MB of white noise just to throw it away.
    for i in range(4):
        old = "t9.LevelOver%d_v1 = V.noise(27.83)" % i
        if old in bundle:
            bundle = bundle.replace(old, "t9.LevelOver%d_v1 = V.mute(0.5)" % i)
    if "V.noise(27.83)" in bundle:
        print("WARN: unexpected noise fallback in bundle, runtime fix will handle it")
    worker = (PHI_H5 / "zip.worker-BTL4mpe_.js").read_text(encoding="utf-8")
    out = []
    out.append("/* sim-phi engine bundle -- generated, do not edit */")
    # Offline resource manifest: the upstream pack.json is gone, so answer it
    # locally before the engine boots instead of waiting for a network timeout.
    out.append(
        "window.__simPhiPackFallback = {image:{},audio:{}};\n"
        "(function(){\n"
        "  var _fetch = window.fetch;\n"
        "  window.fetch = function(url, options){\n"
        "    if (typeof url === 'string' && url.indexOf('pack.json') !== -1) {\n"
        "      return Promise.resolve(new Response(JSON.stringify(window.__simPhiPackFallback), "
        "{status:200, headers:{'Content-Type':'application/json'}}));\n"
        "    }\n"
        "    return _fetch.apply(this, arguments);\n"
        "  };\n"
        "})();"
    )
    out.append("window.ZIP_WORKER_CODE = " + json.dumps(worker) + ";")
    out.append(bundle)
    out.append(SKIN_JS.replace("__SKIN_DATA__", json.dumps(embed_skin(), ensure_ascii=False)))
    out.append(FIX_JS)
    return "\n".join(out)


def inline_html() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    js_bodies = {}

    def css_sub(m):
        path = ROOT / m.group(1)
        return "<style>\n" + path.read_text(encoding="utf-8") + "\n</style>"

    def js_sub(m):
        rel = m.group(1)
        path = ROOT / rel
        body = path.read_text(encoding="utf-8")
        if "</script" in body.lower():
            raise SystemExit("refusing to inline %s: contains </script>" % rel)
        return "<script>\n" + body + "\n</script>"

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)"\s*/?>', css_sub, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js_sub, html)
    return html


def main():
    print("== sim-phi-phira build ==")
    css_dir = ROOT / "css"
    vendor_dir = ROOT / "js" / "vendor"
    dist_dir = ROOT / "dist"
    for d in (css_dir, vendor_dir, dist_dir):
        d.mkdir(parents=True, exist_ok=True)

    print("- simulator stylesheet")
    (css_dir / "sim-phi.css").write_text(build_sim_css(), encoding="utf-8")

    print("- engine bundle (worker + skin + audio fix)")
    (vendor_dir / "sim-phi.bundle.js").write_text(build_vendor(), encoding="utf-8")

    print("- single-file build")
    html = inline_html()
    out = dist_dir / "index.html"
    out.write_text(html, encoding="utf-8")
    print("   %s  (%.2f MB)" % (out, out.stat().st_size / 1024 / 1024))


if __name__ == "__main__":
    main()
