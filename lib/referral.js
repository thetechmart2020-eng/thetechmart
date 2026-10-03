// Referral rules in one place. A referral is a lead tag only: the referrer is paid BY HAND, and only
// after the sale is confirmed in admin (payment received and cleared) plus a 48 hour wait.
const crypto = require('crypto');

const PAYOUT = 300;            // rand per confirmed sale
const PAYOUT_DELAY_HOURS = 48; // wait after confirmation before the payout is due
const COOKIE_DAYS = 30;

// e.g. "Thandi Mokoena" + 0821234567 -> THANDI-4F2 (same person always gets the same code)
function makeCode(name, phone) {
  const first = String(name || '').trim().split(/\s+/)[0].normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10) || 'FRIEND';
  const tail = parseInt(crypto.createHash('sha1').update(String(phone)).digest('hex').slice(0, 8), 16).toString(36).toUpperCase().slice(0, 3).padEnd(3, '0');
  return `${first}-${tail}`;
}
const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
const digits9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const sameNumber = (a, b) => digits9(a).length === 9 && digits9(a) === digits9(b);
const payableAt = (confirmedAt) => new Date(new Date(confirmedAt).getTime() + PAYOUT_DELAY_HOURS * 3600 * 1000);

module.exports = { PAYOUT, PAYOUT_DELAY_HOURS, COOKIE_DAYS, makeCode, normCode, sameNumber, payableAt };
