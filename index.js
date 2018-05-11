// Patch `crypto` so `tls-connect` doesn't trigger a deprecation warning.
require('crypto').__defineGetter__('createCredentials', () => require('tls').createSecureContext);

// Patch `tls` so `node-xmpp-tls-connect` doesn't trigger a deprecation warning.
require('tls').convertNPNProtocols = null;

module.exports = require('./lib');
