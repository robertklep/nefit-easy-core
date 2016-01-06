// Patch crypto so `tls-connect` doesn't trigger a deprecation warning.
require('crypto').__defineGetter__('createCredentials', () => require('tls').createSecureContext);

module.exports = require('./lib');
