// Venues: public views, admin editing, images and availability.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { one, all, run, tx } = require('./db');
const config = require('./config');
const v = require('./validate');
const { HttpError } = require('./errors');
const { weekday, todayStr, addDays } = require('./dates');
const { venueInCollege, venueForAdmin, toId } = require('./permissions');

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

// Shape a database row for the browser.
function present(row) {
  return {
    id: row.id,
    collegeId: row.college_id,
    name: row.name,
    description: row.description,
    images: parseJson(row.images, []).map((f) => `/uploads/${f}`),
    location: row.location,
    capacity: row.capacity,
    facilities: parseJson(row.facilities, []),
    suitableEventTypes: parseJson(row.suitable_event_types, []),
    rules: row.rules,
    openTime: row.open_time,
    closeTime: row.close_time,
    openDays: row.open_days.split(',').filter(Boolean).map(Number),
    status: row.status,
  };
}

// ---- public ----

function listPublic(collegeId) {
  return all(
    `SELECT * FROM venues WHERE college_id = ? AND status = 'ACTIVE' ORDER BY sort_order, name`,
    collegeId
  ).map(present);
}

function getPublic(collegeId, venueId) {
  return present(venueInCollege(collegeId, venueId));
}

// ---- availability ----

// What is already taken on one day. Public-safe: no names or reasons.
function busySlots(collegeId, venueId, date) {
  const booked = all(
    `SELECT start_time AS start, end_time AS end FROM bookings
      WHERE college_id = ? AND venue_id = ? AND event_date = ? AND status = 'APPROVED'`,
    collegeId, venueId, date
  ).map((s) => ({ ...s, kind: 'booked' }));
  const blocked = all(
    `SELECT start_time AS start, end_time AS end FROM venue_blocks
      WHERE college_id = ? AND venue_id = ? AND date = ?`,
    collegeId, venueId, date
  ).map((s) => ({ ...s, kind: 'unavailable' }));
  return [...booked, ...blocked].sort((a, b) => a.start.localeCompare(b.start));
}

function availability(collegeId, venueId, date) {
  const venue = venueInCollege(collegeId, venueId);
  v.date(date, 'Date');
  const isOpenDay = venue.open_days.split(',').map(Number).includes(weekday(date));
  return {
    date,
    isOpenDay,
    openTime: venue.open_time,
    closeTime: venue.close_time,
    busy: isOpenDay ? busySlots(collegeId, venue.id, date) : [],
  };
}

// Two time ranges overlap when each starts before the other ends.
function findConflict(collegeId, venueId, date, start, end) {
  const booking = one(
    `SELECT id FROM bookings
      WHERE college_id = ? AND venue_id = ? AND event_date = ? AND status = 'APPROVED'
        AND start_time < ? AND end_time > ? LIMIT 1`,
    collegeId, venueId, date, end, start
  );
  if (booking) return 'This venue is already booked for part of that time.';
  const block = one(
    `SELECT id FROM venue_blocks
      WHERE college_id = ? AND venue_id = ? AND date = ?
        AND start_time < ? AND end_time > ? LIMIT 1`,
    collegeId, venueId, date, end, start
  );
  if (block) return 'The venue is not available for part of that time.';
  return null;
}

// ---- admin: venue details ----

