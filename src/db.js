// Database setup (SQLite, built into Node 22 - nothing to install).
//
// College isolation is enforced HERE as well as in the code: venues, users and
// bookings all carry a college_id, and the foreign keys below are "composite",
// meaning a booking can only point to a venue and a user of the SAME college.
// The database itself refuses anything else.
const fs = require('fs');
const config = require('./config');

// Node prints an "experimental" notice for SQLite. Hide only that one message.
const originalEmit = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const text = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (text.includes('SQLite')) return;
  return originalEmit.call(process, warning, ...args);
};
const { DatabaseSync } = require('node:sqlite');
process.emitWarning = originalEmit;

fs.mkdirSync(config.DATA_DIR, { recursive: true });
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(config.DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS colleges (
  id          TEXT PRIMARY KEY CHECK (id GLOB '[a-z0-9]*' AND id NOT GLOB '*[^a-z0-9-]*'),
  name        TEXT NOT NULL,
  logo        TEXT,
  location    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMING_SOON','INACTIVE')),
  max_bookers INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  college_id    TEXT NOT NULL REFERENCES colleges(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('BOOKER','ADMIN')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (id, college_id)
);

CREATE TABLE IF NOT EXISTS venues (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  college_id           TEXT NOT NULL REFERENCES colleges(id),
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  images               TEXT NOT NULL DEFAULT '[]',
  location             TEXT NOT NULL DEFAULT '',
  capacity             INTEGER NOT NULL CHECK (capacity > 0),
  facilities           TEXT NOT NULL DEFAULT '[]',
  suitable_event_types TEXT NOT NULL DEFAULT '[]',
  rules                TEXT NOT NULL DEFAULT '',
  open_time            TEXT NOT NULL DEFAULT '08:00',
  close_time           TEXT NOT NULL DEFAULT '18:00',
  open_days            TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
  status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  sort_order           INTEGER NOT NULL DEFAULT 0,
  UNIQUE (id, college_id),
  UNIQUE (college_id, name)
);

CREATE TABLE IF NOT EXISTS venue_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  college_id TEXT NOT NULL,
  venue_id   INTEGER NOT NULL,
  date       TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '00:00',
  end_time   TEXT NOT NULL DEFAULT '23:59',
  reason     TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (venue_id, college_id) REFERENCES venues(id, college_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   TEXT NOT NULL UNIQUE,
  college_id   TEXT NOT NULL,
  venue_id     INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  event_name   TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  event_date   TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  participants INTEGER NOT NULL CHECK (participants > 0),
  organization TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  requirements TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  admin_note   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (venue_id, college_id) REFERENCES venues(id, college_id),
  FOREIGN KEY (user_id,  college_id) REFERENCES users(id,  college_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_college_status ON bookings (college_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_venue_date     ON bookings (venue_id, event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_user           ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_venues_college          ON venues (college_id);
CREATE INDEX IF NOT EXISTS idx_users_college           ON users (college_id);
`);

// Run several statements as one all-or-nothing unit.
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Convenience wrappers that return plain objects.
const one = (sql, ...params) => {
  const row = db.prepare(sql).get(...params);
  return row ? { ...row } : null;
};
const all = (sql, ...params) => db.prepare(sql).all(...params).map((r) => ({ ...r }));
const run = (sql, ...params) => db.prepare(sql).run(...params);

module.exports = { db, tx, one, all, run };
