const promiseFinally  = require('promise.prototype.finally');
const Queue           = require('promise-queue');
const debug           = require('debug')('nefit-easy-core');
const rawDebug        = require('debug')('nefit-easy-core:raw');
const HTTPParser      = require('http-string-parser');
const Connection      = require('@xmpp/connection');
const { Client, xml } = require('@xmpp/client');
const { Stanza }      = require('@xmpp/xml');
const Encryption      = require('./encryption');

// Hack to please the backend.
let send = Connection.prototype.send;
Connection.prototype.send = function(data) {
  data = data.toString('utf8');
  return send.call(this, data.replace(/\r/g, '&#13;'));
};

// Add `finally()` to `Promise.prototype`
promiseFinally.shim();

// Configure queue to use Bluebird promises.
Queue.configure(Promise);

// Default options for XMPP
const DEFAULT_OPTIONS = {
  host         : 'wa2-mz36-qrmzh6.bosch.de',
  port         : 5222,
  pingInterval : 30 * 1000,
  maxRetries   : 15,
  retryTimeout : 2000,
};

// Various prefixes used by Bosch.
const ACCESSKEY_PREFIX   = 'Ct7ZR03b_';
const RRC_CONTACT_PREFIX = 'rrccontact_';
const RRC_GATEWAY_PREFIX = 'rrcgateway_';

class NefitEasyClient {

  constructor(opts) {
    // Merge options with defaults.
    this.opts = Object.assign({}, DEFAULT_OPTIONS, opts);

    // Generate some commonly used properties.
    const suffix  = this.opts.serialNumber + '@' + this.opts.host;
    this.opts.jid = this.opts._from = RRC_CONTACT_PREFIX + suffix;
    this.opts._to = RRC_GATEWAY_PREFIX + suffix;
    this.opts.uri = `xmpp://${ this.opts.host }:${ this.opts.port }`;

    // Queue that holds pending requests. This allows us to limit the number of
    // concurrent requests to 1, which is a requirement imposed by the backend.
    this.queue = new Queue(1, Infinity);

    // Initialize crypto stuff
    this.encryption = Encryption(this.opts.serialNumber, this.opts.accessKey, this.opts.password);

    // Create XMPP client.
    this.client = new Client();

    // Handle authentation requests.
    this.client.handle('authenticate', authenticate => {
      return authenticate(RRC_CONTACT_PREFIX + this.opts.serialNumber, ACCESSKEY_PREFIX + this.opts.accessKey);
    });

    // Pending GET requests.
    this.pending = {};
  };

  ping() {
    debug('sending ping');

    // Announce our presence.
    this.client.send(xml('presence'));

    // Schedule the next ping.
    setTimeout(() => this.ping(), this.opts.pingInterval).unref();
  }

  connect() {
    // If not already connected/connecting, create a promise that is resolved
    // when a connection has been made (or rejected if an error occurred).
    if (! this.connectionPromise) {
      this.connectionPromise = new Promise((resolve, reject) => {
        this.client.once('online', jid => {
          this.jid = jid.toString();
          debug('online, jid = %s', this.jid);

          // Disable socket timeout and enable keepalives.
          this.client.socket.setTimeout(0);
          this.client.socket.setKeepAlive(true, 10000);

          // Send ping to backend to announce our presence.
          this.ping();

          // Resolve the connection promise.
          return resolve(jid);
        });

        this.client.once('error', (e) => {
          debug('connection error', e);
          return reject(e);
        });

        this.client.start(this.opts.uri);
      });
    }

    // Return the promise.
    return this.connectionPromise;
  }

  end() {
    this.client.stop();
  }

  on() {
    return this.client.on.apply(this.client, arguments);
  }

