// Set a new password for any account. Run it on the computer that hosts BookMyVenue
// (it needs access to the data folder, so only the site owner can use it).
//
//   node scripts/reset-password.js <email>                  (makes a random new password)
//   node scripts/reset-password.js <email> "MyNewPassword1" (uses the password you give)
//
// Stop the website first if it is running (Ctrl+C), then start it again afterwards.
const { one, run } = require('../src/db');
const { hashPassword, randomPassword, destroyUserSessions } = require('../src/auth');

async function main() {
  const [emailArg, given] = process.argv.slice(2);
  if (!emailArg) {
    console.error('Usage: node scripts/reset-password.js <email> ["new password"]');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  const user = one('SELECT id, name, role, college_id, status FROM users WHERE email = ?', email);
  if (!user) {
    console.error(`No account has the email "${email}". Check the spelling.`);
    process.exit(1);
  }
  if (given !== undefined && given.length < 8) {
    console.error('The password must be at least 8 characters.');
    process.exit(1);
  }
  const password = given !== undefined ? given : randomPassword();
  run('UPDATE users SET password_hash = ?, status = ? WHERE id = ?', await hashPassword(password), 'ACTIVE', user.id);
  destroyUserSessions(user.id);

  console.log(`\nPassword reset for ${user.name} (${user.role}, ${user.college_id.toUpperCase()}).`);
  console.log(`  email:        ${email}`);
  console.log(`  new password: ${password}`);
  console.log('\nStart the website again (node server.js) and log in. Change this password after logging in.\n');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
