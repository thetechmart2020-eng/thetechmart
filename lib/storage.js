const crypto = require('crypto');
const path = require('path');
const { supabase } = require('./supabase');

// Uploads a file buffer (from multer memoryStorage) to a Supabase Storage bucket
// and returns its public URL. Buckets must already exist and be set to public
// (see supabase/schema.sql / README for the one-time setup steps).
async function uploadBuffer(bucket, file, filenameOverride) {
  const filename = filenameOverride || `${crypto.randomUUID()}${path.extname(file.originalname || '')}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, {
      contentType: file.mimetype, upsert: true,
      cacheControl: '31536000' // file names are unique, so browsers/CDN can cache for a year
    });
  if (error) throw new Error(`Upload to ${bucket} failed: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

// Product photos come in two sizes, made in the admin page before upload:
//   <id>-1200.webp  main image (max 1200px wide, about 200 KB or less)
//   <id>-480.webp   small version used on product cards
// Only the main URL is stored in the database. The small one is found by name (see thumbOf in server.js).
async function uploadProductPhoto(main, thumb) {
  const id = crypto.randomUUID();
  const ext = main.mimetype === 'image/webp' ? '.webp' : '.jpg';
  const url = await uploadBuffer('product-images', main, `${id}-1200${ext}`);
  if (thumb) await uploadBuffer('product-images', thumb, `${id}-480${ext}`);
  return url;
}

module.exports = { uploadBuffer, uploadProductPhoto };
