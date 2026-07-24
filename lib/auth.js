// Stateless admin auth via a signed cookie — no session store needed, which matters
// because serverless functions (Vercel) don't share memory between invocations, so
// express-session's default MemoryStore would silently log people out at random.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const COOKIE_NAME = 'admin_token';
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

function sign(value) {
  const payload = `${value}.${Date.now() + MAX_AGE_MS}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [value, expiry, sig] = parts;
  const payload = `${value}.${expiry}`;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  if (Date.now() > Number(expiry)) return false;
  return value === 'admin';
}

function setAdminCookie(res) {
  res.cookie(COOKIE_NAME, sign('admin'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_MS
  });
}

function clearAdminCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function isAdminRequest(req) {
  return verify(req.cookies && req.cookies[COOKIE_NAME]);
}

module.exports = { setAdminCookie, clearAdminCookie, isAdminRequest };
