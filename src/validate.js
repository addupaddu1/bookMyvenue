// Small input checkers. Every value from a request goes through one of these.
const { HttpError } = require('./errors');

const bad = (msg) => new HttpError(400, msg);

function str(v, name, { min = 0, max = 500, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required.`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${name} must be text.`);
  const s = v.trim();
  if (required && s.length === 0) throw bad(`${name} is required.`);
  if (s.length < min) throw bad(`${name} must be at least ${min} characters.`);
  if (s.length > max) throw bad(`${name} is too long (maximum ${max} characters).`);
  return s;
}

function int(v, name, { min = 0, max = 1000000 } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n)) throw bad(`${name} must be a whole number.`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}.`);
  return n;
}

function time(v, name) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
    throw bad(`${name} must be a time like 14:30.`);
  }
  return v;
}

function date(v, name) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${name} must be a date.`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`${name} is not a valid date.`);
  return v;
}

function list(v, name, { maxItems = 20, maxLen = 60 } = {}) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`${name} must be a list.`);
  if (v.length > maxItems) throw bad(`${name} can have at most ${maxItems} items.`);
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') throw bad(`${name} must contain only text.`);
    const s = item.trim();
    if (!s) continue;
    if (s.length > maxLen) throw bad(`Items in ${name} must be at most ${maxLen} characters.`);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function email(v) {
  const s = str(v, 'Email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Please enter a valid email address.');
  return s;
}

function password(v, name = 'Password') {
  if (typeof v !== 'string') throw bad(`${name} is required.`);
  if (v.length < 8) throw bad(`${name} must be at least 8 characters.`);
  if (v.length > 200) throw bad(`${name} is too long.`);
  return v;
}

function oneOf(v, name, allowed) {
  if (!allowed.includes(v)) throw bad(`${name} is not valid.`);
  return v;
}

module.exports = { str, int, time, date, list, email, password, oneOf };
