/* global APP */
(function () {
  'use strict';

  var DB_NAME = 'sim-phi-phira';
  var DB_VERSION = 1;
  var STORE = 'charts';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('当前浏览器不支持 IndexedDB'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('source', 'source');
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); };
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
      req.onblocked = function () { reject(new Error('IndexedDB 被其它页面占用，请关闭其它标签页后重试')); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = function () { resolve(result && result.__value !== undefined ? result.__value : result); };
        t.onerror = function () { reject(t.error || new Error('IndexedDB 事务失败')); };
        t.onabort = function () { reject(t.error || new Error('IndexedDB 事务被中止')); };
      });
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  var idb = {
    open: open,

    put: function (record) {
      return tx('readwrite', function (store) {
        var r = store.put(record);
        return wrap(r);
      }).catch(function (e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
          throw new Error('本地存储空间不足，请删除一些曲谱后重试');
        }
        throw e;
      });
    },

    get: function (id) {
      return tx('readonly', function (store) {
        return wrap(store.get(id));
      });
    },

    has: function (id) {
      return tx('readonly', function (store) {
        return wrap(store.count(id)).then(function (n) { return n > 0; });
      });
    },

    list: function () {
      return tx('readonly', function (store) {
        return wrap(store.getAll());
      }).then(function (items) {
        items = items || [];
        return items.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      });
    },

    keys: function () {
      return tx('readonly', function (store) {
        return wrap(store.getAllKeys());
      }).then(function (keys) { return keys || []; });
    },

    del: function (id) {
      return tx('readwrite', function (store) {
        return wrap(store.delete(id));
      });
    },

    clear: function () {
      return tx('readwrite', function (store) {
        return wrap(store.clear());
      });
    },

    count: function () {
      return tx('readonly', function (store) {
        return wrap(store.count());
      });
    },

    estimate: function () {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().catch(function () { return null; });
      }
      return Promise.resolve(null);
    }
  };

  APP.idb = idb;
})();
