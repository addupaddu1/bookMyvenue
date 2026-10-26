// All API routes. Each route says who may use it: 'public', 'any' (logged in),
// 'BOOKER' or 'ADMIN'. The role check happens here on the server before any handler runs.
const { one, all, run } = require('./db');
const config = require('./config');
const dates = require('./dates');
const v = require('./validate');
const { HttpError } = require('./errors');
const auth = require('./auth');
const perm = require('./permissions');
const venues = require('./venues');
const bookings = require('./bookings');
const bookers = require('./bookers');

const routes = [];
const route = (method, pattern, access, handler) => {
  const keys = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
  );
  routes.push({ method, regex, keys, access, handler });
};

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
  collegeId: u.college_id, collegeName: u.college_name,
});

// ---------- public ----------

route('GET', '/api/meta', 'public', () => ({
  eventTypes: config.EVENT_TYPES,
  timezone: config.TIMEZONE,
  today: dates.todayStr(),
  now: dates.nowHM(),
  bookingWindowDays: config.BOOKING_WINDOW_DAYS,
}));

route('GET', '/api/colleges', 'public', () =>
  all(`SELECT id, name, logo, location, description, status FROM colleges
        WHERE status != 'INACTIVE' ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, name`)
);

route('GET', '/api/colleges/:cid', 'public', ({ params }) => perm.publicCollege(params.cid));

route('GET', '/api/colleges/:cid/venues', 'public', ({ params }) => {
  const college = perm.publicCollege(params.cid);
  return { college, venues: college.status === 'ACTIVE' ? venues.listPublic(college.id) : [] };
});

route('GET', '/api/colleges/:cid/venues/:vid', 'public', ({ params }) => {
  const college = perm.publicCollege(params.cid);
  return { college, venue: venues.getPublic(college.id, params.vid) };
});

route('GET', '/api/colleges/:cid/venues/:vid/availability', 'public', ({ params, query }) => {
  const college = perm.publicCollege(params.cid);
  return venues.availability(college.id, params.vid, query.date);
});

// ---------- login / logout ----------

route('POST', '/api/auth/login', 'public', async ({ body, ip, setSession }) => {
  const email = v.str(body.email, 'Email', { max: 254 }).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const key = `${email}|${ip}`;
  if (auth.loginLocked(key)) {
    throw new HttpError(429, 'Too many failed attempts. Please wait 15 minutes and try again.');
  }
  const user = one(
    `SELECT u.*, c.name AS college_name, c.status AS college_status FROM users u
       JOIN colleges c ON c.id = u.college_id WHERE u.email = ?`,
    email
  );
  const valid =
    user && user.status === 'ACTIVE' && user.college_status !== 'INACTIVE'
      ? await auth.verifyPassword(password, user.password_hash)
      : (await auth.burnTime(password), false);
  if (!valid) {
    auth.recordLoginFailure(key);
    throw new HttpError(401, 'Incorrect email or password.');
  }
  auth.clearLoginFailures(key);
  setSession(auth.createSession(user.id));
  return { user: publicUser(user) };
});

route('POST', '/api/auth/logout', 'public', ({ token, setSession }) => {
  auth.destroySession(token);
  setSession(null);
  return { ok: true };
});

route('GET', '/api/auth/me', 'public', ({ user }) => ({ user: user ? publicUser(user) : null }));

route('POST', '/api/auth/password', 'any', async ({ user, body, token }) => {
  const row = one(`SELECT password_hash FROM users WHERE id = ?`, user.id);
  if (!(await auth.verifyPassword(typeof body.current === 'string' ? body.current : '', row.password_hash))) {
    throw new HttpError(400, 'Your current password is not correct.');
  }
  const next = v.password(body.next, 'New password');
  run(`UPDATE users SET password_hash = ? WHERE id = ?`, await auth.hashPassword(next), user.id);
  auth.destroyUserSessions(user.id);
  return { ok: true, loggedOut: true };
});

// ---------- booker ----------

