// Authorized Booker accounts. Only a College Admin can create them (no public signup),
// and only inside that admin's own college.
const { one, all, run, tx } = require('./db');
const v = require('./validate');
const { HttpError } = require('./errors');
const { hashPassword, randomPassword, destroyUserSessions } = require('./auth');
const { bookerForAdmin } = require('./permissions');

const present = (r) => ({ id: r.id, name: r.name, email: r.email, status: r.status, createdAt: r.created_at });

function list(admin) {
  const college = one(`SELECT max_bookers FROM colleges WHERE id = ?`, admin.college_id);
  const bookers = all(
    `SELECT id, name, email, status, created_at FROM users
      WHERE college_id = ? AND role = 'BOOKER' ORDER BY status, name`,
    admin.college_id
  ).map(present);
  return { maxBookers: college.max_bookers, bookers };
}

async function create(admin, body) {
  const name = v.str(body.name, 'Name', { max: 100 });
  const email = v.email(body.email);
  const password = body.password ? v.password(body.password) : randomPassword();
  const hash = await hashPassword(password);
  const booker = tx(() => {
    const college = one(`SELECT max_bookers FROM colleges WHERE id = ?`, admin.college_id);
    const active = one(
      `SELECT COUNT(*) AS n FROM users WHERE college_id = ? AND role = 'BOOKER' AND status = 'ACTIVE'`,
      admin.college_id
    ).n;
    if (active >= college.max_bookers) {
      throw new HttpError(409, `This college can have at most ${college.max_bookers} active bookers. Deactivate one first.`);
    }
    if (one(`SELECT id FROM users WHERE email = ?`, email)) {
      throw new HttpError(409, 'An account with that email already exists.');
    }
    const result = run(
      `INSERT INTO users (college_id, name, email, password_hash, role) VALUES (?,?,?,?, 'BOOKER')`,
      admin.college_id, name, email, hash
    );
    return bookerForAdmin(admin, Number(result.lastInsertRowid));
  });
  // The password is returned this one time so the admin can pass it on.
  return { booker: present(booker), password };
}

function update(admin, id, body) {
  const booker = bookerForAdmin(admin, id);
  const name = body.name === undefined ? booker.name : v.str(body.name, 'Name', { max: 100 });
  const status = body.status === undefined ? booker.status : v.oneOf(body.status, 'Status', ['ACTIVE', 'INACTIVE']);
  tx(() => {
    if (status === 'ACTIVE' && booker.status !== 'ACTIVE') {
      const college = one(`SELECT max_bookers FROM colleges WHERE id = ?`, admin.college_id);
      const active = one(
        `SELECT COUNT(*) AS n FROM users WHERE college_id = ? AND role = 'BOOKER' AND status = 'ACTIVE'`,
        admin.college_id
      ).n;
      if (active >= college.max_bookers) {
        throw new HttpError(409, `This college can have at most ${college.max_bookers} active bookers.`);
      }
    }
    run(`UPDATE users SET name = ?, status = ? WHERE id = ? AND college_id = ? AND role = 'BOOKER'`, name, status, booker.id, admin.college_id);
  });
  if (status === 'INACTIVE') destroyUserSessions(booker.id); // kicks them out immediately
  return present(bookerForAdmin(admin, booker.id));
}

async function resetPassword(admin, id, body) {
  const booker = bookerForAdmin(admin, id);
  const password = body && body.password ? v.password(body.password) : randomPassword();
  const hash = await hashPassword(password);
  run(`UPDATE users SET password_hash = ? WHERE id = ? AND college_id = ? AND role = 'BOOKER'`, hash, booker.id, admin.college_id);
  destroyUserSessions(booker.id);
  return { password };
}

module.exports = { list, create, update, resetPassword };
