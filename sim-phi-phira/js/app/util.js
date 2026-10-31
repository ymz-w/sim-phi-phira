/* global APP */
(function () {
  'use strict';

  var util = {};

  util.$ = function (sel, root) { return (root || document).querySelector(sel); };
  util.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  util.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  util.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  util.fmtBytes = function (n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n >= 100 ? 0 : 1) + ' ' + u[i];
  };

  util.fmtDate = function (ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  // "2026-10-27T11:57:14.595844Z" -> "2026-10-27 19:57"
  util.fmtIso = function (value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return util.fmtDate(d.getTime());
  };

  util.debounce = function (fn, delay) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, delay);
    };
  };

  util.tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); };

  util.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  util.storage = {
    get: function (k, def) {
      try {
        var v = localStorage.getItem(k);
        return v === null ? def : v;
      } catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    },
    remove: function (k) {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    },
    json: function (k, def) {
      try {
        var v = localStorage.getItem(k);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    }
  };

  /* ------------------------------ toasts ------------------------------ */
  util.toast = function (message, kind, timeout) {
    var host = util.$('#toasts');
    if (!host) return;
    var node = util.el('div', { class: 'toast ' + (kind || '') , text: message });
    host.appendChild(node);
    var ttl = timeout || (kind === 'err' ? 6500 : 3600);
    setTimeout(function () {
      node.classList.add('leaving');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    }, ttl);
  };

  /* --------------------------- modal confirm -------------------------- */
  var modalResolve = null;

  util.modal = function (opts) {
    var root = util.$('#app-modal');
    var title = util.$('#app-modal-title');
    var body = util.$('#app-modal-body');
    var ok = util.$('#app-modal-ok');
    var cancel = util.$('#app-modal-cancel');

    title.textContent = opts.title || '提示';
    body.innerHTML = opts.body || '';
    ok.textContent = opts.okText || '确定';
    cancel.textContent = opts.cancelText || '取消';
    cancel.style.display = opts.hideCancel ? 'none' : '';
    root.hidden = false;

    return new Promise(function (resolve) {
      function done(value) {
        root.hidden = true;
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        root.removeEventListener('click', onBackdrop);
        modalResolve = null;
        if (opts.onClose) { try { opts.onClose(value); } catch (e) { /* ignore */ } }
        resolve(value);
      }
      function onOk() { done(true); }
      function onCancel() { done(false); }
      function onBackdrop(e) { if (e.target === root) done(false); }
      modalResolve = done;
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      root.addEventListener('click', onBackdrop);
      if (opts.onMount) opts.onMount(body, done);
    });
  };

  util.confirm = function (title, message, okText) {
    return util.modal({
      title: title,
      body: '<p>' + message + '</p>',
      okText: okText || '确定'
    });
  };

  /* ------------------------------ net pill ---------------------------- */
  util.setNet = function (state, text) {
    var pill = util.$('#net-pill');
    var label = util.$('#net-text');
    if (!pill) return;
    pill.classList.remove('offline', 'busy');
    if (state === 'offline') pill.classList.add('offline');
    if (state === 'busy') pill.classList.add('busy');
    if (label) label.textContent = text;
  };

  util.uid = function (prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  util.hash = function (str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  };

  util.escapeRegExp = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  APP.util = util;
})();
