/*
 * Icecat image enrichment — fills the imageUrl column of a price-list CSV by
 * looking up each brand+model against Icecat's Open Catalog.
 *
 * STATUS: first pass, not yet verified against a live Icecat account (needs
 * real credentials to test). Run the --test flag first on a handful of rows,
 * inspect scripts/icecat-raw-sample.json, and we'll adjust the parsing
 * together based on what your account actually returns — Icecat's exact
 * response shape can vary by plan/account, so treat this as a starting point.
 *
 * Setup:
 *   1. npm install (adds node-fetch if needed — Node 18+ has fetch built in,
 *      so this may not be necessary; try without it first)
 *   2. Set two env vars before running:
 *        ICECAT_USERNAME=your-icecat-username
 *        ICECAT_PASSWORD=your-icecat-password
 *   3. Run a small test batch first:
 *        node scripts/enrich-images.js thetechmart-full-pricelist.csv --test 5
 *   4. Check the console output and scripts/icecat-raw-sample.json, then share
 *      that JSON back so we can tune the matching logic.
 *   5. Once it's working well, run the full file:
 *        node scripts/enrich-images.js thetechmart-full-pricelist.csv
 *      This writes a new file: thetechmart-full-pricelist.enriched.csv
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const ICECAT_USERNAME = process.env.ICECAT_USERNAME;
const ICECAT_PASSWORD = process.env.ICECAT_PASSWORD;

if (!ICECAT_USERNAME || !ICECAT_PASSWORD) {
  console.error('Set ICECAT_USERNAME and ICECAT_PASSWORD environment variables first.');
  console.error('Example: ICECAT_USERNAME=you ICECAT_PASSWORD=pw node scripts/enrich-images.js file.csv --test 5');
  process.exit(1);
}

const args = process.argv.slice(2);
const inputFile = args[0];
const testIdx = args.indexOf('--test');
const testLimit = testIdx !== -1 ? Number(args[testIdx + 1] || 5) : null;

if (!inputFile) {
  console.error('Usage: node scripts/enrich-images.js <input.csv> [--test N]');
  process.exit(1);
}

// Icecat's classic lookup: query by brand + free-text product name.
// NOTE: Icecat is really built around exact GTIN/MPN matching — this
// brand+name query is Icecat's more lenient search mode, but matches on
// generic names (e.g. "Galaxy S23" with no storage/color) may return the
// wrong variant, or nothing. Inspect results before trusting them.
async function lookupIcecat(brand, model) {
  const url = `https://data.icecat.biz/xml_s3/xml_server3.cgi?lang=en&shopname=openIcecat-live&brand=${encodeURIComponent(brand)}&prod=${encodeURIComponent(model)}`;
  const auth = Buffer.from(`${ICECAT_USERNAME}:${ICECAT_PASSWORD}`).toString('base64');

  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const text = await res.text();

  if (!res.ok) {
    return { ok: false, status: res.status, raw: text };
  }

  // Best-effort extraction — Icecat XML typically carries a main image in a
  // "HighPic" attribute on the <Product> or <ProductGallery> node. This is a
  // simple regex pass rather than a full XML parse, deliberately, so it's
  // easy to see exactly what matched (or didn't) while we tune it.
  const highPicMatch = text.match(/HighPic="([^"]+)"/);
  const picMatch = text.match(/<Pic[^>]*>([^<]+)<\/Pic>/) || text.match(/Pic="([^"]+)"/);
  const imageUrl = (highPicMatch && highPicMatch[1]) || (picMatch && picMatch[1]) || null;

  return { ok: true, imageUrl, raw: text };
}

async function main() {
  const content = fs.readFileSync(inputFile, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true });
  const target = testLimit ? rows.slice(0, testLimit) : rows;

  console.log(`Looking up ${target.length} of ${rows.length} rows...`);
  let matched = 0;
  const samples = [];

  for (const row of target) {
    if (row.imageUrl && row.imageUrl.trim()) continue; // don't overwrite existing photos
    try {
      const result = await lookupIcecat(row.brand, row.model);
      if (samples.length < 3) samples.push({ brand: row.brand, model: row.model, result });

      if (result.ok && result.imageUrl) {
        row.imageUrl = result.imageUrl;
        matched++;
        console.log(`✓ ${row.brand} ${row.model} -> ${result.imageUrl}`);
      } else {
        console.log(`✗ ${row.brand} ${row.model} -> no match (status ${result.status || 200})`);
      }
    } catch (err) {
      console.log(`✗ ${row.brand} ${row.model} -> error: ${err.message}`);
    }
    // Be polite to Icecat's API — small delay between requests.
    await new Promise((r) => setTimeout(r, 300));
  }

  fs.writeFileSync(
    path.join(__dirname, 'icecat-raw-sample.json'),
    JSON.stringify(samples, null, 2)
  );

  const outFile = inputFile.replace(/\.csv$/, '.enriched.csv');
  fs.writeFileSync(outFile, stringify(rows, { header: true }));

  console.log(`\nMatched ${matched} of ${target.length} looked up.`);
  console.log(`Sample raw responses saved to scripts/icecat-raw-sample.json — share this back for tuning.`);
  console.log(`Output written to ${outFile}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
