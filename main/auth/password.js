const crypto = require('node:crypto');

const KEY_LENGTH = 64;

function hashPassword(plainText) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plainText, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plainText, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(plainText, salt, KEY_LENGTH).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

module.exports = { hashPassword, verifyPassword };
