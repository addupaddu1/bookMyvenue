// Onboard a new college and its own administrator. No code changes needed.
//
//   node scripts/add-college.js <code> "<College name>" <admin-email> ["<Admin name>"] ["<Location>"]
//   node scripts/add-college.js vit "Example Institute of Technology" admin@vit.example "VIT Admin" "Pune"
//
// <code> is a short lowercase id (letters, numbers, hyphens). It also becomes the booking
// request prefix, for example VIT-2026-0001. The new admin can manage only this college.
const { one, run, tx } = require('../src/db');
const { hashPassword, randomPassword } = require('../src/auth');

async function main() {
  const [code, name, email, adminName = 'College Admin', location = ''] = process.argv.slice(2);
  if (!code || !name || !email) {
    console.error('Usage: node scripts/add-college.js <code> "<College name>" <admin-email> ["<Admin name>"] ["<Location>"]');
    process.exit(1);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(code)) {
    console.error('The code must be 2-31 characters: lowercase letters, numbers and hyphens.');
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Please give a valid admin email address.');
    process.exit(1);
  }
  if (one('SELECT id FROM colleges WHERE id = ?', code)) {
    console.error(`A college with the code "${code}" already exists.`);
    process.exit(1);
  }
  if (one('SELECT id FROM users WHERE email = ?', email.toLowerCase())) {
    console.error('That email already belongs to an account.');
    process.exit(1);
  }

  const password = process.env.ADMIN_PASSWORD || randomPassword();
  const hash = await hashPassword(password);
  tx(() => {
    run(`INSERT INTO colleges (id, name, location, status) VALUES (?,?,?, 'ACTIVE')`, code, name, location);
    run(`INSERT INTO users (college_id, name, email, password_hash, role) VALUES (?,?,?,?, 'ADMIN')`, code, adminName, email.toLowerCase(), hash);
  });

  console.log(`\nCollege "${name}" added with code ${code.toUpperCase()}.`);
  console.log('\n  ADMIN LOGIN (shown once - save it, then change it after logging in):');
  console.log(`    email:    ${email.toLowerCase()}`);
  console.log(`    password: ${password}`);
  console.log('\n  The admin can now log in, add venues and create authorized bookers.\n');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
