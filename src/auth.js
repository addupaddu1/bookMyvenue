// Passwords, login sessions and brute-force protection.
const crypto = require('crypto');
const { promisify } = require('util');
const { one, run } = require('./db');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, saltHex, hashHex] = String(stored).split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Used to spend the same time on unknown emails, so attackers can't tell
// which emails have accounts.
let dummyHash = null;
async function burnTime(password) {
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

// A readable random password, avoiding look-alike characters (0/O, 1/l/I).
function randomPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

// ---- sessions ----

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    sha256(token),
    userId,
    Date.now() + config.SESSION_HOURS * 3600 * 1000
  );
  return token;
}

// Returns the logged-in user (with their college) or null.
function userFromToken(token) {
  if (!token) return null;
  return one(
    `SELECT u.id, u.name, u.email, u.role, u.college_id, c.name AS college_name
       FROM sessions s
       JOIN users u    ON u.id = s.user_id
       JOIN colleges c ON c.id = u.college_id
      WHERE s.token_hash = ? AND s.expires_at > ?
        AND u.status = 'ACTIVE' AND c.status != 'INACTIVE'`,
    sha256(token),
    Date.now()
  );
}

function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

function destroyUserSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
}

// ---- brute-force protection: 5 wrong passwords locks that email+IP for 15 minutes ----

const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function loginLocked(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.until && entry.until > Date.now()) return true;
  if (entry.until && entry.until <= Date.now()) attempts.delete(key);
  return false;
}

function recordLoginFailure(key) {
  const entry = attempts.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.until = Date.now() + LOCK_MS;
  attempts.set(key, entry);
}

function clearLoginFailures(key) {
  attempts.delete(key);
}

module.exports = {
  hashPassword,
  verifyPassword,
  burnTime,
  randomPassword,
  createSession,
  userFromToken,
  destroySession,
  destroyUserSessions,
  purgeExpiredSessions,
  loginLocked,
  recordLoginFailure,
  clearLoginFailures,
};
