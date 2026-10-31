/* global APP, hook */
(function () {
  'use strict';

  var util = APP.util;
  var state = {
    page: 1,
    order: '-updated',
    search: '',
    count: 0,
    items: [],
    loading: false,
    loadedOnce: false,
    detail: null,
    busy: false,
    hasMore: false
  };

  var imgObserver = null;

  function el(id) { return document.getElementById(id); }

  function savedIds() {
    return APP.state.savedIds || (APP.state.savedIds = {});
  }

  function isSaved(id) { return !!savedIds()[id]; }

  function refreshSaved() {
    return APP.idb.keys().then(function (keys) {
      var map = {};
      keys.forEach(function (k) { map[k] = true; });
      APP.state.savedIds = map;
      return map;
    }).catch(function () { return {}; });
  }

  /* ----------------------------- lazy images ----------------------------- */
  function getObserver() {
    if (!('IntersectionObserver' in window)) return null;
    if (!imgObserver) {
      imgObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var img = entry.target;
          var src = img.getAttribute('data-src');
          if (src) {
            img.src = src;
            img.removeAttribute('data-src');
          }
          imgObserver.unobserve(img);
        });
      }, { rootMargin: '320px 0px' });
    }
    return imgObserver;
  }

  function lazyImage(src) {
    var img = util.el('img', { alt: '', decoding: 'async' });
    var observer = getObserver();
    if (observer) {
      img.setAttribute('data-src', src);
      observer.observe(img);
    } else {
      img.src = src;
    }
    img.addEventListener('load', function () { img.classList.add('loaded'); });
    img.addEventListener('error', function () {
      img.style.display = 'none';
      var thumb = img.parentNode;
      if (thumb && !thumb.querySelector('.ph')) thumb.appendChild(util.el('div', { class: 'ph', text: 'φ' }));
    });
    return img;
  }

  /* --------------------------------- list --------------------------------- */
  function setStatus(text) {
    var node = el('phira-status');
    if (node) node.textContent = text || '';
  }

  function updateMeta() {
    var total = el('phira-total');
    if (total) {
      total.textContent = state.count ? '共 ' + state.count + ' 首曲谱' : '没有找到曲谱';
    }
    var pageinfo = el('phira-pageinfo');
    if (pageinfo) {
      pageinfo.textContent = state.count
        ? '已显示 ' + state.items.length + ' / ' + state.count
        : '';
    }
    var more = el('phira-more');
    if (more) {
      more.classList.toggle('hidden', !state.count || !state.hasMore);
      more.disabled = state.loading;
      more.textContent = state.loading ? '加载中…' : '加载更多';
    }
  }

  function makeCard(item) {
    var card = util.el('div', { class: 'chart-card', 'data-id': item.id });
    var thumb = util.el('div', { class: 'thumb' });
    thumb.appendChild(lazyImage(APP.phira.imageUrl(item.illustration, true)));
    if (item.level) thumb.appendChild(util.el('span', { class: 'lvl', text: item.level }));
    if (isSaved('phira:' + item.id)) thumb.appendChild(util.el('span', { class: 'saved', text: '已保存' }));

    var body = util.el('div', { class: 'body' });
    body.appendChild(util.el('div', { class: 'name', text: item.name || '未命名' }));
    body.appendChild(util.el('div', {
      class: 'sub',
      text: item.charter ? '谱师 · ' + item.charter : (item.composer || '')
    }));
    var meta = util.el('div', { class: 'meta' });
    meta.appendChild(util.el('span', { class: 'star', text: '★ ' + (item.rating ? Number(item.rating).toFixed(2) : '—') }));
    meta.appendChild(util.el('span', { class: 'spacer' }));
    if (item.ranked) meta.appendChild(util.el('span', { class: 'badge gold', text: 'Ranked' }));
    body.appendChild(meta);

    card.appendChild(thumb);
    card.appendChild(body);
    card.addEventListener('click', function () { openDetail(item.id); });
    return card;
  }

  function renderItems(items, append) {
    var grid = el('phira-grid');
    if (!grid) return;
    if (!append) grid.innerHTML = '';
    if (!state.items.length) {
      grid.appendChild(util.el('div', {
        class: 'empty',
        html: '<div class="empty-icon">φ</div><strong>没有匹配的曲谱</strong><span>换个关键词试试，或清空搜索条件</span>'
      }));
      return;
    }
    items.forEach(function (item) { grid.appendChild(makeCard(item)); });
  }

  function syncSavedBadges() {
    var cards = util.$$('#phira-grid .chart-card');
    cards.forEach(function (card) {
      var id = card.getAttribute('data-id');
      var saved = isSaved('phira:' + id);
      var badge = card.querySelector('.saved');
      if (saved && !badge) {
        var thumb = card.querySelector('.thumb');
        if (thumb) thumb.appendChild(util.el('span', { class: 'saved', text: '已保存' }));
      } else if (!saved && badge) {
        badge.parentNode.removeChild(badge);
      }
    });
  }

  function loadPage(page, append) {
    if (state.loading) return;
    if (APP.phira.isLan() && APP.lan && !APP.lan.ready()) {
      APP.lan.showGate();
      return;
    }
    state.loading = true;
    updateMeta();
    setStatus(append ? '加载更多…' : '加载中…');

    APP.phira.list({
      page: page,
      pageNum: APP.config.pageSize,
      order: state.order,
      search: state.search
    }).then(function (json) {
      var results = json.results || [];
      state.count = Number(json.count) || 0;
      state.page = page;
      state.items = append ? state.items.concat(results) : results;
      state.hasMore = state.items.length < state.count && results.length > 0;
      state.loadedOnce = true;
      renderItems(results, append);
      updateMeta();
      setStatus('');
    }).catch(function (err) {
      setStatus('');
      if (!append) {
        state.items = [];
        state.hasMore = false;
        var grid = el('phira-grid');
        if (grid) {
          grid.innerHTML = '';
          var box = util.el('div', {
            class: 'empty',
            html: '<div class="empty-icon">!</div><strong>曲库加载失败</strong><span>' +
              util.esc(err.message || '网络错误') + '</span>'
          });
          var retry = util.el('button', { class: 'btn', text: '重试' });
          retry.addEventListener('click', function () { loadPage(1, false); });
          box.appendChild(retry);
          grid.appendChild(box);
        }
      }
      updateMeta();
      util.toast(err.message || '曲库加载失败', 'err');
    }).then(function () {
      state.loading = false;
      updateMeta();
    });
  }

  function reload() {
    state.page = 1;
    state.items = [];
    state.hasMore = false;
    loadPage(1, false);
  }

  function loadMore() {
    if (state.loading || !state.hasMore) return;
    loadPage(state.page + 1, true);
  }

  /* -------------------------------- detail -------------------------------- */
  function showBrowse() {
    state.detail = null;
    var browse = el('phira-browse');
    var detail = el('phira-detail');
    if (browse) browse.classList.remove('hidden');
    if (detail) { detail.classList.add('hidden'); detail.innerHTML = ''; }
    if (APP.lan && APP.phira.isLan()) APP.lan.setDetailMode(false);
  }

  function showDetailView() {
    var browse = el('phira-browse');
    var detail = el('phira-detail');
    if (browse) browse.classList.add('hidden');
    if (detail) detail.classList.remove('hidden');
    if (APP.lan && APP.phira.isLan()) APP.lan.setDetailMode(true);
  }

  function metaRow(dt, dd) {
    var row = util.el('div');
    row.appendChild(util.el('dt', { text: dt }));
    row.appendChild(util.el('dd', { text: dd === null || dd === undefined || dd === '' ? '—' : dd, title: dd || '' }));
    return row;
  }

  function renderDetail(d) {
    state.detail = d;
    var host = el('phira-detail');
    if (!host) return;
    host.innerHTML = '';
    showDetailView();

    var saved = isSaved('phira:' + d.id);
    host.appendChild(util.el('div', { class: 'detail-top' }, [
      util.el('button', { class: 'btn ghost small', text: '← 返回列表', onclick: showBrowse })
    ]));

    var hero = util.el('div', { class: 'panel detail-hero' });

    var cover = util.el('div', { class: 'detail-cover' });
    var coverImg = util.el('img', { alt: '', decoding: 'async' });
    coverImg.src = APP.phira.imageUrl(d.illustration, false);
    coverImg.addEventListener('error', function () {
      coverImg.style.display = 'none';
      if (!cover.querySelector('.ph')) cover.appendChild(util.el('div', { class: 'ph', text: 'φ' }));
    });
    cover.appendChild(coverImg);

    var info = util.el('div', { class: 'detail-info' });
    info.appendChild(util.el('h2', { text: d.name || '未命名曲谱' }));
    info.appendChild(util.el('p', { class: 'detail-artist', text: (d.composer || '未知曲师') }));

    var badges = util.el('div', { class: 'badges' });
    if (d.level) badges.appendChild(util.el('span', { class: 'badge accent', text: d.level }));
    if (d.ranked) badges.appendChild(util.el('span', { class: 'badge gold', text: 'Ranked' }));
    if (d.stable) badges.appendChild(util.el('span', { class: 'badge', text: 'Stable' }));
    if (d.reviewed) badges.appendChild(util.el('span', { class: 'badge', text: '已审核' }));
    (d.tags || []).forEach(function (t) {
      if (['regular', 'troll', 'plain', 'visual'].indexOf(t) >= 0) return;
      badges.appendChild(util.el('span', { class: 'tag', text: t }));
    });
    info.appendChild(badges);

    var grid = util.el('div', { class: 'detail-grid' });
    grid.appendChild(metaRow('谱师', d.charter));
    grid.appendChild(metaRow('曲师', d.composer));
    grid.appendChild(metaRow('曲绘', d.illustrator || '—'));
    grid.appendChild(metaRow('评分', d.rating ? Number(d.rating).toFixed(3) + '（' + (d.ratingCount || 0) + ' 人）' : '—'));
    grid.appendChild(metaRow('谱面 ID', '#' + d.id));
    grid.appendChild(metaRow('更新于', util.fmtIso(d.chartUpdated || d.updated)));
    info.appendChild(grid);

    if (d.description) {
      info.appendChild(util.el('div', { class: 'detail-desc', text: d.description }));
    }

    var actions = util.el('div', { class: 'detail-actions' });
    var progress = util.el('div', { class: 'detail-progress hidden' }, [util.el('i')]);
    var button = util.el('button', { class: 'btn primary', text: saved ? '载入到模拟器' : '下载并载入' });
    var status = util.el('span', { class: 'detail-status', text: saved ? '已保存在本地曲库' : '' });
    actions.appendChild(button);
    actions.appendChild(progress);
    actions.appendChild(status);

    if (saved) {
      var del = util.el('button', { class: 'btn ghost danger', text: '从曲库移除' });
      del.addEventListener('click', function () {
        util.confirm('删除曲谱', '确定从本地曲库中删除「' + util.esc(d.name) + '」吗？', '删除').then(function (ok) {
          if (!ok) return;
          APP.idb.del('phira:' + d.id).then(function () {
            refreshSaved().then(function () {
              renderDetail(d);
              if (APP.libraryUI) APP.libraryUI.refresh();
              util.toast('已删除', 'ok');
            });
          });
        });
      });
      actions.appendChild(del);
    }

    button.addEventListener('click', function () {
      if (state.busy) return;
      if (isSaved('phira:' + d.id)) {
        loadSaved(d);
      } else {
        download(d, { button: button, progress: progress, status: status });
      }
    });

    info.appendChild(actions);
    hero.appendChild(cover);
    hero.appendChild(info);
    host.appendChild(hero);
  }

  function loadSaved(d) {
    var id = 'phira:' + d.id;
    APP.idb.get(id).then(function (rec) {
      if (!rec) throw new Error('本地记录不存在');
      return APP.loader.loadRecord(rec);
    }).then(function () {
      util.toast('已载入：' + (d.name || ''), 'ok');
      APP.switchTab('player');
    }).catch(function (err) {
      util.toast('载入失败：' + err.message, 'err');
    });
  }

  function openDetail(id) {
    if (APP.phira.isLan() && APP.lan && !APP.lan.ready()) {
      APP.lan.showGate();
      return;
    }
    var localId = 'phira:' + id;
    APP.phira.detail(id).catch(function (err) {
      return APP.idb.get(localId).then(function (rec) {
        if (rec) return rec;
        throw err;
      });
    }).then(function (d) {
      if (d && d.files && d.id === localId) {
        // offline fallback: build a detail view from the local record
        renderDetail({
          id: id,
          name: d.name,
          level: d.level,
          charter: d.charter,
          composer: d.composer,
          illustrator: d.illustrator,
          description: d.description,
          tags: d.tags || [],
          rating: d.rating,
          ratingCount: d.ratingCount,
          ranked: d.ranked,
          illustration: null
        });
        var host = el('phira-detail');
        var cover = host && host.querySelector('.detail-cover');
        if (cover && d.cover) {
          cover.innerHTML = '';
          cover.appendChild(util.el('img', { src: d.cover, alt: '' }));
        }
        util.toast('离线模式：显示本地保存的信息', 'warn');
        return;
      }
      renderDetail(d);
    }).catch(function (err) {
      util.toast('获取详情失败：' + err.message, 'err');
    });
  }

  /* ------------------------------- download ------------------------------- */
  function setProgress(node, loaded, total) {
    if (!node) return;
    var bar = node.querySelector('i');
    if (!bar) return;
    if (total > 0) bar.style.width = Math.min(100, Math.round(loaded / total * 100)) + '%';
    else bar.style.width = '60%';
    node.classList.remove('hidden');
  }

  function download(d, ui) {
    state.busy = true;
    if (ui.button) { ui.button.classList.add('disabled'); ui.button.textContent = '下载中…'; }
    if (ui.status) ui.status.textContent = '0%';
    if (ui.progress) ui.progress.classList.remove('hidden');

    APP.phira.fetchBinary(d.file, function (loaded, total) {
      if (ui.progress) setProgress(ui.progress, loaded, total);
      if (ui.status) {
        ui.status.textContent = total
          ? Math.round(loaded / total * 100) + '% · ' + util.fmtBytes(loaded) + ' / ' + util.fmtBytes(total)
          : util.fmtBytes(loaded);
      }
    }).then(function (buffer) {
      if (ui.status) ui.status.textContent = '解压中…';
      return importZipBuffer(buffer, d, function (text) {
        if (ui.status) ui.status.textContent = text;
      });
    }).then(function (rec) {
      state.busy = false;
      if (ui.progress) ui.progress.classList.add('hidden');
      if (ui.button) { ui.button.classList.remove('disabled'); ui.button.textContent = '载入到模拟器'; }
      if (ui.status) ui.status.textContent = '已保存到本地曲库';
      util.toast('已下载并载入：' + rec.name, 'ok');
      if (state.detail && state.detail.id === d.id) renderDetail(state.detail);
      if (APP.libraryUI) APP.libraryUI.refresh();
    }).catch(function (err) {
      state.busy = false;
      if (ui.progress) ui.progress.classList.add('hidden');
      if (ui.button) { ui.button.classList.remove('disabled'); ui.button.textContent = '下载并载入'; }
      if (ui.status) ui.status.textContent = '';
      if (err && err.code === 'cors') {
        showCorsHelp(d);
      } else {
        util.toast('下载失败：' + (err.message || err) + '（可重试）', 'err');
      }
    });
  }

  function showCorsHelp(d) {
    var direct = d.file;
    var proxy = APP.phira.proxyBase();
    util.modal({
      title: '需要手动导入曲谱包',
      body:
        '<p>浏览器以 <code>file://</code> 打开页面时，Phira 的文件 CDN 不允许跨域读取曲谱压缩包（这是服务端 CORS 限制，不是应用 bug）。</p>' +
        '<p><b>方法一：</b>点击下面按钮下载 zip，下载完成后点「选择 zip 文件」导入。导入后会自动保存到 IndexedDB 并载入模拟器。</p>' +
        '<p><b>方法二：</b>在「Phira 曲库 → 下载被浏览器跨域拦截？」中填写一个代理地址' +
        (proxy ? '（当前已填写）' : '（例如局域网 Fork 的 B 端）') + '，即可自动下载。</p>',
      okText: '选择 zip 文件',
      cancelText: '关闭',
      onMount: function (body) {
        var link = util.el('a', {
          class: 'btn ghost',
          href: direct,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: '① 下载 zip',
          style: 'display:inline-flex;margin-right:8px;text-decoration:none'
        });
        body.appendChild(link);
        body.appendChild(util.el('p', {
          class: 'muted',
          text: '如果浏览器直接打开了一串乱码，请右键另存为 .zip。'
        }));
      },
      onClose: function (ok) {
        if (!ok) return;
        setTimeout(function () {
          var input = el('phira-zip-input');
          if (input) input.click();
        }, 80);
      }
    });
  }

  /* -------------------------------- import ------------------------------- */
  function importZipBuffer(buffer, hint, onStatus) {
    onStatus = onStatus || function () {};
    var meta = null;
    var entries = null;

    return APP.zip.extract(buffer, {
      onProgress: function (n, total) {
        onStatus('解压中 ' + n + (total ? ' / ' + total : ''));
      }
    }).then(function (list) {
      entries = list;
      meta = APP.zip.parseMeta(entries);
      if (!meta.chartFile) throw new Error('压缩包里没有找到谱面文件（.json / .pec）');
      onStatus('生成封面…');
      return APP.zip.makeCover(entries.filter(function (f) { return f.name === meta.imageFile; })[0], 400);
    }).then(function (cover) {
      var name = (hint && hint.name) || meta.name || '未命名曲谱';
      var id = hint && hint.id ? 'phira:' + hint.id : 'local:' + util.hash(name + '|' + meta.chartFile + '|' + entries.length);
      var bytes = 0;
      entries.forEach(function (f) { bytes += (f.data && f.data.byteLength) || 0; });

      var record = {
        id: id,
        source: hint && hint.id ? 'phira' : 'local',
        phiraId: hint && hint.id ? hint.id : null,
        name: name,
        level: (hint && hint.level) || meta.level || '',
        difficulty: (hint && hint.difficulty) || null,
        charter: (hint && hint.charter) || meta.charter || '',
        composer: (hint && hint.composer) || meta.composer || '',
        illustrator: (hint && hint.illustrator) || meta.illustrator || '',
        description: (hint && hint.description) || meta.description || '',
        tags: (hint && hint.tags) || meta.tags || [],
        rating: hint && hint.rating ? hint.rating : null,
        ratingCount: hint && hint.ratingCount ? hint.ratingCount : 0,
        ranked: !!(hint && hint.ranked),
        uploader: hint && hint.uploader ? hint.uploader : null,
        chartFile: meta.chartFile,
        audioFile: meta.audioFile,
        imageFile: meta.imageFile,
        aspectRatio: meta.aspectRatio,
        files: entries.map(function (f) { return { name: f.name, data: f.data }; }),
        cover: cover || null,
        bytes: bytes,
        createdAt: Date.now(),
        sessionId: APP.state.sessionId
      };

      onStatus('写入 IndexedDB…');
      return APP.idb.put(record).then(function () { return record; });
    }).then(function (record) {
      onStatus('载入模拟器…');
      return refreshSaved().then(function () {
        syncSavedBadges();
        return APP.loader.loadRecord(record, {
          onProgress: function (n, total) { onStatus('载入 ' + n + ' / ' + total); }
        }).then(function () { return record; });
      });
    });
  }

  function importZipFile(file) {
    if (!file) return Promise.resolve();
    util.toast('正在导入 ' + file.name + ' …');
    return file.arrayBuffer().then(function (buffer) {
      return importZipBuffer(buffer, null, function (text) { setStatus(text); });
    }).then(function (rec) {
      setStatus('');
      util.toast('已导入并载入：' + rec.name, 'ok');
      if (APP.libraryUI) APP.libraryUI.refresh();
      APP.switchTab('player');
    }).catch(function (err) {
      setStatus('');
      util.toast('导入失败：' + (err.message || err), 'err');
    });
  }

  /* --------------------------------- init -------------------------------- */
  function init() {
    var search = el('phira-search');
    var order = el('phira-order');
    var btn = el('phira-search-btn');
    var refresh = el('phira-refresh');
    var importBtn = el('phira-import');
    var fileInput = el('phira-zip-input');
    var proxyInput = el('phira-proxy');
    var proxySave = el('phira-proxy-save');
    var more = el('phira-more');

    if (proxyInput) proxyInput.value = APP.phira.getProxy() || '';

    function doSearch() {
      state.search = search ? search.value.trim() : '';
      reload();
    }

    if (btn) btn.addEventListener('click', doSearch);
    if (search) {
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
      });
      search.addEventListener('input', util.debounce(doSearch, 1000));
    }
    if (order) order.addEventListener('change', function () {
      state.order = order.value;
      reload();
    });
    if (refresh) refresh.addEventListener('click', function () { reload(); });
    if (more) more.addEventListener('click', loadMore);
    if (importBtn) importBtn.addEventListener('click', function () { if (fileInput) fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) importZipFile(f);
    });
    if (proxySave) proxySave.addEventListener('click', function () {
      APP.phira.setProxy(proxyInput ? proxyInput.value : '');
      util.toast('代理地址已保存', 'ok');
      reload();
    });

    refreshSaved().then(function () {
      if (state.loadedOnce) syncSavedBadges();
    });
  }

  function ensureLoaded() {
    if (state.loadedOnce || state.loading) return;
    loadPage(1, false);
  }

  APP.phiraUI = {
    init: init,
    ensureLoaded: ensureLoaded,
    reload: reload,
    openDetail: openDetail,
    importZipFile: importZipFile,
    importZipBuffer: importZipBuffer,
    refreshSaved: refreshSaved,
    showBrowse: showBrowse
  };
})();
