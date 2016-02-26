const crypto = require('crypto');
const MD5    = (s, encoding) => crypto.createHash('md5').update(s).digest(encoding);

// Magic number.
const MAGIC = new Buffer('58f18d70f667c9c79ef7de435bf0f9b1553bbb6e61816212ab80e5b0d351fbb1', 'hex');

function generateKey(magicKey, id_key_uuid, privatePassword) {
  return Buffer.concat([
    MD5( Buffer.concat([ new Buffer(id_key_uuid, 'utf8'), magicKey ]) ),
    MD5( Buffer.concat([ magicKey, new Buffer(privatePassword, 'utf8') ]) )
  ]);
}

var Encryption = module.exports = function Encryption(serialNumber, accessKey, password) {
  if (! (this instanceof Encryption)) return new Encryption(serialNumber, accessKey, password);
  this.key = generateKey(MAGIC,  accessKey, password);
};

Encryption.prototype.encrypt = function(data, type) {
  var cipher = crypto.createCipheriv('aes-256-ecb', this.key, new Buffer(0));

  cipher.setAutoPadding(false);

  // Apply manual padding.
  var buffer = new Buffer(data, 'utf8');
  if (buffer.length % 16 !== 0) {
    buffer = Buffer.concat([
      buffer,
      new Buffer(16 - (buffer.length % 16)).fill(0),
    ]);
  }
  return cipher.update(buffer, null, 'base64') + cipher.final('base64');
};

Encryption.prototype.decrypt = function(data, type) {
  var encrypted = new Buffer(data, 'base64');
  var decipher  = crypto.createDecipheriv('aes-256-ecb', this.key, new Buffer(0));

  decipher.setAutoPadding(false);

  // Add zero-padding?
  var paddingLength = encrypted.length % 8;
  if (paddingLength !== 0) {
    var padding = new Buffer(paddingLength).fill(0);
    encrypted = Buffer.concat([ encrypted, padding ]);
  }
  return decipher.update(encrypted).toString() + decipher.final().toString();
};