route('POST', '/api/bookings/check', 'BOOKER', ({ user, body }) => bookings.check(user, body));
route('POST', '/api/bookings', 'BOOKER', ({ user, body }) => ({ booking: bookings.create(user, body) }));
route('GET', '/api/bookings', 'BOOKER', ({ user }) => ({ bookings: bookings.listMine(user) }));
route('GET', '/api/bookings/:id', 'BOOKER', ({ user, params }) => ({ booking: bookings.getMine(user, params.id) }));
route('POST', '/api/bookings/:id/cancel', 'BOOKER', ({ user, params }) => ({ booking: bookings.cancelMine(user, params.id) }));

// ---------- college admin (everything is limited to the admin's own college) ----------

route('GET', '/api/admin/overview', 'ADMIN', ({ user }) => ({
  college: perm.publicCollege(user.college_id),
  ...bookings.adminOverview(user),
}));

route('GET', '/api/admin/venues', 'ADMIN', ({ user }) => ({ venues: venues.adminList(user) }));
route('POST', '/api/admin/venues', 'ADMIN', ({ user, body }) => ({ venue: venues.adminCreate(user, body) }));
route('GET', '/api/admin/venues/:id', 'ADMIN', ({ user, params }) => ({ venue: venues.adminGet(user, params.id) }));
route('PUT', '/api/admin/venues/:id', 'ADMIN', ({ user, params, body }) => ({ venue: venues.adminUpdate(user, params.id, body) }));
route('DELETE', '/api/admin/venues/:id', 'ADMIN', ({ user, params }) => venues.adminRemove(user, params.id));
route('POST', '/api/admin/venues/:id/images', 'ADMIN', ({ user, params, raw }) => ({ venue: venues.adminAddImage(user, params.id, raw) }));
route('DELETE', '/api/admin/venues/:id/images/:index', 'ADMIN', ({ user, params }) => ({ venue: venues.adminRemoveImage(user, params.id, params.index) }));

route('GET', '/api/admin/venues/:id/blocks', 'ADMIN', ({ user, params }) => ({ blocks: venues.adminListBlocks(user, params.id) }));
route('POST', '/api/admin/venues/:id/blocks', 'ADMIN', ({ user, params, body }) => ({ block: venues.adminAddBlock(user, params.id, body) }));
route('DELETE', '/api/admin/blocks/:id', 'ADMIN', ({ user, params }) => (venues.adminRemoveBlock(user, params.id), { ok: true }));

route('GET', '/api/admin/bookings', 'ADMIN', ({ user, query }) => ({ bookings: bookings.adminList(user, query) }));
route('GET', '/api/admin/bookings/:id', 'ADMIN', ({ user, params }) => ({ booking: bookings.adminGet(user, params.id) }));
route('POST', '/api/admin/bookings/:id/status', 'ADMIN', ({ user, params, body }) => ({ booking: bookings.adminSetStatus(user, params.id, body) }));

route('GET', '/api/admin/bookers', 'ADMIN', ({ user }) => bookers.list(user));
route('POST', '/api/admin/bookers', 'ADMIN', ({ user, body }) => bookers.create(user, body));
route('PUT', '/api/admin/bookers/:id', 'ADMIN', ({ user, params, body }) => ({ booker: bookers.update(user, params.id, body) }));
route('POST', '/api/admin/bookers/:id/reset-password', 'ADMIN', ({ user, params, body }) => bookers.resetPassword(user, params.id, body));

route('GET', '/api/admin/settings', 'ADMIN', ({ user }) => ({ college: perm.publicCollege(user.college_id) }));
route('PUT', '/api/admin/settings', 'ADMIN', ({ user, body }) => {
  run(
    `UPDATE colleges SET location = ?, description = ? WHERE id = ?`,
    v.str(body.location, 'Location', { max: 200, required: false }),
    v.str(body.description, 'Description', { max: 1000, required: false }),
    user.college_id
  );
  return { college: perm.publicCollege(user.college_id) };
});

// ---------- dispatcher ----------

async function handle(ctx) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.regex.exec(ctx.path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== ctx.method) continue;
    ctx.params = {};
    r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    if (r.access !== 'public') {
      perm.requireLogin(ctx);
      if (r.access !== 'any') perm.requireRole(ctx, r.access);
    }
    return r.handler(ctx);
  }
  throw pathMatched ? new HttpError(405, 'Method not allowed.') : new HttpError(404, 'Not found.');
}

module.exports = { handle, routes };
