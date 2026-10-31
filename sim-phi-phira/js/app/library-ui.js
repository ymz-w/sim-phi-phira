/* global APP */
(function () {
  'use strict';

  var util = APP.util;

  function el(id) { return document.getElementById(id); }

  function coverOf(rec) {
    if (rec.cover) return rec.cover;
    return '';
  }

  function render(records) {
    var grid = el('library-grid');
    var empty = el('library-empty');
    if (!grid) return;
    grid.innerHTML = '';

    var count = records.length;
    var badge = el('lib-count');
    if (badge) badge.textContent = String(count);
    var total = el('library-total');
    if (total) total.textContent = count ? '共 ' + count + ' 首曲谱 · 点击「载入」即可游玩' : '曲库是空的';
    if (empty) empty.classList.toggle('hidden', count > 0);

    records.forEach(function (rec) {
      var card = util.el('div', { class: 'chart-card' });
      var thumb = util.el('div', { class: 'thumb' });
      var cover = coverOf(rec);
      if (cover) {
        thumb.appendChild(util.el('img', { src: cover, alt: '' }));
      } else {
        thumb.appendChild(util.el('div', { class: 'ph', text: 'φ' }));
      }
      if (rec.level) thumb.appendChild(util.el('span', { class: 'lvl', text: rec.level }));
      var fresh = rec.sessionId && rec.sessionId === APP.state.sessionId;
      thumb.appendChild(util.el('span', { class: 'lib-badge' + (fresh ? '' : ' old'), text: fresh ? '本次载入' : '历史' }));

      var body = util.el('div', { class: 'body' });
      body.appendChild(util.el('div', { class: 'name', text: rec.name || '未命名曲谱', title: rec.name || '' }));
      body.appendChild(util.el('div', { class: 'sub', text: (rec.source === 'phira' ? 'Phira #' + rec.phiraId : '本地导入') + ' · ' + (rec.charter || '未知谱师') }));
      var meta = util.el('div', { class: 'meta' });
      meta.appendChild(util.el('span', { class: 'lib-size', text: util.fmtBytes(rec.bytes) }));
      meta.appendChild(util.el('span', { class: 'spacer' }));
      meta.appendChild(util.el('span', { class: 'lib-size', text: util.fmtDate(rec.createdAt) }));
      body.appendChild(meta);

      var actions = util.el('div', { class: 'lib-actions' });
      var loadBtn = util.el('button', { class: 'btn small primary', text: '载入' });
      var delBtn = util.el('button', { class: 'btn ghost small', text: '删除' });
      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);

      loadBtn.addEventListener('click', function () {
        loadBtn.classList.add('disabled');
        loadBtn.textContent = '载入中';
        APP.loader.loadRecord(rec).then(function () {
          util.toast('已载入：' + rec.name, 'ok');
          APP.switchTab('player');
        }).catch(function (err) {
          util.toast('载入失败：' + (err.message || err), 'err');
        }).then(function () {
          loadBtn.classList.remove('disabled');
          loadBtn.textContent = '载入';
        });
      });

      delBtn.addEventListener('click', function () {
        util.confirm('删除曲谱', '确定删除「' + util.esc(rec.name) + '」吗？<br>文件会从 IndexedDB 中移除。', '删除').then(function (ok) {
          if (!ok) return;
          APP.idb.del(rec.id).then(function () {
            APP.loader.forget(rec.id);
            util.toast('已删除', 'ok');
            refresh();
            if (APP.phiraUI) APP.phiraUI.refreshSaved();
          }).catch(function (err) {
            util.toast('删除失败：' + (err.message || err), 'err');
          });
        });
      });

      card.appendChild(thumb);
      card.appendChild(body);
      card.appendChild(actions);
      card.addEventListener('click', function (e) {
        if (e.target === card || thumb.contains(e.target) || body.contains(e.target)) {
          loadBtn.click();
        }
      });
      grid.appendChild(card);
    });
  }

  function updateQuota() {
    APP.idb.estimate().then(function (est) {
      var node = el('library-quota');
      if (!node) return;
      if (est && est.usage !== undefined) {
        node.textContent = '已用 ' + util.fmtBytes(est.usage) + (est.quota ? ' / ' + util.fmtBytes(est.quota) : '');
      } else {
        node.textContent = '';
      }
    });
  }

  function refresh() {
    return APP.idb.list().then(function (records) {
      render(records);
      updateQuota();
      return records;
    }).catch(function (err) {
      util.toast('读取本地曲库失败：' + (err.message || err), 'err');
      return [];
    });
  }

  function init() {
    var clear = el('library-clear');
    if (clear) clear.addEventListener('click', function () {
      util.confirm('清空本地曲库', '这会删除 IndexedDB 中保存的全部曲谱，且无法恢复。确定继续吗？', '全部删除').then(function (ok) {
        if (!ok) return;
        APP.idb.clear().then(function () {
          util.toast('曲库已清空', 'ok');
          refresh();
          if (APP.phiraUI) APP.phiraUI.refreshSaved();
        });
      });
    });

    var go = el('library-open-phira');
    if (go) go.addEventListener('click', function () { APP.switchTab('phira'); });
    var go2 = el('library-empty-btn');
    if (go2) go2.addEventListener('click', function () { APP.switchTab('phira'); });
  }

  APP.libraryUI = {
    init: init,
    refresh: refresh
  };
})();
