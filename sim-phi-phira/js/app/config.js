/* global APP */
window.APP = window.APP || {};

APP.config = {
  mode: 'local', // 'local' (单机) | 'lan' (局域网 A 端)
  version: '1.0.0',
  // 列表 / 详情优先使用 phira.moe 前端同款的 phira.5wyxi.com
  // （实测比 api.phira.cn 快很多），失败时自动切到备用域名
  apiBase: 'https://phira.5wyxi.com',
  apiFallback: 'https://api.phira.cn',
  // 曲谱包、封面等静态文件所在域
  fileBase: 'https://phira.5wyxi.com',
  pageSize: 12,
  lan: {
    defaultHost: '',
    defaultPort: 8765
  }
};