function readVenueFields(body) {
  if (!Array.isArray(body.openDays)) throw new HttpError(400, 'Open days must be a list of days.');
  const openDays = v.list(body.openDays.map(String), 'Open days', { maxItems: 7, maxLen: 1 });
  for (const d of openDays) if (!/^[0-6]$/.test(d)) throw new HttpError(400, 'Open days must be numbers 0 to 6.');
  if (openDays.length === 0) throw new HttpError(400, 'Choose at least one open day.');
  const openTime = v.time(body.openTime, 'Opening time');
  const closeTime = v.time(body.closeTime, 'Closing time');
  if (closeTime <= openTime) throw new HttpError(400, 'Closing time must be after opening time.');
  const eventTypes = v.list(body.suitableEventTypes, 'Suitable event types');
  for (const t of eventTypes) v.oneOf(t, 'Event type', config.EVENT_TYPES);
  return {
    name: v.str(body.name, 'Name', { max: 100 }),
    description: v.str(body.description, 'Description', { max: 2000, required: false }),
    location: v.str(body.location, 'Location', { max: 200, required: false }),
    capacity: v.int(body.capacity, 'Capacity', { min: 1, max: 5000 }),
    facilities: v.list(body.facilities, 'Facilities'),
    suitableEventTypes: eventTypes,
    rules: v.str(body.rules, 'Rules', { max: 2000, required: false }),
    openTime,
    closeTime,
    openDays: openDays.sort().join(','),
  };
}

const isUniqueError = (err) => /UNIQUE/i.test(String(err && err.message));

function adminList(admin) {
  return all(`SELECT * FROM venues WHERE college_id = ? ORDER BY sort_order, name`, admin.college_id).map(present);
}

function adminGet(admin, venueId) {
  return present(venueForAdmin(admin, venueId));
}

function adminCreate(admin, body) {
  const f = readVenueFields(body);
  try {
    const result = run(
      `INSERT INTO venues (college_id, name, description, images, location, capacity, facilities,
                           suitable_event_types, rules, open_time, close_time, open_days, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,
               (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM venues WHERE college_id = ?))`,
      admin.college_id, f.name, f.description, '[]', f.location, f.capacity,
      JSON.stringify(f.facilities), JSON.stringify(f.suitableEventTypes), f.rules,
      f.openTime, f.closeTime, f.openDays, admin.college_id
    );
    return adminGet(admin, Number(result.lastInsertRowid));
  } catch (err) {
    if (isUniqueError(err)) throw new HttpError(409, 'A venue with that name already exists.');
    throw err;
  }
}

function adminUpdate(admin, venueId, body) {
  const existing = venueForAdmin(admin, venueId);
  const f = readVenueFields(body);
  const status = body.status === undefined ? existing.status : v.oneOf(body.status, 'Status', ['ACTIVE', 'INACTIVE']);
  try {
    run(
      `UPDATE venues SET name=?, description=?, location=?, capacity=?, facilities=?,
              suitable_event_types=?, rules=?, open_time=?, close_time=?, open_days=?, status=?
        WHERE id = ? AND college_id = ?`,
      f.name, f.description, f.location, f.capacity, JSON.stringify(f.facilities),
      JSON.stringify(f.suitableEventTypes), f.rules, f.openTime, f.closeTime, f.openDays, status,
      existing.id, admin.college_id
    );
  } catch (err) {
    if (isUniqueError(err)) throw new HttpError(409, 'A venue with that name already exists.');
    throw err;
  }
  return adminGet(admin, existing.id);
}

// Venues with booking history are hidden instead of erased, so history stays correct.
function adminRemove(admin, venueId) {
  const venue = venueForAdmin(admin, venueId);
  const used = one(`SELECT COUNT(*) AS n FROM bookings WHERE venue_id = ? AND college_id = ?`, venue.id, admin.college_id).n;
  if (used > 0) {
    run(`UPDATE venues SET status = 'INACTIVE' WHERE id = ? AND college_id = ?`, venue.id, admin.college_id);
    return { removed: false, deactivated: true };
  }
  for (const file of parseJson(venue.images, [])) deleteImageFile(file);
  run(`DELETE FROM venues WHERE id = ? AND college_id = ?`, venue.id, admin.college_id);
  return { removed: true, deactivated: false };
}

// ---- admin: images ----

