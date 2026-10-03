// Input rules shared by every form on the server. The browser applies the same rules
// (public/js/site.js, window.TTM.fv) so people see the problem next to the field,
// and the server checks again because the browser is never trusted.

const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];

// Meetup time slots. Sunday trading ends at 15:00, so the late slot is not offered on Sundays.
const SLOTS = {
  morning: 'Morning (09:00 to 12:00)',
  afternoon: 'Afternoon (12:00 to 15:00)',
  late: 'Late afternoon (15:00 to 17:00)'
};
const MEETUP_NOTICE_DAYS = 2;     // device must reach our sales agent first
const MEETUP_MAX_DAYS = 60;
const MEETUP_FEE = 200;           // special-request surcharge, outside the normal sales process

// Text from people: no control characters, no angle brackets (so nothing can be injected
// into the admin pages), single spaces, capped length.
function clean(v, max = 200) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, max);
}
const oneLine = (v, max = 200) => clean(v, max).replace(/\n+/g, ' ');

// South African number: 10 digits starting with 0, or +27 followed by 9 digits.
// Spaces, dashes and brackets are allowed while typing.
function phone(v) {
  const s = String(v == null ? '' : v).replace(/[\s\-().]/g, '');
  if (/^0\d{9}$/.test(s) || /^\+27\d{9}$/.test(s)) return { ok: true, value: s };
  return { ok: false };
}
function email(v) {
  const s = oneLine(v, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? { ok: true, value: s } : { ok: false };
}
const postal = (v) => (/^\d{4}$/.test(String(v || '').trim()) ? { ok: true, value: String(v).trim() } : { ok: false });

// ---- dates (South African time) ----
function todaySA(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isSunday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay() === 0;

const isWeekend = (iso) => { const d = new Date(iso + 'T00:00:00Z').getUTCDay(); return d === 0 || d === 6; };

// A meetup is on a Saturday or Sunday only, and needs at least 2 days' notice (today and tomorrow are not bookable).
function meetupDate(v, now = new Date()) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s + 'T00:00:00Z').getTime()) || addDays(s, 0) !== s) {
    return { ok: false, error: 'Please choose a meetup date.' };
  }
  const min = addDays(todaySA(now), MEETUP_NOTICE_DAYS), max = addDays(todaySA(now), MEETUP_MAX_DAYS);
  if (s < min) return { ok: false, error: "Meetups need 2 days' notice. Please pick a later date." };
  if (!isWeekend(s)) return { ok: false, error: 'Meetups are on Saturdays and Sundays only. Please pick a weekend date.' };
  if (s > max) return { ok: false, error: 'Please pick a date within the next 60 days.' };
  return { ok: true, value: s };
}
function meetupSlot(v, date) {
  const k = String(v || '');
  if (!SLOTS[k]) return { ok: false, error: 'Please choose a time slot.' };
  if (k === 'late' && date && isSunday(date)) return { ok: false, error: 'On Sundays we trade until 15:00. Please pick the morning or afternoon slot.' };
  return { ok: true, value: k };
}

// Validates the meetup part shared by checkout and the meetup form. Returns { fields } of errors (empty if fine).
function meetupFields(m, now) {
  const errors = {}; m = m || {};
  const area = oneLine(m.area, 80);
  if (area.length < 3) errors.meetupArea = 'Please tell us the area or suburb where you would like to meet.';
  const d = meetupDate(m.date, now); if (!d.ok) errors.meetupDate = d.error;
  const s = meetupSlot(m.slot, d.ok ? d.value : null); if (!s.ok) errors.meetupSlot = s.error;
  return { errors, value: { area, date: d.value, slot: s.value, slotLabel: SLOTS[s.value] } };
}

// Image upload sniffing (first bytes), so a renamed file is not accepted as a photo.
function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

module.exports = { PROVINCES, SLOTS, MEETUP_NOTICE_DAYS, MEETUP_MAX_DAYS, MEETUP_FEE, isWeekend, clean, oneLine, phone, email, postal, todaySA, addDays, meetupDate, meetupSlot, meetupFields, imageKind };
