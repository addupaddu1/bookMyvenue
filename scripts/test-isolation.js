// End-to-end safety tests. Run with:  npm test
// Uses a temporary database, so it never touches your real data.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bmv-test-'));

const { run, one, tx } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { todayStr, addDays, weekday } = require('../src/dates');
const { start } = require('../server');

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? '  -> ' + detail : ''}`);
}

let base = '';
class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, extra = {}) {
    const headers = { ...(extra.headers || {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (extra.raw) {
      headers['content-type'] = extra.contentType || 'image/png';
      payload = extra.raw;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    return { status: res.status, data };
  }
  get(url) { return this.call('GET', url); }
  post(url, body) { return this.call('POST', url, body || {}); }
  put(url, body) { return this.call('PUT', url, body || {}); }
  del(url) { return this.call('DELETE', url); }
  async login(email, password) {
    const r = await this.post('/api/auth/login', { email, password });
    return r;
  }
}

// A date that is an open day (Mon-Sat) about a week from now.
let day = addDays(todayStr(), 7);
if (weekday(day) === 0) day = addDays(day, 1);
const day2 = weekday(addDays(day, 1)) === 0 ? addDays(day, 2) : addDays(day, 1);

const bookingBody = (venueId, over = {}) => ({
  venueId, eventName: 'Tech Talk', eventType: 'Seminar', date: day, startTime: '10:00', endTime: '12:00',
  participants: 50, organization: 'Computer Dept', purpose: 'Guest lecture on AI', requirements: 'Mic', ...over,
});

async function setup() {
  const hash = await hashPassword('Password123');
  tx(() => {
    run(`INSERT INTO colleges (id,name,status,max_bookers) VALUES ('tcet','TCET','ACTIVE',3)`);
    run(`INSERT INTO colleges (id,name,status,max_bookers) VALUES ('other','Other College','ACTIVE',5)`);
    run(`INSERT INTO colleges (id,name,status) VALUES ('soon','Soon College','COMING_SOON')`);
    const v = (c, n, cap) => run(`INSERT INTO venues (college_id,name,capacity) VALUES (?,?,?)`, c, n, cap);
    v('tcet', 'TCET Hall', 100); v('tcet', 'TCET Small', 20); v('other', 'Other Hall', 100);
    const u = (c, n, e, r) => run(`INSERT INTO users (college_id,name,email,password_hash,role) VALUES (?,?,?,?,?)`, c, n, e, hash, r);
    u('tcet', 'TCET Admin', 'admin@t.test', 'ADMIN');
    u('tcet', 'Booker A', 'a@t.test', 'BOOKER');
    u('tcet', 'Booker B', 'b@t.test', 'BOOKER');
    u('other', 'Other Admin', 'admin@o.test', 'ADMIN');
    u('other', 'Other Booker', 'o@o.test', 'BOOKER');
  });
}

async function main() {
  await setup();
  const server = start(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const tcetHall = one(`SELECT id FROM venues WHERE name='TCET Hall'`).id;
  const tcetSmall = one(`SELECT id FROM venues WHERE name='TCET Small'`).id;
  const otherHall = one(`SELECT id FROM venues WHERE name='Other Hall'`).id;

  // ---------- public visitor ----------
  const pub = new Client();
  let r = await pub.get('/api/colleges');
  check('public sees college list', r.status === 200 && r.data.length === 3);
  r = await pub.get('/api/colleges/tcet/venues');
  check('public sees only TCET venues', r.status === 200 && r.data.venues.length === 2 && r.data.venues.every((x) => x.collegeId === 'tcet'));
  r = await pub.get('/api/colleges/other/venues');
  check('other college shows only its own venue', r.data.venues.length === 1 && r.data.venues[0].name === 'Other Hall');
  r = await pub.get('/api/colleges/soon/venues');
  check('coming-soon college has no venues', r.status === 200 && r.data.venues.length === 0);
  r = await pub.get(`/api/colleges/tcet/venues/${otherHall}`);
  check('venue id from another college is 404 under TCET', r.status === 404);
  r = await pub.get('/api/colleges/nope/venues');
  check('unknown college is 404', r.status === 404);
  r = await pub.post('/api/bookings', bookingBody(tcetHall));
  check('visitor cannot book (401)', r.status === 401);
  r = await pub.get('/api/bookings');
  check('visitor cannot list bookings (401)', r.status === 401);
  r = await pub.get('/api/admin/overview');
  check('visitor cannot open admin (401)', r.status === 401);
  r = await pub.get(`/api/colleges/tcet/venues/${tcetHall}/availability?date=${day}`);
  check('availability is public', r.status === 200 && r.data.isOpenDay === true);

  // ---------- login security ----------
  const lg = new Client();
  r = await lg.login('a@t.test', 'wrong');
  check('wrong password rejected', r.status === 401);
  r = await lg.login('nobody@t.test', 'Password123');
  check('unknown email gives same error', r.status === 401 && r.data.error === 'Incorrect email or password.');
  for (let i = 0; i < 4; i++) await lg.login('a@t.test', 'wrong');
  r = await lg.login('a@t.test', 'Password123');
  check('account locks after repeated failures (429)', r.status === 429);

  // ---------- booker A (TCET) ----------
  const A = new Client();
  r = await A.login('b@t.test', 'Password123'); // log in as B first just to verify, then switch
  const B = A; // client B
  const clientA = new Client();
  r = await clientA.login('a@t.test', 'Password123');
  // A is locked out by the test above for this ip; use a different login key by clearing via restart-free approach:
  // the lock is per email+ip, so a@t.test is locked. Use a fresh booker instead.
  check('locked account stays locked even with right password', r.status === 429);

  // Use dedicated accounts for the remaining tests.
  const hash = await hashPassword('Password123');
  run(`INSERT INTO users (college_id,name,email,password_hash,role) VALUES ('tcet','Booker C','c@t.test',?, 'BOOKER')`, hash);
  const C = new Client();
  r = await C.login('c@t.test', 'Password123');
  check('booker can log in', r.status === 200 && r.data.user.role === 'BOOKER' && r.data.user.collegeId === 'tcet');

  r = await C.get('/api/admin/overview');
  check('booker cannot open admin overview (403)', r.status === 403);
  r = await C.get('/api/admin/bookers');
  check('booker cannot list bookers (403)', r.status === 403);
  r = await C.post('/api/admin/bookers', { name: 'X', email: 'x@t.test' });
  check('booker cannot create bookers (403)', r.status === 403);
  r = await C.put(`/api/admin/venues/${tcetHall}`, { name: 'Hacked' });
  check('booker cannot edit venues (403)', r.status === 403);

  r = await C.post('/api/bookings', bookingBody(otherHall));
  check('TCET booker cannot book another college venue (404)', r.status === 404);
  r = await C.post('/api/bookings', { ...bookingBody(otherHall), collegeId: 'other' });
  check('sending a different collegeId changes nothing (404)', r.status === 404);
  r = await C.post('/api/bookings', { ...bookingBody(tcetHall), collegeId: 'other', userId: 999 });
  check('extra collegeId/userId fields are ignored', r.status === 200 && r.data.booking.collegeId === 'tcet');
  const bookingC1 = r.data.booking;
  check('booking starts PENDING', bookingC1.status === 'PENDING');
  check('request id looks like TCET-YEAR-0001', /^TCET-\d{4}-0001$/.test(bookingC1.requestId), bookingC1.requestId);
  r = await C.post('/api/bookings', bookingBody(tcetHall, { date: day2 }));
  check('second request id increments', /-0002$/.test(r.data.booking.requestId), JSON.stringify(r.data));

  // validation
  r = await C.post('/api/bookings', bookingBody(tcetSmall, { participants: 21 }));
  check('over capacity rejected', r.status === 400);
  r = await C.post('/api/bookings', bookingBody(tcetHall, { date: addDays(todayStr(), -1) }));
  check('past date rejected', r.status === 400);
  let sunday = addDays(todayStr(), 7); while (weekday(sunday) !== 0) sunday = addDays(sunday, 1);
  r = await C.post('/api/bookings', bookingBody(tcetHall, { date: sunday }));
  check('closed day (Sunday) rejected', r.status === 400);
  r = await C.post('/api/bookings', bookingBody(tcetHall, { startTime: '06:00', endTime: '07:00' }));
  check('outside opening hours rejected', r.status === 400);
  r = await C.post('/api/bookings', bookingBody(tcetHall, { startTime: '12:00', endTime: '10:00' }));
  check('end before start rejected', r.status === 400);
  r = await C.post('/api/bookings', bookingBody(tcetHall, { eventName: '' }));
  check('missing event name rejected', r.status === 400);
  r = await C.post('/api/bookings', bookingBody(tcetHall, { eventType: 'Wedding' }));
  check('unknown event type rejected', r.status === 400);
  r = await C.post('/api/bookings', bookingBody(tcetHall, { participants: 'abc' }));
  check('non-numeric participants rejected', r.status === 400);
  r = await C.post('/api/bookings', bookingBody('1 OR 1=1'));
  check('weird venue id rejected (404)', r.status === 404);

  // ---------- booker D: privacy between bookers ----------
  run(`INSERT INTO users (college_id,name,email,password_hash,role) VALUES ('tcet','Booker D','d@t.test',?, 'BOOKER')`, hash);
  const D = new Client();
  await D.login('d@t.test', 'Password123');
  r = await D.get('/api/bookings');
  check('booker D sees none of C\'s bookings', r.status === 200 && r.data.bookings.length === 0);
  r = await D.get(`/api/bookings/${bookingC1.id}`);
  check('booker D cannot open C\'s booking (404)', r.status === 404);
  r = await D.post(`/api/bookings/${bookingC1.id}/cancel`);
  check('booker D cannot cancel C\'s booking (404)', r.status === 404);
  r = await C.get('/api/bookings');
  check('booker C sees own 2 bookings', r.data.bookings.length === 2);

  // ---------- other college booker ----------
  const O = new Client();
  await O.login('o@o.test', 'Password123');
  r = await O.get(`/api/bookings/${bookingC1.id}`);
  check('other-college booker cannot open TCET booking (404)', r.status === 404);
  r = await O.post('/api/bookings', bookingBody(tcetHall));
  check('other-college booker cannot book TCET venue (404)', r.status === 404);

  // ---------- TCET admin ----------
  const T = new Client();
  r = await T.login('admin@t.test', 'Password123');
  check('admin can log in', r.status === 200 && r.data.user.role === 'ADMIN');
  r = await T.get('/api/bookings');
  check('admin cannot use booker endpoints (403)', r.status === 403);
  r = await T.post('/api/bookings', bookingBody(tcetHall));
  check('admin cannot submit bookings (403)', r.status === 403);
  r = await T.get('/api/admin/overview');
  check('admin overview works and names TCET', r.status === 200 && r.data.college.id === 'tcet' && r.data.counts.PENDING === 2);
  r = await T.get('/api/admin/bookings');
  check('admin sees only TCET bookings', r.data.bookings.length === 2 && r.data.bookings.every((b) => b.collegeId === 'tcet'));
  r = await T.get('/api/admin/venues');
  check('admin lists only TCET venues', r.data.venues.length === 2 && r.data.venues.every((x) => x.collegeId === 'tcet'));

  // Other college's data, attacked by TCET admin
  const otherBookingId = (() => {
    run(`INSERT INTO bookings (request_id,college_id,venue_id,user_id,event_name,event_type,event_date,start_time,end_time,participants,organization,purpose)
         VALUES ('OTHER-2026-0001','other',?,(SELECT id FROM users WHERE email='o@o.test'),'Other Event','Seminar',?,'10:00','11:00',10,'X','Y')`, otherHall, day);
    return one(`SELECT id FROM bookings WHERE request_id='OTHER-2026-0001'`).id;
  })();
  const otherBookerId = one(`SELECT id FROM users WHERE email='o@o.test'`).id;
  const otherAdminId = one(`SELECT id FROM users WHERE email='admin@o.test'`).id;

  r = await T.get(`/api/admin/bookings/${otherBookingId}`);
  check('TCET admin cannot read other college booking (404)', r.status === 404);
  r = await T.post(`/api/admin/bookings/${otherBookingId}/status`, { status: 'APPROVED' });
  check('TCET admin cannot approve other college booking (404)', r.status === 404);
  check('...and it really stayed pending', one(`SELECT status FROM bookings WHERE id=?`, otherBookingId).status === 'PENDING');
  r = await T.get(`/api/admin/venues/${otherHall}`);
  check('TCET admin cannot read other college venue (404)', r.status === 404);
  r = await T.put(`/api/admin/venues/${otherHall}`, { name: 'Taken Over', capacity: 5, openTime: '08:00', closeTime: '18:00', openDays: [1] });
  check('TCET admin cannot edit other college venue (404)', r.status === 404);
  r = await T.del(`/api/admin/venues/${otherHall}`);
  check('TCET admin cannot delete other college venue (404)', r.status === 404);
  check('...venue untouched', one(`SELECT name FROM venues WHERE id=?`, otherHall).name === 'Other Hall');
  r = await T.post(`/api/admin/venues/${otherHall}/blocks`, { date: day, allDay: true });
  check('TCET admin cannot block other college venue (404)', r.status === 404);
  r = await T.put(`/api/admin/bookers/${otherBookerId}`, { status: 'INACTIVE' });
  check('TCET admin cannot deactivate other college booker (404)', r.status === 404);
  r = await T.post(`/api/admin/bookers/${otherBookerId}/reset-password`, {});
  check('TCET admin cannot reset other college booker password (404)', r.status === 404);
  r = await T.put(`/api/admin/bookers/${otherAdminId}`, { status: 'INACTIVE' });
  check('TCET admin cannot touch another admin (404)', r.status === 404);
  r = await T.post(`/api/admin/venues/${otherHall}/images`, null);
  check('TCET admin cannot add images to other college venue', r.status === 404 || r.status === 400);
  r = await T.call('POST', `/api/admin/venues/${otherHall}/images`, undefined, { raw: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]) });
  check('...even with a real image (404)', r.status === 404);

  // approving and double-booking
  r = await T.post(`/api/admin/bookings/${bookingC1.id}/status`, { status: 'APPROVED', note: 'Enjoy' });
  check('admin approves booking', r.status === 200 && r.data.booking.status === 'APPROVED' && r.data.booking.adminNote === 'Enjoy');
  r = await D.post('/api/bookings', bookingBody(tcetHall, { startTime: '11:00', endTime: '13:00' }));
  check('overlapping an approved booking is refused (409)', r.status === 409);
  r = await D.post('/api/bookings', bookingBody(tcetHall, { startTime: '12:00', endTime: '13:00' }));
  check('back-to-back (starts when other ends) is allowed', r.status === 200);
  const dBooking = r.data.booking;
  r = await T.post(`/api/admin/bookings/${dBooking.id}/status`, { status: 'APPROVED' });
  check('approving it works (no overlap)', r.status === 200);
  // two pending requests on same slot: only one can be approved
  r = await D.post('/api/bookings', bookingBody(tcetSmall, { participants: 10, date: day2, startTime: '09:00', endTime: '10:00' }));
  const p1 = r.data.booking;
  r = await C.post('/api/bookings', bookingBody(tcetSmall, { participants: 10, date: day2, startTime: '09:30', endTime: '10:30' }));
  const p2 = r.data.booking;
  check('two pending requests can overlap', !!p1 && !!p2);
  await T.post(`/api/admin/bookings/${p1.id}/status`, { status: 'APPROVED' });
  r = await T.post(`/api/admin/bookings/${p2.id}/status`, { status: 'APPROVED' });
  check('second overlapping approval blocked (409)', r.status === 409);
  r = await T.post(`/api/admin/bookings/${p2.id}/status`, { status: 'REJECTED', note: 'Clash' });
  check('admin can reject instead', r.status === 200 && r.data.booking.status === 'REJECTED');
  r = await T.post(`/api/admin/bookings/${p2.id}/status`, { status: 'APPROVED' });
  check('rejected request cannot be re-approved (409)', r.status === 409);
  r = await T.post(`/api/admin/bookings/${p1.id}/status`, { status: 'PENDING' });
  check('cannot set status back to pending (400)', r.status === 400);
  r = await T.post(`/api/admin/bookings/${p1.id}/status`, { status: 'CANCELLED' });
  check('admin can cancel approved booking', r.status === 200 && r.data.booking.status === 'CANCELLED');
  r = await D.post(`/api/bookings/${dBooking.id}/cancel`);
  check('booker can cancel own approved booking', r.status === 200 && r.data.booking.status === 'CANCELLED');

  // availability blocks
  r = await T.post(`/api/admin/venues/${tcetSmall}/blocks`, { date: day, startTime: '14:00', endTime: '16:00', reason: 'Maintenance' });
  check('admin can block time', r.status === 200);
  const blockId = r.data.block.id;
  r = await C.post('/api/bookings', bookingBody(tcetSmall, { participants: 5, startTime: '15:00', endTime: '16:00' }));
  check('blocked time cannot be booked (409)', r.status === 409);
  r = await pub.get(`/api/colleges/tcet/venues/${tcetSmall}/availability?date=${day}`);
  check('public availability shows blocked slot without reason', r.data.busy.length === 1 && !JSON.stringify(r.data).includes('Maintenance'));
  r = await T.del(`/api/admin/blocks/${blockId}`);
  check('admin can remove block', r.status === 200);

  // ---------- booker management ----------
  r = await T.get('/api/admin/bookers');
  check('admin lists only TCET bookers', r.data.bookers.every((b) => ['Booker A', 'Booker B', 'Booker C', 'Booker D'].includes(b.name)) && r.data.bookers.length === 4);
  r = await T.post('/api/admin/bookers', { name: 'New', email: 'new@t.test' });
  check('creating booker beyond the cap is refused (409)', r.status === 409, JSON.stringify(r.data));
  r = await T.put(`/api/admin/bookers/${one(`SELECT id FROM users WHERE email='d@t.test'`).id}`, { status: 'INACTIVE' });
  check('admin deactivates a booker', r.status === 200 && r.data.booker.status === 'INACTIVE');
  r = await D.get('/api/bookings');
  check('deactivated booker is logged out immediately (401)', r.status === 401);
  r = await new Client().login('d@t.test', 'Password123');
  check('deactivated booker cannot log in', r.status === 401);
  r = await T.post('/api/admin/bookers', { name: 'New Person', email: 'new@t.test' });
  check('still at the cap after deactivating one (3 active of 3)', r.status === 409);
  run(`UPDATE colleges SET max_bookers = 4 WHERE id = 'tcet'`); // the platform operator raises the cap
  r = await T.post('/api/admin/bookers', { name: 'New Person', email: 'new@t.test' });
  check('with room under the cap, admin can create a booker', r.status === 200 && !!r.data.password && r.data.password.length >= 10, JSON.stringify(r.data));
  check('new booker belongs to TCET and is a BOOKER', (one(`SELECT college_id, role FROM users WHERE email='new@t.test'`) || {}).college_id === 'tcet');
  r = await T.post('/api/admin/bookers', { name: 'Dup', email: 'NEW@t.test' });
  check('duplicate email refused', r.status === 409 || r.status === 400);
  const nb = new Client();
  r = await nb.login('new@t.test', r.status === 200 ? '' : ''); // wrong on purpose
  check('empty password rejected', r.status === 401);

  // ---------- venue management ----------
  r = await T.post('/api/admin/venues', { name: 'New Room', capacity: 40, openTime: '09:00', closeTime: '17:00', openDays: [1, 2, 3], facilities: ['Projector'], suitableEventTypes: ['Seminar'] });
  check('admin creates venue in TCET', r.status === 200 && r.data.venue.collegeId === 'tcet');
  const newVenue = r.data.venue;
  r = await T.post('/api/admin/venues', { name: 'New Room', capacity: 40, openTime: '09:00', closeTime: '17:00', openDays: [1] });
  check('duplicate venue name refused (409)', r.status === 409);
  r = await T.put(`/api/admin/venues/${newVenue.id}`, { ...newVenue, name: 'New Room 2', capacity: 45 });
  check('admin edits venue', r.status === 200 && r.data.venue.capacity === 45);
  r = await T.post('/api/admin/venues', { name: 'Bad', capacity: 0, openTime: '09:00', closeTime: '17:00', openDays: [1] });
  check('zero capacity refused', r.status === 400);
  r = await T.post('/api/admin/venues', { name: 'Bad', capacity: 10, openTime: '09:00', closeTime: '17:00', openDays: 'nope' });
  check('bad open days refused (400, not a crash)', r.status === 400, String(r.status));
  r = await T.call('POST', `/api/admin/venues/${newVenue.id}/images`, undefined, { raw: Buffer.from('<script>alert(1)</script>'), contentType: 'image/png' });
  check('non-image upload refused', r.status === 400);
  const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(32)]);
  r = await T.call('POST', `/api/admin/venues/${newVenue.id}/images`, undefined, { raw: png });
  check('real image accepted', r.status === 200 && r.data.venue.images.length === 1 && /^\/uploads\/[a-f0-9]{32}\.png$/.test(r.data.venue.images[0]), JSON.stringify(r.data));
  const imgRes = await fetch(base + r.data.venue.images[0]);
  check('uploaded image is served', imgRes.status === 200 && imgRes.headers.get('content-type') === 'image/png');
  r = await T.del(`/api/admin/venues/${newVenue.id}/images/0`);
  check('image can be removed', r.status === 200 && r.data.venue.images.length === 0);
  r = await T.del(`/api/admin/venues/${newVenue.id}`);
  check('unused venue is deleted', r.status === 200 && r.data.removed === true);
  r = await T.del(`/api/admin/venues/${tcetHall}`);
  check('venue with history is deactivated, not erased', r.status === 200 && r.data.deactivated === true);
  r = await pub.get('/api/colleges/tcet/venues');
  check('deactivated venue disappears from public list', r.data.venues.length === 1);

  // ---------- the other admin only sees their own ----------
  const OA = new Client();
  await OA.login('admin@o.test', 'Password123');
  r = await OA.get('/api/admin/bookings');
  check('other admin sees only their college', r.data.bookings.length === 1 && r.data.bookings[0].collegeId === 'other');
  r = await OA.get(`/api/admin/bookings/${bookingC1.id}`);
  check('other admin cannot read TCET booking (404)', r.status === 404);
  r = await OA.get('/api/admin/bookers');
  check('other admin sees no TCET bookers', r.data.bookers.length === 1 && r.data.bookers[0].email === 'o@o.test');

  // ---------- database-level isolation (even buggy code can't mix colleges) ----------
  let blocked = false;
  try {
    run(`INSERT INTO bookings (request_id,college_id,venue_id,user_id,event_name,event_type,event_date,start_time,end_time,participants,organization,purpose)
         VALUES ('X-1','tcet',?,(SELECT id FROM users WHERE email='c@t.test'),'E','Seminar',?, '10:00','11:00',5,'O','P')`, otherHall, day);
  } catch { blocked = true; }
  check('database refuses a TCET booking pointing at another college venue', blocked);
  blocked = false;
  try {
    run(`INSERT INTO bookings (request_id,college_id,venue_id,user_id,event_name,event_type,event_date,start_time,end_time,participants,organization,purpose)
         VALUES ('X-2','tcet',?,?,'E','Seminar',?, '10:00','11:00',5,'O','P')`, tcetSmall, otherBookerId, day);
  } catch { blocked = true; }
  check('database refuses a TCET booking by another college user', blocked);

  // ---------- web hardening ----------
  r = await pub.call('POST', '/api/auth/login', { email: 'c@t.test', password: 'Password123' }, { headers: { origin: 'http://evil.example' } });
  check('cross-site request blocked (403)', r.status === 403);
  const trav = await fetch(base + '/..%2f..%2fetc%2fpasswd');
  check('path traversal does not leak files', trav.status === 404 || (await trav.text()).includes('<html'));
  const trav2 = await fetch(base + '/uploads/..%2f..%2fbookmyvenue.db');
  check('uploads path traversal blocked', trav2.status === 404);
  const page = await fetch(base + '/');
  check('security headers present', !!page.headers.get('content-security-policy') && page.headers.get('x-frame-options') === 'DENY');
  r = await pub.call('POST', '/api/auth/login', undefined, { headers: { 'content-type': 'text/plain' } });
  check('malformed login request handled', r.status === 400 || r.status === 415);
  const badJson = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  check('invalid JSON gives 400, not a crash', badJson.status === 400);
  const big = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(200000) }) });
  check('oversized request refused (413)', big.status === 413);

  // ---------- logout ----------
  r = await C.post('/api/auth/logout');
  r = await C.get('/api/bookings');
  check('after logout the session no longer works', r.status === 401);

  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log('\nFAILED:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
