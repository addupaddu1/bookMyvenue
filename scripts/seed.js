// Creates the starting data: colleges, the TCET venues, one TCET admin and
// a few sample bookers. Safe to run again - it never overwrites existing data.
//
//   node scripts/seed.js
//
// Passwords come from environment variables if you set them, otherwise a random
// one is generated and printed ONCE here (write it down, then change it).
const { one, run, tx } = require('../src/db');
const { hashPassword, randomPassword } = require('../src/auth');

const TCET = 'tcet';

const colleges = [
  {
    id: TCET,
    name: 'Thakur College of Engineering and Technology',
    location: 'Kandivali (East), Mumbai',
    description: 'TCET is the first college on BookMyVenue. Browse its auditorium, halls and seminar rooms and request a booking.',
    status: 'ACTIVE',
  },
  // Placeholder only, to show the college selector. No venues, users or data.
  {
    id: 'coming-soon-1',
    name: 'More colleges coming soon',
    location: '',
    description: 'Another college will appear here once it is onboarded.',
    status: 'COMING_SOON',
  },
];

// SAMPLE details: only the venue names and seat counts are real. Descriptions, facilities,
// rules and locations below are sample text written without knowing TCET's halls - the TCET admin should
// correct these in Admin > Manage Venues. Names and capacities are as given.
const hall = (name, capacity, extra) => ({
  name,
  capacity,
  open_time: '08:00',
  close_time: '18:00',
  open_days: '1,2,3,4,5,6',
  ...extra,
});

const venues = [
  hall('Auditorium', 500, {
    sort_order: 1,
    location: '',
    description:
      'The largest venue on campus, suited to college-wide events, large seminars, annual functions and performances.',
    facilities: ['Stage', 'Sound system', 'Projector & screen', 'Air conditioning', 'Green room', 'Podium & mics'],
    suitable_event_types: ['Cultural event', 'Seminar', 'Guest lecture', 'Competition', 'Orientation'],
    rules:
      'Food and drinks are not allowed inside.\nDecorations must not damage the stage or walls.\nSound and lighting equipment must be operated only by authorised staff.\nThe hall must be left clean and handed back on time.',
  }),
  hall('Multi Purpose Hall', 250, {
    sort_order: 2,
    location: '',
    description:
      'A flexible hall for workshops, department events, competitions and mid-size gatherings with movable seating.',
    facilities: ['Movable seating', 'Projector & screen', 'Sound system', 'Air conditioning', 'Wi-Fi'],
    suitable_event_types: ['Workshop', 'Technical event', 'Competition', 'Cultural event', 'Meeting'],
    rules:
      'Furniture may be rearranged but must be restored after the event.\nFood and drinks are not allowed inside.\nNo tape, nails or stickers on walls.',
  }),
  hall('Convocation Hall', 250, {
    sort_order: 3,
    location: '',
    description: 'A formal hall used for convocations, ceremonies, formal lectures and official gatherings.',
    facilities: ['Stage', 'Podium & mics', 'Projector & screen', 'Sound system', 'Air conditioning'],
    suitable_event_types: ['Guest lecture', 'Seminar', 'Orientation', 'Meeting', 'Other'],
    rules:
      'Reserved for formal and academic events.\nFood and drinks are not allowed inside.\nDress code and protocol of the event should be followed.',
  }),
  ...[1, 2, 3, 4].map((n) =>
    hall(`Seminar Hall ${n} (SH${n})`, 120, {
      sort_order: 3 + n,
      location: '',
      description: `Seminar Hall ${n} suits department seminars, guest talks, presentations and club meetings.`,
      facilities: ['Projector & screen', 'Audio system', 'Whiteboard', 'Air conditioning'],
      suitable_event_types: ['Seminar', 'Workshop', 'Guest lecture', 'Meeting', 'Technical event'],
      rules:
        'Keep the hall clean and switch off lights, AC and projector after use.\nFood is not allowed inside.\nReport any damaged equipment to the administrator.',
    })
  ),
];

const sampleBookers = [
  { name: 'Sample Booker 1', email: 'booker1@tcet.example' },
  { name: 'Sample Booker 2', email: 'booker2@tcet.example' },
];

async function main() {
  const adminEmail = (process.env.TCET_ADMIN_EMAIL || 'admin@tcet.example').toLowerCase();
  const adminPassword = process.env.TCET_ADMIN_PASSWORD || randomPassword();
  const bookerPassword = process.env.TCET_BOOKER_PASSWORD || randomPassword();
  const adminHash = await hashPassword(adminPassword);
  const bookerHash = await hashPassword(bookerPassword);
  const created = { admin: false, bookers: [] };

  tx(() => {
    for (const c of colleges) {
      run(
        `INSERT OR IGNORE INTO colleges (id, name, location, description, status) VALUES (?,?,?,?,?)`,
        c.id, c.name, c.location, c.description, c.status
      );
    }

    for (const v of venues) {
      run(
        `INSERT OR IGNORE INTO venues
           (college_id, name, description, images, location, capacity, facilities,
            suitable_event_types, rules, open_time, close_time, open_days, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        TCET, v.name, v.description, '[]', v.location, v.capacity,
        JSON.stringify(v.facilities), JSON.stringify(v.suitable_event_types),
        v.rules, v.open_time, v.close_time, v.open_days, v.sort_order
      );
    }

    if (!one(`SELECT id FROM users WHERE email = ?`, adminEmail)) {
      run(
        `INSERT INTO users (college_id, name, email, password_hash, role) VALUES (?,?,?,?, 'ADMIN')`,
        TCET, 'TCET Admin', adminEmail, adminHash
      );
      created.admin = true;
    }

    for (const b of sampleBookers) {
      if (!one(`SELECT id FROM users WHERE email = ?`, b.email)) {
        run(
          `INSERT INTO users (college_id, name, email, password_hash, role) VALUES (?,?,?,?, 'BOOKER')`,
          TCET, b.name, b.email, bookerHash
        );
        created.bookers.push(b.email);
      }
    }
  });

  const count = one(`SELECT COUNT(*) AS n FROM venues WHERE college_id = ?`, TCET).n;
  console.log(`\nSeed complete. TCET has ${count} venues.`);
  if (created.admin) {
    console.log('\n  TCET ADMIN LOGIN (shown once - save it, then change it):');
    console.log(`    email:    ${adminEmail}`);
    console.log(`    password: ${adminPassword}`);
  } else {
    console.log('\n  Admin already exists - password unchanged.');
  }
  if (created.bookers.length) {
    console.log('\n  SAMPLE BOOKER LOGINS (replace these with real people in Admin > Authorized Bookers):');
    for (const e of created.bookers) console.log(`    ${e}  /  ${bookerPassword}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
