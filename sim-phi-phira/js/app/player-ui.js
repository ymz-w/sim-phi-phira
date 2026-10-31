/* global APP, hook */
(function () {
  'use strict';

  var util = APP.util;
  var coverUrl = null;
  var current = null;
  var isLoaded = false;

  function el(id) { return document.getElementById(id); }

  function revoke() {
    if (coverUrl) {
      try { URL.revokeObjectURL(coverUrl); } catch (e) { /* ignore */ }
      coverUrl = null;
    }
  }

  function setCover(rec) {
    var img = el('track-cover-img');
    var holder = el('track-cover');
    if (!img || !holder) return;
    revoke();

    var src = rec && rec.cover ? rec.cover : null;
    if (!src && rec && rec.files && rec.imageFile) {
      var f = rec.files.filter(function (x) { return x.name === rec.imageFile; })[0];
      if (f && f.data) {
        try {
          coverUrl = URL.createObjectURL(new Blob([f.data]));
          src = coverUrl;
        } catch (e) { src = null; }
      }
    }
    if (src) {
      img.src = src;
      img.hidden = false;
      var empty = holder.querySelector('.cover-empty');
      if (empty) empty.style.display = 'none';
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      var ph = holder.querySelector('.cover-empty');
      if (ph) ph.style.display = '';
    }
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value === null || value === undefined || value === '' ? '—' : value;
  }

  function sourceLabel(rec) {
    if (!rec) return '—';
    if (rec.source === 'phira') return 'Phira #' + rec.phiraId;
    return '本地导入';
  }

  function setTrack(rec, opts) {
    opts = opts || {};
    current = rec;
    isLoaded = !!opts.loaded;
    lastPlaying = null;
    if (!rec) {
      setText('stage-title', '未载入曲谱');
      setText('stage-sub', '从 Phira 曲库下载，或载入本地曲谱后开始游玩');
      setText('track-name', '未载入曲谱');
      setText('track-artist', '—');
      setText('track-charter', '—');
      setText('track-level', '—');
      setText('track-source', '—');
      var chip = el('stage-level');
      if (chip) chip.hidden = true;
      setCover(null);
      var hint = el('mask-hint');
      if (hint) hint.textContent = '下载或载入一首曲谱，然后点击「播放」';
      return;
    }

    var name = rec.name || (rec.info && rec.info.name) || '未命名曲谱';
    var artist = rec.composer || '—';
    var charter = rec.charter || '—';
    var level = rec.level || '—';

    setText('stage-title', name);
    setText('stage-sub', opts.loaded ? '已载入模拟器，点击播放开始' : '上次使用的曲谱，请从「我的曲库」重新载入');
    setText('track-name', name);
    setText('track-artist', artist);
    setText('track-charter', charter);
    setText('track-level', level);
    setText('track-source', sourceLabel(rec));

    var chip = el('stage-level');
    if (chip) {
      chip.textContent = level;
      chip.hidden = level === '—';
      chip.classList.toggle('ranked', !!rec.ranked);
    }
    var hint = el('mask-hint');
    if (hint) {
      hint.textContent = opts.loaded
        ? '已就绪 · 点击「播放」开始游玩'
        : '点击「我的曲库」中的「载入」开始游玩';
    }
    setCover(rec);
  }

  var lastPlaying = null;

  function syncStatus() {
    if (!window.hook || !current || !isLoaded) return;
    var playing = !!hook.playing;
    var pauseBtn = el('btn-pause');
    var paused = !playing && pauseBtn && pauseBtn.value === '继续';
    if (playing === lastPlaying && !paused) return;
    lastPlaying = playing;
    var sub = el('stage-sub');
    if (!sub) return;
    if (playing) sub.textContent = '正在播放 · 双击左上角暂停';
    else if (paused) sub.textContent = '已暂停 · 点击「继续」或双击左上角';
    else sub.textContent = '已载入模拟器，点击播放开始';
  }

  function trackFromInputs() {
    var rec = {
      id: 'manual:' + (el('input-name') ? el('input-name').value : ''),
      source: 'local',
      name: el('input-name') ? el('input-name').value : '',
      composer: el('input-artist') ? el('input-artist').value : '',
      charter: el('input-charter') ? el('input-charter').value : '',
      illustrator: el('input-illustrator') ? el('input-illustrator').value : '',
      level: '',
      files: []
    };
    var levelSelect = el('select-level');
    var diff = el('select-difficulty');
    if (levelSelect && diff) {
      rec.level = (diff.value || '') + ' Lv.' + (levelSelect.value || '');
    }
    return rec;
  }

  function init() {
    (function waitHook() {
      if (!window.hook || !hook.selectchart) { setTimeout(waitHook, 150); return; }
      hook.selectchart.addEventListener('change', function () {
        if (!APP.state || !APP.state.suppressAutoTrack) {
          // a chart was selected by the built-in uploader / our loader
          if (!APP.state.currentRecord) setTrack(trackFromInputs(), { loaded: true });
          var btn = el('btn-play');
          if (btn) btn.classList.remove('disabled');
        }
      });
      setInterval(syncStatus, 500);
    })();

    (function waitUploader() {
      if (window.hook && hook.uploader && hook.selectchart) {
        var up = el('uploader');
        if (up) up.classList.remove('disabled');
        return;
      }
      setTimeout(waitUploader, 200);
    })();

    // restore the last used chart metadata (display only, never auto-load)
    var lastId = util.storage.get('spp.lastRecord', '');
    if (lastId) {
      APP.idb.get(lastId).then(function (rec) {
        if (rec && !APP.state.currentRecord) setTrack(rec, { loaded: false });
      }).catch(function () { /* ignore */ });
    }
  }

  APP.playerUI = {
    init: init,
    setTrack: setTrack,
    clear: function () { setTrack(null); },
    current: function () { return current; }
  };
})();
