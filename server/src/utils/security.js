const crypto = require('crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateTemporaryPassword() {
  const raw = crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  return `Hrms@${raw}1`;
}

module.exports = { randomToken, hashToken, generateTemporaryPassword };
