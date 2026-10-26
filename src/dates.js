// Date helpers. Dates are 'YYYY-MM-DD' strings and times are 'HH:MM' strings,
// which sort correctly as plain text.
const config = require('./config');

function nowParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date())) out[p.type] = p.value;
  return out;
}

const todayStr = () => {
  const p = nowParts();
  return `${p.year}-${p.month}-${p.day}`;
};

const nowHM = () => {
  const p = nowParts();
  return `${p.hour}:${p.minute}`;
};

// 0 = Sunday ... 6 = Saturday
const weekday = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

module.exports = { todayStr, nowHM, weekday, addDays, daysBetween };
