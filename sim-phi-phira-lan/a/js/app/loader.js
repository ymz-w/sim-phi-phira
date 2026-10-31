/* global APP, hook */
(function () {
  'use strict';

  var util = APP.util;
  var loaded = {}; // record.id -> { chartValue, audioValue, imageValue, at }

  function ready() {
    return !!(window.hook && hook.uploader && hook.selectchart && hook.app);
  }

  function waitReady(timeout) {
    timeout = timeout || 30000;
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        if (ready()) return resolve();
        if (Date.now() - start > timeout) return reject(new Error('模拟器初始化超时，请刷新页面重试'));
        setTimeout(poll, 120);
      })();
    });
  }

  function optionsSet(select) {
    var set = {};
    if (!select) return set;
    for (var i = 0; i < select.options.length; i++) set[select.options[i].value] = true;
    return set;
  }

  function findNewOption(select, before, name) {
    if (!select) return null;
    var wanted = String(name || '').toLowerCase();
    var fallback = null;
    for (var i = 0; i < select.options.length; i++) {
      var o = select.options[i];
      if (before[o.value]) continue;
      var text = String(o.textContent || '').replace(/\\/g, '/').toLowerCase();
      if (wanted && (text === wanted || text.slice(-wanted.length) === wanted)) return o;
      if (!fallback) fallback = o;
    }
    return fallback;
  }

  function waitOption(select, before, name, timeout) {
    timeout = timeout || 20000;
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        var opt = findNewOption(select, before, name);
        if (opt) return resolve(opt.value);
        if (Date.now() - start > timeout) {
          return reject(new Error('曲谱解析超时：' + (name || '未知文件')));
        }
        setTimeout(poll, 120);
      })();
    });
  }

  // Audio decoding / image decoding is asynchronous: wait until the engine has
  // registered the media of this chart before selecting it.
  function waitMedia(rec, cache, timeout) {
    var start = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        var audioSel = window.hook.selectbgm;
        var imgSel = util.$('#select-bg');
        var audioOk = !rec.audioFile || !!findNewOption(audioSel, cache.beforeAudio, rec.audioFile);
        var imageOk = !rec.imageFile || !!findNewOption(imgSel, cache.beforeImage, rec.imageFile);
        if ((audioOk && imageOk) || Date.now() - start > (timeout || 25000)) {
          return resolve({ audioOk: audioOk, imageOk: imageOk });
        }
        setTimeout(poll, 150);
      })();
    });
  }

  function applyInfo(rec) {
    var fields = {
      '#input-name': rec.name,
      '#input-artist': rec.composer,
      '#input-charter': rec.charter,
      '#input-illustrator': rec.illustrator
    };
    Object.keys(fields).forEach(function (sel) {
      var node = util.$(sel);
      if (!node) return;
      var v = fields[sel];
      if (v !== null && v !== undefined && String(v).trim() !== '') node.value = v;
    });
  }

  function selectMusic(rec, cache) {
    var audioSel = window.hook.selectbgm;
    var opt = findNewOption(audioSel, cache.beforeAudio || {}, rec.audioFile || '');
    if (opt) {
      audioSel.value = opt.value;
      cache.audioValue = opt.value;
    }
  }

  function selectImage(rec, cache) {
    var imgSel = util.$('#select-bg');
    if (!imgSel) return;
    var opt = findNewOption(imgSel, cache.beforeImage || {}, rec.imageFile || '');
    if (opt) {
      imgSel.value = opt.value;
      imgSel.dispatchEvent(new Event('change'));
      cache.imageValue = opt.value;
    }
  }

  function setPlayEnabled(enabled) {
    var btn = util.$('#btn-play');
    if (!btn) return;
    btn.classList.toggle('disabled', !enabled);
  }

  /**
   * Load a stored chart record into the simulator.
   * record: { id, name, files:[{name,data}], chartFile, audioFile, imageFile, ... }
   */
  function loadRecord(rec, opts) {
    opts = opts || {};
    if (!rec) return Promise.reject(new Error('曲谱记录为空'));
    return waitReady().then(function () {
      // already digested in this page session -> just select it again
      var cached = loaded[rec.id];
      if (cached && cached.chartValue) {
        var exists = false;
        var opts2 = window.hook.selectchart.options;
        for (var i = 0; i < opts2.length; i++) if (opts2[i].value === cached.chartValue) { exists = true; break; }
        if (exists) {
          window.hook.selectchart.value = cached.chartValue;
          window.hook.selectchart.dispatchEvent(new Event('change'));
          applyInfo(rec);
          setPlayEnabled(true);
          if (APP.playerUI) APP.playerUI.setTrack(rec, { loaded: true });
          return rec;
        }
      }

      var files = (rec.files || []).filter(function (f) { return f && f.name && f.data; });
      if (!files.length) throw new Error('曲谱文件缺失');

      // chart files must be parsed last so bgm/cover are already registered
      var chartNames = [rec.chartFile].filter(Boolean);
      var media = files.filter(function (f) { return chartNames.indexOf(f.name) < 0; });
      var charts = files.filter(function (f) { return chartNames.indexOf(f.name) >= 0; });
      if (!charts.length) charts = files.slice(-1); // fallback: last file

      var cache = {
        beforeChart: optionsSet(window.hook.selectchart),
        beforeAudio: optionsSet(window.hook.selectbgm),
        beforeImage: optionsSet(util.$('#select-bg'))
      };

      var progress = opts.onProgress || function () {};
      var total = files.length;
      var done = 0;

      function feed(list) {
        return list.reduce(function (chain, f) {
          return chain.then(function () {
            var copy;
            try { copy = f.data.slice(0); } catch (e) { copy = f.data; }
            window.hook.uploader.fireLoad({ name: f.name }, copy);
            done++;
            progress(done, total, f.name);
            return util.sleep(60);
          });
        }, Promise.resolve());
      }

      return feed(media.concat(charts))
        .then(function () {
          return waitOption(window.hook.selectchart, cache.beforeChart, rec.chartFile, 25000);
        })
        .then(function (value) {
          cache.chartValue = value;
          if (APP.state) APP.state.currentRecord = rec;
          window.hook.selectchart.value = value;
          window.hook.selectchart.dispatchEvent(new Event('change'));
          // give the engine a tick to apply metadata via its chart-change hook
          return util.sleep(200);
        })
        .then(function () {
          return waitMedia(rec, cache, 25000);
        })
        .then(function () {
          selectMusic(rec, cache);
          selectImage(rec, cache);
          applyInfo(rec);
          loaded[rec.id] = {
            chartValue: cache.chartValue,
            audioValue: cache.audioValue,
            imageValue: cache.imageValue,
            at: Date.now()
          };
          setPlayEnabled(true);
          if (APP.playerUI) APP.playerUI.setTrack(rec, { loaded: true });
          util.storage.set('spp.lastRecord', rec.id);
          return rec;
        });
    });
  }

  APP.loader = {
    waitReady: waitReady,
    loadRecord: loadRecord,
    isLoaded: function (id) { return !!loaded[id]; },
    forget: function (id) { delete loaded[id]; },
    forgetAll: function () { loaded = {}; }
  };
})();
