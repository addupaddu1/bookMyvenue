# BookMyVenue

A venue discovery and booking platform for colleges. One platform, many colleges: **each college is its own isolated environment** with its own venues, authorized bookers, bookings and administrator.

TCET (Thakur College of Engineering and Technology) is the first college. Its seven venues are loaded: Auditorium (500), Multi Purpose Hall (250), Convocation Hall (250) and Seminar Halls 1 to 4 (120 each).

## Run it

You need [Node.js](https://nodejs.org) **version 22.5 or newer**. There is nothing else to install.

```bash
node scripts/seed.js     # creates the database, TCET, its venues, an admin and 2 sample bookers
node server.js           # starts the site
```

Open <http://localhost:3000>.

The seed prints the admin and sample booker passwords **once**. Write them down. To choose your own, set `TCET_ADMIN_PASSWORD` and `TCET_BOOKER_PASSWORD` before running the seed. Log in as the admin at `/#/admin/login`, then replace the sample bookers with real people under **Authorized users**.

> The seed's descriptions, facilities and rules are **sample text**. Only the venue names and seat counts are real. Edit them under **Venues** in the admin area, and add real photos there too.

## Who can do what

| | Public visitor | Booker | College admin |
|---|---|---|---|
| Choose a college, browse venues, see availability | yes | yes | yes |
| Send booking requests | no | own college only | no |
| See bookings | no | only their own | all bookings of their college |
| Approve, reject, cancel bookings | no | cancel their own | their college only |
| Manage venues, photos, blocked times | no | no | their college only |
| Create and deactivate bookers | no | no | their college only |

There is **no public sign-up**. Admins create booker accounts. A college has a limit on active bookers (default 10; set `max_bookers` on the college to change it).

## How college isolation works

Never trust the browser. Hiding a button is not security, so every rule is checked on the server:

1. **Role and college come from the login session**, never from the URL or request body. A `collegeId` sent by a user is ignored.
2. **Every lookup includes the user's college.** Anything from another college simply "does not exist" for that user (404).
3. **The database refuses mixed colleges.** A booking can only point to a venue and a user of the *same* college (composite foreign keys), even if the code had a bug.
4. All of this lives in one file, [`src/permissions.js`](src/permissions.js), and is checked by `npm test`.

```
Platform -> College -> Venues / Bookers / Bookings / College admin
```

## Adding another college

No code changes. One command creates the college and its own separate admin:

```bash
node scripts/add-college.js vit "Example Institute of Technology" admin@vit.example "VIT Admin" "Pune"
```

The new college appears in the **Change college** list, and its admin can only manage that college. Booking IDs use the code as a prefix, for example `VIT-2026-0001`.

## Forgot a password?

Bookers can ask their admin to reset it (**Authorized users**, then **Reset password**). If the **admin** is locked out, run this on the computer that hosts the site (stop the site first with Ctrl+C):

```bash
node scripts/reset-password.js admin@tcet.example "MyNewPassword1"
```

Leave off the password to get a random one. After 5 wrong attempts an account is locked for 15 minutes; restarting the site clears that straight away.

## Booking flow

Open BookMyVenue, select a college, explore venues, view details and check availability, log in, fill in the booking form, review the summary, send. The request gets an ID like `TCET-2026-0001` and starts as **Pending**. The college admin approves, rejects or cancels it. The booker tracks the status on their dashboard.

Rules enforced by the server: no past dates, the venue must be open that day and within its bookable hours, participants cannot exceed capacity, and **an approved booking can never overlap another** (back-to-back is fine). Admins can block dates or hours for exams and maintenance.

## Tests

```bash
npm test
```

Runs about 110 checks against a temporary database: a TCET booker and a TCET admin trying to read or change another college's venues, bookings and users, role limits, double booking, login lock-out, uploads, and common web attacks. All must pass.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Where the database and uploaded photos are stored |
| `APP_TIMEZONE` | `Asia/Kolkata` | Timezone used for "today" and booking times |
| `COOKIE_SECURE` | off | Set to `1` when the site is served over https |

## Project layout

```
server.js            web server and security headers
src/permissions.js   the single place that decides who can touch what
src/db.js            database tables (college_id on every record)
src/auth.js          passwords, sessions, login lock-out
src/venues.js        venues, photos, availability
src/bookings.js      requests, approvals, double-booking checks
src/bookers.js       authorized booker accounts
src/api.js           all API routes and which role may use each
public/              the website (HTML, CSS, JavaScript)
scripts/             seed, add-college, tests
```

## Before putting it on the internet

- Serve it over **https** and set `COOKIE_SECURE=1`.
- Back up the `data/` folder (database and photos).
- Change every password from the seed.
- There is no email sending yet, so admins pass new passwords to bookers themselves.
