// THE place where "who is allowed to touch what" is decided.
//
// Rules used everywhere:
//  1. The user's role and college come from their login session on the server,
//     never from anything the browser sends.
//  2. Every lookup of a venue / booking / user includes the user's college in
//     the query. Something that belongs to another college simply "does not
//     exist" for that user (404), so nothing leaks.
const { one } = require('./db');
const { HttpError } = require('./errors');

function requireLogin(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Please log in to continue.');
  return ctx.user;
}

function requireRole(ctx, role) {
  const user = requireLogin(ctx);
  if (user.role !== role) throw new HttpError(403, 'You do not have permission to do that.');
  return user;
}

// Turn a URL piece into a whole number id, or 404.
function toId(value) {
  if (!/^\d{1,12}$/.test(String(value))) throw new HttpError(404, 'Not found.');
  return Number(value);
}

const notFound = (what) => new HttpError(404, `${what} not found.`);

// A college that visitors may look at (everything except INACTIVE).
function publicCollege(collegeId) {
  const college = one(
    `SELECT id, name, logo, location, description, status FROM colleges
      WHERE id = ? AND status != 'INACTIVE'`,
    collegeId
  );
  if (!college) throw notFound('College');
  return college;
}

// A venue inside one specific college (used for public browsing and booking).
function venueInCollege(collegeId, venueId, { activeOnly = true } = {}) {
  const venue = one(
    `SELECT * FROM venues WHERE id = ? AND college_id = ? ${activeOnly ? "AND status = 'ACTIVE'" : ''}`,
    toId(venueId),
    collegeId
  );
  if (!venue) throw notFound('Venue');
  return venue;
}

// Admin: only venues of the admin's own college.
function venueForAdmin(admin, venueId) {
  return venueInCollege(admin.college_id, venueId, { activeOnly: false });
}

const BOOKING_SELECT = `
  SELECT b.*, v.name AS venue_name, v.location AS venue_location,
         u.name AS booker_name, u.email AS booker_email
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id AND v.college_id = b.college_id
    JOIN users  u ON u.id = b.user_id  AND u.college_id = b.college_id`;

// Booker: only their OWN booking, in their own college.
function bookingForBooker(user, bookingId) {
  const booking = one(
    `${BOOKING_SELECT} WHERE b.id = ? AND b.user_id = ? AND b.college_id = ?`,
    toId(bookingId),
    user.id,
    user.college_id
  );
  if (!booking) throw notFound('Booking');
  return booking;
}

// Admin: any booking, but only in the admin's own college.
function bookingForAdmin(admin, bookingId) {
  const booking = one(`${BOOKING_SELECT} WHERE b.id = ? AND b.college_id = ?`, toId(bookingId), admin.college_id);
  if (!booking) throw notFound('Booking');
  return booking;
}

// Admin: only BOOKER accounts of the admin's own college.
function bookerForAdmin(admin, userId) {
  const booker = one(
    `SELECT id, name, email, status, created_at FROM users
      WHERE id = ? AND college_id = ? AND role = 'BOOKER'`,
    toId(userId),
    admin.college_id
  );
  if (!booker) throw notFound('Booker');
  return booker;
}

module.exports = {
  requireLogin,
  requireRole,
  toId,
  publicCollege,
  venueInCollege,
  venueForAdmin,
  bookingForBooker,
  bookingForAdmin,
  bookerForAdmin,
  BOOKING_SELECT,
};
