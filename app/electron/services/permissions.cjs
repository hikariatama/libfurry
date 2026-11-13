const { pathToFileURL } = require('node:url');

function installPermissions(session, webContents, entryFile) {
  const expected = pathToFileURL(entryFile).href;
  const allowed = (contents, permission, details = {}) => permission === 'fullscreen' &&
    contents === webContents && details.isMainFrame === true &&
    (details.requestingUrl || details.securityOrigin) === expected;
  session.setPermissionCheckHandler((contents, permission, _origin, details) => allowed(contents, permission, details));
  session.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowed(contents, permission, details)));
  session.setDevicePermissionHandler(() => false);
}

module.exports = { installPermissions };
