// Booking requests: creating, listing, and the approve / reject / cancel flow.
const { one, all, run, tx } = require('./db');
const config = require('./config');
const v = require('./validate');
const { HttpError } = require('./errors');
const { todayStr, nowHM, weekday, daysBetween } = require('./dates');
const { venueInCollege, bookingForBooker, bookingForAdmin, BOOKING_SELECT, toId } = require('./permissions');
const { findConflict } = require('./venues');

function present(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    collegeId: row.college_id,
    venueId: row.venue_id,
    venueName: row.venue_name,
    venueLocation: row.venue_location,
    bookerName: row.booker_name,
    bookerEmail: row.booker_email,
    eventName: row.event_name,
    eventType: row.event_type,
    date: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    participants: row.participants,
    organization: row.organization,
    purpose: row.purpose,
    requirements: row.requirements,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The date/time must be real, in the future, inside the venue's open hours.
function checkTiming(venue, date, start, end) {
  const today = todayStr();
  if (date < today) throw new HttpError(400, 'The date cannot be in the past.');
  if (daysBetween(today, date) > config.BOOKING_WINDOW_DAYS) {
    throw new HttpError(400, `Bookings can only be made up to ${config.BOOKING_WINDOW_DAYS} days ahead.`);
  }
  if (end <= start) throw new HttpError(400, 'The end time must be after the start time.');
  if (date === today && start <= nowHM()) throw new HttpError(400, 'That start time has already passed.');
  const openDays = venue.open_days.split(',').map(Number);
  if (!openDays.includes(weekday(date))) throw new HttpError(400, 'This venue is closed on that day.');
  if (start < venue.open_time || end > venue.close_time) {
    throw new HttpError(400, `This venue can be booked only between ${venue.open_time} and ${venue.close_time}.`);
  }
}

// Used by "check my booking" before the final submit, and again inside create().
function readBookingFields(body) {
  return {
    venueId: toId(body.venueId),
    eventName: v.str(body.eventName, 'Event name', { max: 150 }),
    eventType: v.oneOf(body.eventType, 'Event type', config.EVENT_TYPES),
    date: v.date(body.date, 'Date'),
    startTime: v.time(body.startTime, 'Start time'),
    endTime: v.time(body.endTime, 'End time'),
    participants: v.int(body.participants, 'Expected participants', { min: 1, max: 5000 }),
    organization: v.str(body.organization, 'Department / class / organization', { max: 150 }),
    purpose: v.str(body.purpose, 'Purpose of the event', { max: 1000 }),
    requirements: v.str(body.requirements, 'Additional requirements', { max: 1000, required: false }),
  };
}

function validateRequest(user, body) {
  const f = readBookingFields(body);
  // The college always comes from the logged-in user. A venue from another college is "not found".
  const venue = venueInCollege(user.college_id, f.venueId);
  if (f.participants > venue.capacity) {
    throw new HttpError(400, `${venue.name} holds at most ${venue.capacity} people.`);
  }
  checkTiming(venue, f.date, f.startTime, f.endTime);
  return { f, venue };
}

function check(user, body) {
  const { f, venue } = validateRequest(user, body);
  const conflict = findConflict(user.college_id, venue.id, f.date, f.startTime, f.endTime);
  if (conflict) throw new HttpError(409, conflict);
  return { ok: true };
}

function nextRequestId(collegeId) {
  const year = new Date().getFullYear();
  const prefix = `${collegeId.toUpperCase()}-${year}-`;
  const last = one(
    `SELECT request_id FROM bookings WHERE college_id = ? AND request_id LIKE ? ORDER BY request_id DESC LIMIT 1`,
    collegeId, `${prefix}%`
  );
  const n = last ? Number(last.request_id.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

function create(user, body) {
  const { f, venue } = validateRequest(user, body);
  return tx(() => {
    const conflict = findConflict(user.college_id, venue.id, f.date, f.startTime, f.endTime);
    if (conflict) throw new HttpError(409, conflict);
    const requestId = nextRequestId(user.college_id);
    const result = run(
      `INSERT INTO bookings (request_id, college_id, venue_id, user_id, event_name, event_type, event_date,
                             start_time, end_time, participants, organization, purpose, requirements)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      requestId, user.college_id, venue.id, user.id, f.eventName, f.eventType, f.date,
      f.startTime, f.endTime, f.participants, f.organization, f.purpose, f.requirements
    );
    return present(bookingForBooker(user, Number(result.lastInsertRowid)));
  });
}

// ---- booker ----

function listMine(user) {
  return all(
    `${BOOKING_SELECT} WHERE b.user_id = ? AND b.college_id = ? ORDER BY b.event_date DESC, b.start_time DESC`,
    user.id, user.college_id
  ).map(present);
}

function getMine(user, id) {
  return present(bookingForBooker(user, id));
}

function cancelMine(user, id) {
  const booking = bookingForBooker(user, id);
  if (!['PENDING', 'APPROVED'].includes(booking.status)) {
    throw new HttpError(409, 'Only pending or approved requests can be cancelled.');
  }
  if (booking.event_date < todayStr()) throw new HttpError(409, 'This event is already over.');
  run(
    `UPDATE bookings SET status = 'CANCELLED', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND user_id = ? AND college_id = ?`,
    booking.id, user.id, user.college_id
  );
  return present(bookingForBooker(user, booking.id));
}

// ---- admin ----

function adminList(admin, query) {
  const where = ['b.college_id = ?'];
  const params = [admin.college_id];
  if (query.status) {
    where.push('b.status = ?');
    params.push(v.oneOf(query.status, 'Status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']));
  }
  if (query.venueId) {
    where.push('b.venue_id = ?');
    params.push(toId(query.venueId));
  }
  if (query.from) {
    where.push('b.event_date >= ?');
    params.push(v.date(query.from, 'From date'));
  }
  if (query.to) {
    where.push('b.event_date <= ?');
    params.push(v.date(query.to, 'To date'));
  }
  return all(
    `${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.event_date DESC, b.start_time DESC LIMIT 500`,
    ...params
  ).map(present);
}

function adminGet(admin, id) {
  return present(bookingForAdmin(admin, id));
}

const TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['CANCELLED'],
  REJECTED: [],
  CANCELLED: [],
};

function adminSetStatus(admin, id, body) {
  const next = v.oneOf(body.status, 'Status', ['APPROVED', 'REJECTED', 'CANCELLED']);
  const note = v.str(body.note, 'Note', { max: 500, required: false });
  return tx(() => {
    const booking = bookingForAdmin(admin, id);
    if (!TRANSITIONS[booking.status].includes(next)) {
      throw new HttpError(409, `A ${booking.status.toLowerCase()} request cannot be changed to ${next.toLowerCase()}.`);
    }
    if (next === 'APPROVED') {
      const venue = one(`SELECT * FROM venues WHERE id = ? AND college_id = ?`, booking.venue_id, admin.college_id);
      if (!venue || venue.status !== 'ACTIVE') throw new HttpError(409, 'This venue is not active.');
      if (booking.event_date < todayStr()) throw new HttpError(409, 'This event date has already passed.');
      const conflict = findConflict(admin.college_id, booking.venue_id, booking.event_date, booking.start_time, booking.end_time);
      if (conflict) throw new HttpError(409, conflict);
    }
    run(
      `UPDATE bookings SET status = ?, admin_note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND college_id = ?`,
      next, note, booking.id, admin.college_id
    );
    return present(bookingForAdmin(admin, booking.id));
  });
}

function adminOverview(admin) {
  const c = admin.college_id;
  const counts = Object.fromEntries(
    all(`SELECT status, COUNT(*) AS n FROM bookings WHERE college_id = ? GROUP BY status`, c).map((r) => [r.status, r.n])
  );
  const today = todayStr();
  const upcoming = all(
    `${BOOKING_SELECT} WHERE b.college_id = ? AND b.status = 'APPROVED' AND b.event_date >= ?
      ORDER BY b.event_date, b.start_time LIMIT 8`,
    c, today
  ).map(present);
  const pending = all(
    `${BOOKING_SELECT} WHERE b.college_id = ? AND b.status = 'PENDING' ORDER BY b.created_at LIMIT 8`,
    c
  ).map(present);
  return {
    counts: {
      PENDING: counts.PENDING || 0,
      APPROVED: counts.APPROVED || 0,
      REJECTED: counts.REJECTED || 0,
      CANCELLED: counts.CANCELLED || 0,
    },
    venues: one(`SELECT COUNT(*) AS n FROM venues WHERE college_id = ? AND status = 'ACTIVE'`, c).n,
    bookers: one(`SELECT COUNT(*) AS n FROM users WHERE college_id = ? AND role = 'BOOKER' AND status = 'ACTIVE'`, c).n,
    upcoming,
    pending,
  };
}

module.exports = {
  check, create, listMine, getMine, cancelMine,
  adminList, adminGet, adminSetStatus, adminOverview,
};
