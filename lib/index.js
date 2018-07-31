const promiseFinally   = require('promise.prototype.finally');
const Queue            = require('promise-queue');
const debug            = require('debug')('nefit-easy-core');
const rawDebug         = require('debug')('nefit-easy-core:raw');
const HTTPParser       = require('http-string-parser');
const Connection       = require('@xmpp/connection');
const { Client, xml }  = require('@xmpp/client');
const { Stanza }       = require('@xmpp/xml');
const Encryption       = require('./encryption');
const { delay, defer } = require('./util');

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
    this.client = this.createClient();

    // Connection promise.
    this.connection = null;
    this.online     = false;

    // Pending GET requests.
    this.pending = {};
  };

  createClient() {
    let client = new Client();

    // Handle authentation requests.
    client.handle('authenticate', authenticate => {
      return authenticate(RRC_CONTACT_PREFIX + this.opts.serialNumber, ACCESSKEY_PREFIX + this.opts.accessKey);
    });

    return client;
  }

  ping() {
    if (this.online) {
      debug('sending ping');
      // Announce our presence.
      this.client.send(xml('presence'));
    }
    // Schedule the next ping.
    setTimeout(() => this.ping(), this.opts.pingInterval).unref();
  }

  restart() {
    if (this.restarting) return;
    debug('trying to restart the connection');
    this.restarting = true;
    return this.client.emit('disconnect');
  }

  connect(retry = false) {
    // If not already connected/connecting, create a promise that is resolved
    // when a connection has been made (or rejected if an error occurred).
    if (! this.connection) {
      this.connection = this.client.start(this.opts.uri).then(jid => {
        this.online = true;
        this.jid    = jid.toString();
        debug('online, jid = %s', this.jid);

        // Disable socket timeout and enable keepalives.
        this.client.socket.setTimeout(0);
        this.client.socket.setKeepAlive(true, 10000);

        // Send ping to backend to announce our presence.
        this.ping();

        // Handle errors by trying to restart the connection.
        this.client.on('error', e => {
          this.online = false;
          debug('connection error', e);
          this.restart();
        });

        this.client.on('disconnect', () => {
          this.online = false;
          debug('got disconnected')
          this.restart();
        });

        // Called when connection got restarted.
        this.client.on('online', jid => {
          this.online     = true;
          this.restarting = false;
          this.jid        = jid.toString();
          debug('online again, jid = %s', this.jid);
        });

        return this;
      }).catch(e => {
        debug('connection start error', e);
        if (! retry) throw e;
        return delay(500).then(() => this.connect(retry));
      });
    }

    // Return the promise.
    return this.connection;
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
      if (! this.online) {
        throw Error('CONNECTION_OFFLINE');
      }

      // Send the message.
      debug('sending message'); rawDebug(message.toString().replace(/\r/g, '\n'));
      return this.client.send(message).then(() => {
        let deferred = defer();

        const removeListeners = () => {
          clearTimeout(timer);
          this.client.removeListener('stanza', stanzaHandler);
          this.client.removeListener('error',  errorHandler);
        };

        // Start timer for request timeouts.
        const timer = setTimeout(() => {
          removeListeners();
          return deferred.reject(Error('REQUEST_TIMEOUT'));
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
                const error = Error('ERROR_RESPONSE');
                error.data  = stanza.root();
                return deferred.reject(error);

              case 'chat':
                // Parse the response as if it were an HTTP response, and resolve it.
                let match = stanza.toString().match(/<body>([\s\S]+)<\/body>/m);
                if (! match) return deferred.reject(Error('ERROR_RESPONSE'));
                return deferred.resolve(HTTPParser.parseResponse(match[1].replace(/\n/g, '\r\n')));

              default:
                // Else, return the full stanza.
                return deferred.resolve(stanza);
            }
          }
        };

        // Error handler.
        var errorHandler = e => {
          // Clear listeners.
          removeListeners();
          return deferred.reject(e);
        };

        // Listen to the relevant client events.
        this.client.on('stanza', stanzaHandler);
        this.client.on('error',  errorHandler);

        return deferred.promise;
      }).catch(e => {
        debug('error sending message', e);

        // Requeue the message if connection is offline (but is expected to go online again).
        if (e.message === 'CONNECTION_OFFLINE' || this.client.status === 'offline') {
          return delay(500).then(() => this.queueMessage(message));
        }

        // Otherwise, rethrow the exception.
        throw e;
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
          const error    = Error('INVALID_RESPONSE');
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
        const error    = Error('INVALID_RESPONSE');
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