const IMAGE_TYPES = [
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'gif', test: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

const IMAGE_FILE = /^[a-f0-9]{32}\.(jpg|png|gif|webp)$/;

function deleteImageFile(file) {
  if (!IMAGE_FILE.test(file)) return;
  fs.rmSync(path.join(config.UPLOAD_DIR, file), { force: true });
}

function adminAddImage(admin, venueId, buffer) {
  const venue = venueForAdmin(admin, venueId);
  if (!buffer || buffer.length === 0) throw new HttpError(400, 'No image received.');
  // Decide the type from the file's real contents, not from what the browser claims.
  const type = IMAGE_TYPES.find((t) => t.test(buffer));
  if (!type) throw new HttpError(400, 'Please upload a JPG, PNG, GIF or WebP image.');
  const images = parseJson(venue.images, []);
  if (images.length >= config.MAX_IMAGES_PER_VENUE) {
    throw new HttpError(400, `A venue can have at most ${config.MAX_IMAGES_PER_VENUE} photos.`);
  }
  const file = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
  fs.writeFileSync(path.join(config.UPLOAD_DIR, file), buffer);
  images.push(file);
  run(`UPDATE venues SET images = ? WHERE id = ? AND college_id = ?`, JSON.stringify(images), venue.id, admin.college_id);
  return adminGet(admin, venue.id);
}

function adminRemoveImage(admin, venueId, index) {
  const venue = venueForAdmin(admin, venueId);
  const images = parseJson(venue.images, []);
  const i = v.int(index, 'Photo number', { min: 0, max: 100 });
  if (i >= images.length) throw new HttpError(404, 'Photo not found.');
  const [file] = images.splice(i, 1);
  run(`UPDATE venues SET images = ? WHERE id = ? AND college_id = ?`, JSON.stringify(images), venue.id, admin.college_id);
  deleteImageFile(file);
  return adminGet(admin, venue.id);
}

function imageFilePath(file) {
  if (!IMAGE_FILE.test(file)) return null;
  return path.join(config.UPLOAD_DIR, file);
}

// ---- admin: availability blocks (maintenance, exams, holidays) ----

function adminListBlocks(admin, venueId) {
  const venue = venueForAdmin(admin, venueId);
  return all(
    `SELECT id, date, start_time AS startTime, end_time AS endTime, reason FROM venue_blocks
      WHERE venue_id = ? AND college_id = ? AND date >= ? ORDER BY date, start_time`,
    venue.id, admin.college_id, addDays(todayStr(), -1)
  );
}

function adminAddBlock(admin, venueId, body) {
  const venue = venueForAdmin(admin, venueId);
  const date = v.date(body.date, 'Date');
  if (date < todayStr()) throw new HttpError(400, 'You cannot block a date in the past.');
  const allDay = body.allDay === true;
  const start = allDay ? '00:00' : v.time(body.startTime, 'Start time');
  const end = allDay ? '23:59' : v.time(body.endTime, 'End time');
  if (end <= start) throw new HttpError(400, 'End time must be after start time.');
  const reason = v.str(body.reason, 'Reason', { max: 200, required: false });
  const result = run(
    `INSERT INTO venue_blocks (college_id, venue_id, date, start_time, end_time, reason) VALUES (?,?,?,?,?,?)`,
    admin.college_id, venue.id, date, start, end, reason
  );
  return { id: Number(result.lastInsertRowid), date, startTime: start, endTime: end, reason };
}

function adminRemoveBlock(admin, blockId) {
  const result = run(`DELETE FROM venue_blocks WHERE id = ? AND college_id = ?`, toId(blockId), admin.college_id);
  if (result.changes === 0) throw new HttpError(404, 'Block not found.');
}

module.exports = {
  listPublic,
  getPublic,
  availability,
  findConflict,
  busySlots,
  adminList,
  adminGet,
  adminCreate,
  adminUpdate,
  adminRemove,
  adminAddImage,
  adminRemoveImage,
  imageFilePath,
  adminListBlocks,
  adminAddBlock,
  adminRemoveBlock,
};
