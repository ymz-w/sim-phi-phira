/* global APP */
(function () {
  'use strict';

  var util = APP.util;
  var ENDPOINT_KEY = 'spp.endpoint';
  var PROXY_KEY = 'spp.proxy';
  var API_TIMEOUT = 40000;

  var state = {
    connected: false,
    host: '',
    port: 0,
    info: null
  };

  function isLan() { return APP.config.mode === 'lan'; }

  function trimBase(s) {
    return String(s || '').trim().replace(/\/+$/, '');
  }

  function proxyBase() {
    var p = trimBase(util.storage.get(PROXY_KEY, ''));
    if (!p) return '';
    if (!/^https?:\/\//i.test(p)) p = 'http://' + p;
    return p.replace(/\/+$/, '');
  }

  function lanBase() {
    return 'http://' + state.host + ':' + state.port;
  }

  function buildQuery(params) {
    if (!params) return '';
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === null || v === undefined || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function timeoutSignal(ms) {
    if (window.AbortController) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, ms);
      return { signal: ctrl.signal, done: function () { clearTimeout(timer); } };
    }
    return { signal: undefined, done: function () {} };
  }

  function requestJson(url, timeout) {
    var t = timeoutSignal(timeout || API_TIMEOUT);
    return fetch(url, { signal: t.signal, credentials: 'omit' }).then(function (res) {
      t.done();
      if (!res.ok) {
        var err = new Error('接口返回 HTTP ' + res.status);
        err.code = 'http';
        err.status = res.status;
        throw err;
      }
      return res.json().catch(function () {
        var err = new Error('接口返回了无法解析的数据');
        err.code = 'parse';
        throw err;
      });
    }, function (e) {
      t.done();
      var err = new Error(e && e.name === 'AbortError' ? '请求超时' : '网络请求失败（可能是跨域或离线）');
      err.code = navigator.onLine === false ? 'offline' : 'network';
      throw err;
    });
  }

  // 列表 / 详情优先走 phira.5wyxi.com（与 phira.moe 前端一致，实测比
  // api.phira.cn 快很多），失败时自动切换到备用域名。LAN 模式只请求 B 端，
  // 由 B 端负责上游的故障转移。
  function apiUrls(path, query) {
    var urls = [];
    if (isLan()) {
      urls.push(lanBase() + '/api' + path + query);
      return urls;
    }
    urls.push(trimBase(APP.config.apiBase) + path + query);
    var fallback = trimBase(APP.config.apiFallback || '');
    if (fallback && fallback !== trimBase(APP.config.apiBase)) {
      urls.push(fallback + path + query);
    }
    return urls;
  }

  function requestApi(path, query, timeout) {
    var urls = apiUrls(path, query);
    var index = 0;

    function next(lastError) {
      if (index >= urls.length) {
        throw lastError || new Error('接口请求失败');
      }
      var url = urls[index++];
      return requestJson(url, timeout).catch(function (err) {
        // 4xx 是业务错误，不值得换域名重试
        if (err.code === 'http' && err.status < 500 && err.status !== 429) throw err;
        return next(err);
      });
    }

    return Promise.resolve().then(function () { return next(null); });
  }

  var api = {
    isLan: isLan,
    state: state,
    proxyBase: proxyBase,

    init: function () {
      var saved = util.storage.json(ENDPOINT_KEY, null);
      if (saved && saved.host) {
        state.host = saved.host;
        state.port = Number(saved.port) || APP.config.lan.defaultPort;
      }
    },

    isConnected: function () { return !isLan() || state.connected; },

    endpoint: function () { return { host: state.host, port: state.port }; },

    /**
     * Connect to the Windows companion server (LAN fork only).
     * Accepts "192.168.1.7", "192.168.1.7:8765", "http://192.168.1.7" ...
     */
    connect: function (hostInput, portInput) {
      var host = String(hostInput || '').trim();
      var port = Number(portInput) || 0;
      host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      var m = /^([^:]+):(\d+)$/.exec(host);
      if (m) { host = m[1]; port = Number(m[2]); }
      if (!host) return Promise.reject(new Error('请输入 B 端的 IP 地址或主机名'));
      if (!port) port = APP.config.lan.defaultPort;

      var probe = 'http://' + host + ':' + port + '/api/health';
      var t = timeoutSignal(7000);
      return fetch(probe, { signal: t.signal, credentials: 'omit' }).then(function (res) {
        t.done();
        if (!res.ok) throw new Error('B 端返回 HTTP ' + res.status + '，请确认服务已启动');
        return res.json();
      }).then(function (json) {
        if (!json || json.ok !== true) throw new Error('B 端响应异常');
        state.host = host;
        state.port = port;
        state.connected = true;
        state.info = json;
        util.storage.set(ENDPOINT_KEY, JSON.stringify({ host: host, port: port }));
        util.setNet('online', '已连接 ' + host + ':' + port);
        return json;
      }, function (e) {
        t.done();
        state.connected = false;
        var msg;
        if (e && e.name === 'AbortError') {
          msg = '连接超时：请检查 B 端是否启动、IP 是否正确、防火墙端口是否放行';
        } else if (e && /Failed to fetch|NetworkError|Load failed|Network request failed/i.test(e.message || '')) {
          msg = '无法连接 B 端：请确认服务已启动、地址与端口正确、防火墙已放行该端口';
        } else {
          msg = '连接失败：' + (e && e.message ? e.message : '未知错误');
        }
        throw new Error(msg);
      });
    },

    disconnect: function () {
      state.connected = false;
      state.info = null;
      util.setNet('offline', '未连接');
    },

    forget: function () {
      util.storage.remove(ENDPOINT_KEY);
      api.disconnect();
    },

    autoConnect: function () {
      if (!isLan()) return Promise.resolve(true);
      var saved = util.storage.json(ENDPOINT_KEY, null);
      if (!saved || !saved.host) return Promise.resolve(false);
      return api.connect(saved.host, saved.port).then(function () { return true; }, function () { return false; });
    },

    list: function (params) {
      var query = buildQuery({
        page: params.page || 1,
        pageNum: params.pageNum || APP.config.pageSize,
        order: params.order || '-updated',
        search: params.search || '',
        tags: params.tags || '',
        division: params.division || '',
        rating: params.rating || ''
      });
      return requestApi('/chart', query, API_TIMEOUT).then(function (json) {
        if (!json || !Array.isArray(json.results)) throw new Error('曲谱列表数据异常');
        return json;
      });
    },

    detail: function (id) {
      return requestApi('/chart/' + encodeURIComponent(id), '', API_TIMEOUT);
    },

    imageUrl: function (url, thumb) {
      if (!url) return '';
      var target = String(url);
      if (thumb && !/\.thumbnail$/.test(target)) target += '.thumbnail';
      if (isLan()) return lanBase() + '/api/img?url=' + encodeURIComponent(target);
      var proxy = proxyBase();
      if (proxy) return proxy + '/api/img?url=' + encodeURIComponent(target);
      return target;
    },

    fileUrl: function (url) {
      var target = String(url || '');
      if (isLan()) return lanBase() + '/api/file?url=' + encodeURIComponent(target);
      var proxy = proxyBase();
      if (proxy) return proxy + '/api/file?url=' + encodeURIComponent(target);
      return target;
    },

    fetchBinary: function (url, onProgress) {
      var finalUrl = api.fileUrl(url);
      var t = timeoutSignal(180000);
      var direct = !isLan() && !proxyBase();

      return fetch(finalUrl, { signal: t.signal, credentials: 'omit' }).then(function (res) {
        if (!res.ok) {
          t.done();
          var err = new Error('下载失败：HTTP ' + res.status);
          err.code = 'http';
          throw err;
        }
        var total = Number(res.headers.get('content-length')) || 0;
        if (!res.body || !res.body.getReader) {
          return res.arrayBuffer().then(function (buf) {
            t.done();
            if (onProgress) onProgress(buf.byteLength, buf.byteLength);
            return buf;
          });
        }
        var reader = res.body.getReader();
        var chunks = [];
        var loaded = 0;
        var lastTick = 0;
        return (function pump() {
          return reader.read().then(function (step) {
            if (step.done) {
              t.done();
              var out = new Uint8Array(loaded);
              var offset = 0;
              chunks.forEach(function (c) { out.set(c, offset); offset += c.byteLength; });
              if (onProgress) onProgress(loaded, total || loaded);
              return out.buffer;
            }
            chunks.push(step.value);
            loaded += step.value.byteLength;
            var now = Date.now();
            if (onProgress && (now - lastTick > 120)) {
              lastTick = now;
              onProgress(loaded, total);
            }
            return pump();
          });
        })();
      }, function (e) {
        t.done();
        var err = new Error(direct
          ? '浏览器阻止了跨域下载（phira-cdn 不允许 file:// 来源）'
          : '下载失败：' + (e && e.message ? e.message : '网络错误'));
        err.code = direct ? 'cors' : (navigator.onLine === false ? 'offline' : 'network');
        throw err;
      });
    },

    setProxy: function (value) {
      var v = trimBase(value);
      if (v) util.storage.set(PROXY_KEY, v);
      else util.storage.remove(PROXY_KEY);
    },

    getProxy: function () { return util.storage.get(PROXY_KEY, ''); }
  };

  APP.phira = api;
})();
