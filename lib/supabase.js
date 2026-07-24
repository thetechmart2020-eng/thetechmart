// Server-side Supabase client. Uses the SERVICE ROLE key, which bypasses row-level
// security — that's intentional here (all Supabase access happens in this backend,
// never in the browser), but it means this key must only ever live in server
// environment variables (Vercel project settings / your local .env), never in
// anything shipped to the client.
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.warn(
    '[supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY are not set. ' +
    'Copy .env.example to .env and fill them in (see README).'
  );
}

const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder-key', {
  auth: { persistSession: false }
});

module.exports = { supabase };
