const crypto = require('crypto');
const MD5    = (s, encoding) => crypto.createHash('md5').update(s).digest(encoding);

// Magic number.
const MAGIC = Buffer.from('58f18d70f667c9c79ef7de435bf0f9b1553bbb6e61816212ab80e5b0d351fbb1', 'hex');

function generateKey(magicKey, id_key_uuid, privatePassword) {
  return Buffer.concat([
    MD5( Buffer.concat([ Buffer.from(id_key_uuid, 'utf8'), magicKey ]) ),
    MD5( Buffer.concat([ magicKey, Buffer.from(privatePassword, 'utf8') ]) )
  ]);
}

var Encryption = module.exports = function Encryption(serialNumber, accessKey, password) {
  if (! (this instanceof Encryption)) return new Encryption(serialNumber, accessKey, password);
  this.key = generateKey(MAGIC, accessKey, password);
};

Encryption.prototype.encrypt = function(data, type) {
  var cipher = crypto.createCipheriv('aes-256-ecb', this.key, Buffer.alloc(0));

  cipher.setAutoPadding(false);

  // Apply manual padding.
  var buffer = Buffer.from(data, 'utf8');
  if (buffer.length % 16 !== 0) {
    buffer = Buffer.concat([
      buffer,
      Buffer.alloc(16 - (buffer.length % 16), 0)
    ]);
  }
  return cipher.update(buffer, null, 'base64') + cipher.final('base64');
};

Encryption.prototype.decrypt = function(data, type) {
  var encrypted = Buffer.from(data, 'base64');
  var decipher  = crypto.createDecipheriv('aes-256-ecb', this.key, Buffer.alloc(0));

  decipher.setAutoPadding(false);

  // Add zero-padding?
  var paddingLength = encrypted.length % 8;
  if (paddingLength !== 0) {
    var padding = Buffer(paddingLength, 0);
    encrypted = Buffer.concat([ encrypted, padding ]);
  }
  return decipher.update(encrypted).toString() + decipher.final().toString();
};
