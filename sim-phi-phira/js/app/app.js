/* global APP, hook */
(function () {
  'use strict';

  var util = APP.util;
  var TABS = ['player', 'phira', 'library'];
  var animatorStopped = false;

  function el(id) { return document.getElementById(id); }

  var state = {
    sessionId: '',
    currentRecord: null,
    savedIds: {},
    activeTab: 'player'
  };
  APP.state = state;

  function sessionId() {
    var id = '';
    try { id = sessionStorage.getItem('spp.session') || ''; } catch (e) { id = ''; }
    if (!id) {
      id = util.uid('s');
      try { sessionStorage.setItem('spp.session', id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  function switchTab(name, opts) {
    if (TABS.indexOf(name) < 0) name = 'player';
    opts = opts || {};

    if (state.activeTab === 'player' && name !== 'player') {
      if (window.hook && hook.playing) hook.pause().catch(function () { /* ignore */ });
      // The engine's render loop would otherwise keep drawing into a 0x0
      // canvas while the player tab is display:none.
      if (window.hook && hook.frameAnimater) {
        hook.frameAnimater.stop();
        animatorStopped = true;
      }
    }
    if (name === 'player' && animatorStopped) {
      animatorStopped = false;
      // never start the loop before a chart exists (the engine throws)
      if (window.hook && hook.app && hook.app.chart && hook.frameAnimater) hook.frameAnimater.start();
    }
    state.activeTab = name;

    TABS.forEach(function (t) {
      var page = el('page-' + t);
      if (page) page.classList.toggle('active', t === name);
      var btn = util.$('.tab[data-tab="' + t + '"]');
      if (btn) btn.classList.toggle('active', t === name);
    });

    if (!opts.silent) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
    }

    if (name === 'phira') {
      if (APP.phiraUI) APP.phiraUI.ensureLoaded();
    }
    if (name === 'library' && APP.libraryUI) {
      APP.libraryUI.refresh();
    }
  }

  /*
   * The engine's fullscreen (double tap bottom-right) only switches #stage to
   * position:fixed / inset:0 - exactly like the original. We mirror that state
   * onto <body> so the app shell (topbar, sidebar with cover preview, controls,
   * footer) gets out of the way instead of overlapping the game.
   */
  function watchFullscreen() {
    var stage = el('stage');
    if (!stage) return;

    function sync() {
      var full = stage.style.position === 'fixed' ||
        !!(document.fullscreenElement || document.webkitFullscreenElement);
      document.body.classList.toggle('stage-fullscreen', !!full);
    }

    if (window.MutationObserver) {
      new MutationObserver(sync).observe(stage, { attributes: true, attributeFilter: ['style'] });
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    window.addEventListener('resize', sync);
    sync();
  }

  function bindTabs() {
    util.$$('.tab[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });
  }

  function bindButtons() {
    var openPhira = el('btn-open-phira');
    if (openPhira) openPhira.addEventListener('click', function () { switchTab('phira'); });
    var gotoLib = el('btn-goto-library');
    if (gotoLib) gotoLib.addEventListener('click', function () { switchTab('library'); });
    var openLib = el('btn-open-library');
    if (openLib) openLib.addEventListener('click', function () { switchTab('library'); });

    var status = util.$('.statusbar');
    if (status) status.addEventListener('click', function () {
      var msg = el('msg-out');
      if (msg) msg.click();
    });
  }

  function bindNetwork() {
    function update() {
      if (APP.phira.isLan()) {
        if (APP.lan && APP.lan.ready()) {
          var ep = APP.phira.endpoint();
          util.setNet('online', '已连接 ' + ep.host + ':' + ep.port);
        } else {
          util.setNet('offline', '未连接');
        }
        return;
      }
      if (navigator.onLine === false) util.setNet('offline', '离线');
      else util.setNet('online', '在线');
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  function init() {
    state.sessionId = sessionId();

    APP.phira.init();

    bindTabs();
    watchFullscreen();
    bindButtons();
    bindNetwork();

    APP.playerUI.init();
    APP.phiraUI.init();
    APP.libraryUI.init();
    if (APP.perf && APP.perf.init) APP.perf.init();

    if (APP.lan && APP.lan.init) APP.lan.init();

    APP.idb.open().catch(function (err) {
      util.toast('IndexedDB 初始化失败：' + err.message, 'err', 9000);
    });

    APP.libraryUI.refresh();

    var hash = String(location.hash || '').replace('#', '');
    if (TABS.indexOf(hash) >= 0 && hash !== 'player') switchTab(hash, { silent: true });

    // keep the simulator's "waiting" message friendly
    var msg = el('msg-out');
    if (msg && /初始化/.test(msg.textContent || '')) {
      setTimeout(function () {
        if (/初始化/.test(msg.textContent || '')) {
          msg.textContent = '正在初始化模拟器…';
        }
      }, 1200);
    }
  }

  APP.switchTab = switchTab;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();