// Central settings. Everything here can be overridden with environment variables.
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

module.exports = {
  ROOT,
  DATA_DIR,
  DB_PATH: path.join(DATA_DIR, 'bookmyvenue.db'),
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PORT: process.env.PORT !== undefined ? Number(process.env.PORT) : 3000,
  // Dates and "today" are calculated in this timezone.
  TIMEZONE: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  SESSION_HOURS: 12,
  // Set COOKIE_SECURE=1 when the site is served over https.
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
  MAX_IMAGE_BYTES: 2 * 1024 * 1024,
  MAX_IMAGES_PER_VENUE: 8,
  BOOKING_WINDOW_DAYS: 365,
  EVENT_TYPES: [
    'Seminar',
    'Workshop',
    'Guest lecture',
    'Cultural event',
    'Technical event',
    'Competition',
    'Meeting',
    'Orientation',
    'Other',
  ],
};
