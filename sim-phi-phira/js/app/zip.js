/* global APP, hook */
(function () {
  'use strict';

  var AUDIO_RE = /\.(mp3|ogg|wav|m4a|aac|flac)$/i;
  var IMAGE_RE = /\.(png|jpg|jpeg|webp|bmp)$/i;

  function baseName(path) {
    var s = String(path || '');
    var i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function extName(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function imageMime(name) {
    var e = extName(name);
    return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : e === 'bmp' ? 'image/bmp' : 'image/jpeg';
  }

  function decodeText(bytes) {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
    catch (e) { return ''; }
  }

  function parseScalar(raw) {
    var v = String(raw === undefined || raw === null ? '' : raw).trim();
    if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
        (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) {
      return v.slice(1, -1);
    }
    if (v === 'null' || v === '~' || v === '') return null;
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v.charAt(0) === '[' && v.charAt(v.length - 1) === ']') {
      return v.slice(1, -1).split(',').map(function (x) { return parseScalar(x); }).filter(function (x) { return x !== null; });
    }
    return v;
  }

  // Phira's info.yml is a flat mapping; this tiny parser is enough for it.
  function parseYaml(text) {
    var out = {};
    var listKey = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim() || /^\s*#/.test(line)) return;
      var m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
      if (m) {
        var key = m[1], value = m[2];
        if (value.trim() === '') {
          out[key] = [];
          listKey = key;
        } else {
          out[key] = parseScalar(value);
          listKey = null;
        }
        return;
      }
      var lm = /^\s*-\s+(.*)$/.exec(line);
      if (lm && listKey) out[listKey].push(parseScalar(lm[1]));
    });
    return out;
  }

  // classic Phigros / RPE "info.txt"
  function parseInfoTxt(text) {
    var blocks = [];
    var cur = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (/^\s*#/.test(line)) {
        if (cur && Object.keys(cur).length) blocks.push(cur);
        cur = {};
        return;
      }
      if (!cur) cur = {};
      var idx = line.indexOf(':');
      if (idx < 0) return;
      var k = line.slice(0, idx).trim(), v = line.slice(idx + 1).trim();
      if (k) cur[k] = v;
    });
    if (cur && Object.keys(cur).length) blocks.push(cur);
    return blocks[0] || {};
  }

  function extract(buffer, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!window.hook || !hook.ZipReader) {
        reject(new Error('模拟器尚未初始化完成，无法解压'));
        return;
      }
      var entries = [];
      var expected = 0;
      var done = false;
      var idleTimer = null;
      var hardTimer = null;

      var zr = new hook.ZipReader({ handler: function (entry) { return Promise.resolve(entry); } });

      function cleanup() {
        clearTimeout(hardTimer);
        clearTimeout(idleTimer);
        try { zr.terminate(); } catch (e) { /* ignore */ }
      }

      function finish() {
        if (done) return;
        done = true;
        cleanup();
        if (!entries.length) {
          reject(new Error('压缩包为空或无法解析'));
          return;
        }
        if (expected && entries.length < expected) {
          console.warn('[zip] idle finish: ' + entries.length + '/' + expected + ' entries');
        }
        resolve(entries);
      }

      hardTimer = setTimeout(function () {
        if (entries.length) { finish(); return; }
        done = true;
        cleanup();
        reject(new Error('解压超时，请检查文件是否完整'));
      }, 180000);

      zr.addEventListener('read', function (ev) {
        var entry = ev.detail || {};
        expected = zr.total || expected;
        var raw = String(entry.pathname || 'file');
        // the worker prefixes every entry with the virtual zip name
        raw = raw.replace(/^[^/]*\.zip\//i, '');
        var name = baseName(raw);
        if (!name) return;
        entries.push({ path: raw, name: name, data: entry.buffer });
        if (opts.onProgress) opts.onProgress(entries.length, expected || entries.length);
        clearTimeout(idleTimer);
        if (expected && entries.length >= expected) {
          finish();
        } else {
          idleTimer = setTimeout(finish, 8000);
        }
      });

      zr.addEventListener('error', function (ev) {
        if (done) return;
        done = true;
        cleanup();
        reject((ev && ev.detail) || new Error('解压失败'));
      });

      try {
        zr.read({ pathname: 'chart.zip', buffer: buffer });
      } catch (e) {
        done = true;
        cleanup();
        reject(e);
      }
    });
  }

  function classify(entries) {
    var out = {
      chart: null, chartJson: null, audio: null, image: null,
      infoYml: null, infoTxt: null, files: entries
    };

    entries.forEach(function (f) {
      var lower = f.name.toLowerCase();
      if (lower === 'info.yml' || lower === 'info.yaml') out.infoYml = f;
      else if (lower === 'info.txt' || lower === 'settings.txt') out.infoTxt = f;
    });

    // chart candidate: prefer JSON that looks like a chart
    var jsonCandidates = entries.filter(function (f) { return /\.json$/i.test(f.name); });
    for (var i = 0; i < jsonCandidates.length; i++) {
      var f = jsonCandidates[i];
      try {
        var obj = JSON.parse(decodeText(f.data));
        if (obj && (obj.judgeLineList || (obj.META && obj.META.RPEVersion))) {
          out.chart = f;
          out.chartJson = obj;
          break;
        }
      } catch (e) { /* not this one */ }
    }
    if (!out.chart) {
      var pec = entries.filter(function (x) { return /\.pec$/i.test(x.name); })[0];
      if (pec) out.chart = pec;
    }

    // hint names from metadata files
    var yml = {};
    if (out.infoYml) {
      try { yml = parseYaml(decodeText(out.infoYml.data)); } catch (e) { yml = {}; }
    }
    var meta = (out.chartJson && out.chartJson.META) || {};
    var txt = out.infoTxt ? parseInfoTxt(decodeText(out.infoTxt.data)) : {};

    var audioName = yml.music || meta.song || txt.Music || txt.Song || null;
    var imageName = yml.illustration || meta.background || txt.Picture || txt.Image || null;

    entries.forEach(function (f) {
      if (!out.audio && AUDIO_RE.test(f.name)) {
        if (!audioName || baseName(audioName).toLowerCase() === f.name.toLowerCase()) out.audio = f;
      }
      if (!out.image && IMAGE_RE.test(f.name)) {
        if (!imageName || baseName(imageName).toLowerCase() === f.name.toLowerCase()) out.image = f;
      }
    });
    if (!out.audio) out.audio = entries.filter(function (f) { return AUDIO_RE.test(f.name); })[0] || null;
    if (!out.image) out.image = entries.filter(function (f) { return IMAGE_RE.test(f.name); })[0] || null;

    return out;
  }

  function parseMeta(entries) {
    var c = classify(entries);
    var yml = {};
    if (c.infoYml) {
      try { yml = parseYaml(decodeText(c.infoYml.data)); } catch (e) { yml = {}; }
    }
    var meta = (c.chartJson && c.chartJson.META) || {};
    var txt = c.infoTxt ? parseInfoTxt(decodeText(c.infoTxt.data)) : {};

    var pick = function () {
      for (var i = 0; i < arguments.length; i++) {
        var v = arguments[i];
        if (v !== null && v !== undefined && String(v).trim() !== '') return v;
      }
      return '';
    };

    return {
      name: pick(yml.name, meta.name, txt.Name),
      level: pick(yml.level, meta.level, txt.Level),
      charter: pick(yml.charter, meta.charter, txt.Charter, txt.Designer),
      composer: pick(yml.composer, meta.composer, txt.Composer, txt.Musician, txt.Artist),
      illustrator: pick(yml.illustrator, meta.illustration, txt.Illustrator),
      description: pick(yml.intro, yml.description, txt.Description),
      tags: Array.isArray(yml.tags) ? yml.tags.filter(function (t) { return typeof t === 'string'; }) : [],
      chartFile: c.chart ? c.chart.name : null,
      audioFile: c.audio ? c.audio.name : null,
      imageFile: c.image ? c.image.name : null,
      aspectRatio: typeof yml.aspectRatio === 'number' ? yml.aspectRatio : null,
      backgroundDim: typeof yml.backgroundDim === 'number' ? yml.backgroundDim : null,
      offset: typeof meta.offset === 'number' ? meta.offset : (typeof yml.offset === 'number' ? yml.offset : null),
      infoYml: yml
    };
  }

  function makeCover(imageEntry, maxSize) {
    if (!imageEntry) return Promise.resolve(null);
    maxSize = maxSize || 400;
    return new Promise(function (resolve) {
      var blob;
      try { blob = new Blob([imageEntry.data], { type: imageMime(imageEntry.name) }); }
      catch (e) { resolve(null); return; }
      createImageBitmap(blob).then(function (bmp) {
        try {
          var scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
          var w = Math.max(1, Math.round(bmp.width * scale));
          var h = Math.max(1, Math.round(bmp.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(bmp, 0, 0, w, h);
          bmp.close && bmp.close();
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (e) { resolve(null); }
      }).catch(function () { resolve(null); });
    });
  }

  APP.zip = {
    extract: extract,
    classify: classify,
    parseMeta: parseMeta,
    makeCover: makeCover,
    parseYaml: parseYaml,
    parseInfoTxt: parseInfoTxt,
    decodeText: decodeText,
    baseName: baseName,
    isAudio: function (name) { return AUDIO_RE.test(name); },
    isImage: function (name) { return IMAGE_RE.test(name); }
  };
})();
