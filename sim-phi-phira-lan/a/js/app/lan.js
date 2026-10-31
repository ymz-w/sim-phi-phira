/* global APP */
/*
 * LAN-only connection layer.
 * The A-end (Android tablet, file://) cannot reach the internet: every Phira
 * request must go through the Windows companion server first.
 */
(function () {
  'use strict';

  var util = APP.util;
  var connected = false;
  var connecting = false;
  var detailMode = false;

  function el(id) { return document.getElementById(id); }

  function show(node, visible) {
    if (!node) return;
    node.classList.toggle('hidden', !visible);
  }

  function setStatus(text, kind) {
    var node = el('lan-status');
    if (!node) return;
    node.textContent = text || '';
    node.className = 'lan-status' + (kind ? ' ' + kind : '');
  }

  function showGate() {
    detailMode = false;
    show(el('lan-gate'), true);
    show(el('phira-browse'), false);
    show(el('phira-detail'), false);
    var dis = el('lan-disconnect');
    if (dis) dis.classList.add('hidden');
    var ep = el('lan-endpoint');
    if (ep) ep.classList.add('hidden');
  }

  function hideGate() {
    show(el('lan-gate'), false);
    show(el('phira-browse'), true);
    var dis = el('lan-disconnect');
    if (dis) dis.classList.remove('hidden');
    var ep = el('lan-endpoint');
    if (ep) {
      var point = APP.phira.endpoint();
      ep.textContent = point.host + ':' + point.port;
      ep.classList.remove('hidden');
    }
  }

  function setConnected(value) {
    connected = value;
    util.setNet(value ? 'online' : 'offline', value ? '已连接' : '未连接');
  }

  function fillInputs() {
    var point = APP.phira.endpoint();
    var host = el('lan-host');
    var port = el('lan-port');
    if (host && !host.value) host.value = point.host || '';
    if (port && !port.value) port.value = point.port || APP.config.lan.defaultPort;
  }

  function connect() {
    if (connecting) return;
    var host = el('lan-host');
    var port = el('lan-port');
    connecting = true;
    var btn = el('lan-connect');
    if (btn) { btn.classList.add('disabled'); btn.textContent = '连接中…'; }
    setStatus('正在连接 B 端…', 'busy');

    APP.phira.connect(host ? host.value : '', port ? port.value : '').then(function (info) {
      connecting = false;
      if (btn) { btn.classList.remove('disabled'); btn.textContent = '连接'; }
      connected = true;
      setConnected(true);
      setStatus('连接成功：' + APP.phira.endpoint().host + ':' + APP.phira.endpoint().port, 'ok');
      hideGate();
      if (APP.phiraUI) APP.phiraUI.ensureLoaded();
    }).catch(function (err) {
      connecting = false;
      if (btn) { btn.classList.remove('disabled'); btn.textContent = '重试'; }
      connected = false;
      setConnected(false);
      setStatus(err.message || '连接失败', 'err');
      showGate();
    });
  }

  function disconnect() {
    APP.phira.disconnect();
    connected = false;
    setConnected(false);
    setStatus('已断开连接', '');
    showGate();
  }

  function init() {
    fillInputs();
    var btn = el('lan-connect');
    if (btn) btn.addEventListener('click', connect);
    var dis = el('lan-disconnect');
    if (dis) dis.addEventListener('click', disconnect);
    var host = el('lan-host');
    var port = el('lan-port');
    [host, port].forEach(function (input) {
      if (!input) return;
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); connect(); }
      });
    });

    var saved = util.storage.json('spp.endpoint', null);
    if (saved && saved.host) {
      setStatus('正在自动连接 ' + saved.host + ':' + saved.port + ' …', 'busy');
      if (host) host.value = saved.host;
      if (port) port.value = saved.port;
      connect();
    } else {
      showGate();
      setStatus('尚未连接。请先启动 B 端服务器，再填写它的局域网 IP。', '');
    }
  }

  APP.lan = {
    init: init,
    ready: function () { return connected; },
    showGate: showGate,
    hideGate: hideGate,
    setDetailMode: function (on) {
      detailMode = !!on;
      if (!connected) { showGate(); return; }
      if (detailMode) show(el('lan-gate'), false);
      else hideGate();
    },
    isDetailMode: function () { return detailMode; },
    connect: connect,
    disconnect: disconnect
  };
})();
