const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('e322', Object.freeze({
  bootstrap: () => call('app:bootstrap'),
  saveSession: session => call('session:save', session),
  onSessionFlush: callback => subscribe('session:flush-request', callback),
  finishSessionFlush: () => call('session:flushed'),
  saveSettings: settings => call('settings:save', settings),
  search: (query, cursor, refresh, background = false) => call('api:search', query, cursor, refresh, background),
  cancelBackgroundSearch: () => call('api:cancelBackgroundSearch'),
  snapshotPage: key => call('api:snapshotPage', key),
  pinSnapshots: keys => call('api:pinSnapshots', keys),
  restorePage: (key, query, cursor) => call('api:restorePage', key, query, cursor),
  autocomplete: prefix => call('api:autocomplete', prefix),
  detail: id => call('api:detail', id),
  login: (username, apiKey) => call('account:login', username, apiKey),
  retryAccount: () => call('account:retry'),
  logout: () => call('account:logout'),
  updateBlacklist: rules => call('account:blacklist', rules),
  upvote: id => call('post:upvote', id),
  favorite: (id, active) => call('post:favorite', id, active),
  chooseFolder: () => call('download:chooseFolder'),
  startDownload: (post, combined) => call('download:start', post, combined),
  cancelDownload: id => call('download:cancel', id),
  openPost: id => call('post:openExternal', id),
  copyPost: id => call('post:copyLink', id),
  copyText: value => call('post:copyText', value),
  onDownload: callback => subscribe('download:changed', callback),
  onAccount: callback => subscribe('account:changed', callback),
  onStorageIssues: callback => subscribe('storage:issues', callback),
  onMenu: callback => subscribe('menu:command', callback),
}));
