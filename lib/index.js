const Promise    = require('bluebird');
const Queue      = require('promise-queue'); Queue.configure(Promise);
const debug      = require('debug')('nefit-easy-client');
const rawDebug   = require('debug')('nefit-easy-client:raw');
const HTTPParser = require('http-string-parser');
const XMPPClient = require('node-xmpp-client');
const Stanza     = XMPPClient.Stanza;
const Encryption = require('./encryption');

// Default options for XMPP
const DEFAULT_OPTIONS = {
  host          : 'wa2-mz36-qrmzh6.bosch.de',
  saslMechanism : 'DIGEST-MD5',
};

// Various prefixes used by Bosch.
const ACCESSKEY_PREFIX   = 'Ct7ZR03b_';
const RRC_CONTACT_PREFIX = 'rrccontact_';
const RRC_GATEWAY_PREFIX = 'rrcgateway_';

var NefitEasyClient = module.exports = function NefitEasyClient(opts) {
  if (! (this instanceof NefitEasyClient)) return new NefitEasyClient(opts);

  // Merge options with defaults.
  this.opts = Object.assign({}, DEFAULT_OPTIONS, opts);

  // Generate some commonly used properties.
  var suffix    = this.opts.serialNumber + '@' + this.opts.host;
  this.opts.jid = this.opts._from = RRC_CONTACT_PREFIX + suffix;
  this.opts._to = RRC_GATEWAY_PREFIX + suffix;

  // Queue that holds pending requests. This allows us to limit the number of
  // concurrent requests to 1, which is a requirement imposed by the backend.
  this.queue = new Queue(1, Infinity);

  // Initialize crypto stuff
  this.encryption = Encryption(this.opts.serialNumber, this.opts.accessKey, this.opts.password);

  // Create XMPP client.
  this.client = new XMPPClient({
    host                   : this.opts.host,
    jid                    : this.opts.jid,
    password               : ACCESSKEY_PREFIX + this.opts.accessKey,
    preferredSaslMechanism : this.opts.saslMechanism,
    autostart              : false,
  });
};

NefitEasyClient.prototype.connect = function() {
  // If not already connected/connecting, create a promise that is resolved
  // when a connection has been made (or rejected if an error occurred).
  if (! this.connectionPromise) {
    this.connectionPromise = new Promise((resolve, reject) => {
      this.client.once('online', (r) => {
        this.client.removeAllListeners('error');

        debug('online', r);

        // Announce our presence.
        this.client.send('<presence/>');

        // Resolve the connection promise.
        return resolve(r);
      }).once('error', (e) => {
        debug('connection error', e);
        this.client.removeAllListeners('online');
        return reject(e);
      }).connect();
    });
  }

  // Return the promise.
  return this.connectionPromise;
};

NefitEasyClient.prototype.end = function() {
  this.client.end();
};

NefitEasyClient.prototype.send = function(body) {
  // Create the message.
  var stanza = new Stanza('message', {
    from : this.opts._from,
    to   : this.opts._to,
  }).c('body').t(body);

  // Queue the request
  debug('queuing request');
  return this.queue.add(() => {
    // Send the message.
    var raw = stanza.root().toString().replace(/\r/g, '&#13;\n');
    debug('sending message'); rawDebug(raw);
    this.client.send(raw);

    // Return a new promise that gets resolved once the response has been
    // received (or rejected).
    return new Promise((resolve, reject) => {
      var removeListeners = () => {
        this.client.removeListener('stanza', stanzaHandler);
        this.client.removeListener('error',  errorHandler);
      };
      var stanzaHandler = (stanza) => {
        // Process stanza.
        debug('received stanza'); rawDebug(stanza.root().toString());

        if (stanza.is('message')) {
          // Clear listeners.
          removeListeners();

          // Error?
          var type = stanza.attrs.type;
          if (type === 'error') {
            var error  = new Error('ERROR_RESPONSE');
            error.data = stanza.root();
            return reject(error);
          }

          // Chat?
          if (type === 'chat') {
            // Parse the response as if it were an HTTP response, and resolve it.
            return resolve(HTTPParser.parseResponse(stanza.root().getChild('body').getText().replace(/\n/g, '\r\n')));
          }

          // Else, return the full stanza.
          return resolve(stanza);
        }
      };
      var errorHandler = (e) => {
        // Clear listeners.
        removeListeners();

        // Reject the request promise.
        return reject(e);
      };
      this.client.on('stanza', stanzaHandler);
      this.client.on('error',  errorHandler);
    });
  });
};

NefitEasyClient.prototype.get = function(uri) {
  return this.send(`GET ${ uri } HTTP/1.1\rUser-Agent: NefitEasy\r\r`).then((response) => {
    if (response.statusCode !== '200') {
      var error = new Error('INVALID_RESPONSE');
      error.response = response;
      throw error;
    }

    // Decrypt message body and remove any padding.
    var decrypted = this.decrypt(response.body).replace(/\0*$/g, '');

    // Parse JSON responses.
    if (response.headers && response.headers['Content-Type'] === 'application/json') {
      try {
        decrypted = JSON.parse(decrypted);
      } catch(e) {
        throw e;
      }
    }
    return decrypted;
  });
};

NefitEasyClient.prototype.put = function(uri, data) {
  // Encrypt the data.
  var encrypted = this.encrypt(typeof data === 'string' ? data : JSON.stringify(data));

  // Build the stanza body and send it.
  return this.send([
    `PUT ${ uri } HTTP/1.1`,
    `Content-Type: application/json`,
    `Content-Length: ${ encrypted.length }`,
    `User-Agent: NefitEasy`,
    '',
    encrypted
  ].join('\r')).then((response) => {
    if (Number(response.statusCode || 500) >= 300) {
      var error = new Error('INVALID_RESPONSE');
      error.response = response;
      throw error;
    }
    return response.body || { status : 'ok' };
  });
};

NefitEasyClient.prototype.encrypt = function(data, type) {
  return this.encryption.encrypt(data, type);
};

NefitEasyClient.prototype.decrypt = function(data, type) {
  return this.encryption.decrypt(data, type);
};