  queueMessage(message) {
    // Queue the request
    return this.queue.add(() => {
      // Send the message.
      debug('sending message'); rawDebug(message.toString().replace(/\r/g, '\n'));
      this.client.send(message);

      // Return a new promise that gets resolved once the response has been
      // received (or rejected).
      return new Promise((resolve, reject) => {
        const removeListeners = () => {
          clearTimeout(timer);
          this.client.removeListener('stanza', stanzaHandler);
          this.client.removeListener('error',  errorHandler);
        };

        // Start timer for request timeouts.
        const timer = setTimeout(() => {
          removeListeners();
          return reject(new Error('REQUEST_TIMEOUT'));
        }, this.opts.retryTimeout);

        // Handler for incoming stanza messages.
        var stanzaHandler = stanza => {
          // Process stanza.
          debug('received stanza of type "%s"', stanza.name); rawDebug(stanza.root().toString());

          if (stanza.is('message')) {
            // Meant for us?
            const to = stanza.attrs.to;
            if (to !== this.jid) {
              debug('..stanza addressed to %s, not to us.', to);
              return;
            }

            // Clear listeners.
            removeListeners();

            // Determine course of action based on stanza type.
            switch (stanza.attrs.type) {
              case 'error':
                const error = new Error('ERROR_RESPONSE');
                error.data  = stanza.root();
                return reject(error);

              case 'chat':
                // Parse the response as if it were an HTTP response, and resolve it.
                let match = stanza.toString().match(/<body>([\s\S]+)<\/body>/m);
                if (! match) return resolve(Error('ERROR_RESPONSE'));
                return resolve(HTTPParser.parseResponse(match[1].replace(/\n/g, '\r\n')));

              default:
                // Else, return the full stanza.
                return resolve(stanza);
            }
          }
        };

        // Error handler.
        var errorHandler = e => {
          // Clear listeners.
          removeListeners();

          // Reject the request promise.
          return reject(e);
        };

        // Listen to the relevant client events.
        this.client.on('stanza', stanzaHandler);
        this.client.on('error',  errorHandler);
      });
    });
  }

  send(message, retries) {
    retries = retries || 0;
    debug('queuing request (retries = %s)', retries);
    return this.queueMessage(message).catch(e => {
      if (e.message !== 'REQUEST_TIMEOUT')  throw e;
      if (retries++ > this.opts.maxRetries) throw Error('MAX_RETRIES_REACHED');
      debug('message timed out, retrying...');
      return this.send(message, retries);
    });
  }

  buildMessage(body) {
    return new Stanza('message', {
      from : this.opts._from,
      to   : this.opts._to,
    }).c('body').t(body).root();
  }

  get(uri, retries) {
    const message = this.buildMessage(`GET ${ uri } HTTP/1.1\rUser-Agent: NefitEasy\r\r`);
    retries       = retries || 0;

    debug('preparing message: %s (retries = %s)', uri, retries);

    // If we already have a request pending for this URI, send the message again but reuse the pending promise.
    if (uri in this.pending) {
      debug('using pending request for %s', uri);
      this.client.send(message);
    } else {
      this.pending[uri] = this.send(message).then((response) => {
        if (response.statusCode !== '200') {
          const error    = new Error('INVALID_RESPONSE');
          error.response = response;
          throw error;
        }

        // Decrypt message body and remove any padding.
        let decrypted = this.decrypt(response.body).replace(/\0*$/g, '');

        // Parse JSON responses.
        if (response.headers && response.headers['Content-Type'] === 'application/json') {
          try {
            decrypted = JSON.parse(decrypted);
          } catch(e) {
            throw e;
          }
        }
        return decrypted;
      }).finally(() => {
        debug('cleaning up for %s', uri);
        delete this.pending[uri];
      });
    }
    return this.pending[uri];
  }

  put(uri, data) {
    // Encrypt the data.
    const encrypted = this.encrypt(typeof data === 'string' ? data : JSON.stringify(data));

    // Build the message.
    let message = this.buildMessage([
      `PUT ${ uri } HTTP/1.1`,
      `Content-Type: application/json`,
      `Content-Length: ${ encrypted.length }`,
      `User-Agent: NefitEasy`,
      '',
      encrypted
    ].join('\r\n'));

    // Send it.
    return this.send(message).then(response => {
      if (Number(response.statusCode || 500) >= 300) {
        const error    = new Error('INVALID_RESPONSE');
        error.response = response;
        throw error;
      }
      return response.body || { status : 'ok' };
    });
  }

  encrypt(data, type) {
    return this.encryption.encrypt(data, type);
  }

  decrypt(data, type) {
    return this.encryption.decrypt(data, type);
  }

}

module.exports = function(opts) {
  return new NefitEasyClient(opts);
};

module.exports.NefitEasyClient = NefitEasyClient;
