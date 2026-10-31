/* global APP */
window.APP = window.APP || {};

APP.config = {
  // 局域网 A 端：所有 Phira 数据都经由 B 端（Windows 电脑）代理获取
  mode: 'lan',
  version: '1.0.0',
  // LAN 模式不使用直连地址；保留字段以兼容共用代码
  apiBase: '',
  apiFallback: '',
  fileBase: '',
  pageSize: 12,
  lan: {
    defaultHost: '',
    defaultPort: 8765
  }
};
