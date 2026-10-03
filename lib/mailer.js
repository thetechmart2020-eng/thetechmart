// Email alerts to the owner (new offers, orders, trade-ins, meetups, referrers).
// Uses Gmail with an App Password. Set two environment variables in Vercel:
//   GMAIL_USER          e.g. thetechmart2020@gmail.com
//   GMAIL_APP_PASSWORD  the 16-character app password (NOT the normal Gmail password)
// Optional: ALERT_EMAIL sends the alerts to a different inbox than GMAIL_USER.
// If these are not set, alerts are skipped silently and the site works as before.
const nodemailer = require('nodemailer');

const outbox = [];   // filled only when MAIL_DRY_RUN=1 (used for testing)
let tx = null;

function configured() { return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || process.env.MAIL_DRY_RUN === '1'; }

function transport() {
  if (!tx) tx = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  return tx;
}

// Never throws and never holds the customer up for long: a failed alert must not break an order.
async function notify(subject, text) {
  if (!configured()) return false;
  const to = process.env.ALERT_EMAIL || process.env.GMAIL_USER || 'thetechmart2020@gmail.com';
  if (process.env.MAIL_DRY_RUN === '1') { outbox.push({ to, subject, text }); return true; }
  try {
    await Promise.race([
      transport().sendMail({ from: `TheTechMart site <${process.env.GMAIL_USER}>`, to, subject: `[TheTechMart] ${subject}`, text }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('mail timeout')), 6000))
    ]);
    return true;
  } catch (err) {
    console.error('[mail] alert not sent:', err.message);
    return false;
  }
}

module.exports = { notify, outbox, configured };
