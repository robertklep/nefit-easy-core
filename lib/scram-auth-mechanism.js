const { SASL }  = require('node-xmpp-client');
const crypto    = require('crypto');
const inherits  = require('node-xmpp-core').inherits;
const Mechanism = SASL.AbstractMechanism;

const sasl    = require('saslmechanisms');
const factory = new sasl.Factory();
factory.use(require('sasl-scram-sha-1'));

class SCRAM extends Mechanism {

  constructor() {
    super();
    this.mech = factory.create([ 'SCRAM-SHA-1' ]);
  }

  auth() {
    return this.mech.response({ username : this.authcid, password : this.password });
  }

  challenge(ch) {
    return this.mech.challenge(ch).response({ username : this.authcid, password : this.password });
  }
}

SCRAM.prototype.name  = 'SCRAM-SHA-1';
SCRAM.prototype.match = opts => 'password' in opts;

/*
function SCRAM(options) {
  this.clientNonce    = crypto.randomBytes(16).toString('hex');
  this.mech           = factory.create([ 'SCRAM-SHA-1' ]);
  this.mech._genNonce = () => this.clientNonce;
}

inherits(SCRAM, Mechanism);

SCRAM.prototype.name = 'SCRAM-SHA-1';

SCRAM.prototype.auth = function() {
  return this.mech.response({ username : this.authcid, password : this.password });
}

SCRAM.prototype.match = function(options) {
  return 'password' in options;
}

SCRAM.prototype.challenge = function(challenge) {
  return this.mech.challenge(challenge).response({ username : this.authcid, password : this.password });
}
  */

module.exports = SCRAM;

/*
const SCRAM = module.exports = class SCRAM extends Mechanism {

  constructor() {
    console.log('CTOR');
    this.name = 'SCRAM-SHA-1';
  }

  auth() {
    return '';
  }

  challenge(stanza) {
    console.log('CH', stanza);
    return false;
  }

  match(options) {
    return 'password' in options;
  }

}
*/
