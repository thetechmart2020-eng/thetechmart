const crypto = require('crypto');
const path = require('path');
const { supabase } = require('./supabase');

// Uploads a file buffer (from multer memoryStorage) to a Supabase Storage bucket
// and returns its public URL. Buckets must already exist and be set to public
// (see supabase/schema.sql / README for the one-time setup steps).
async function uploadBuffer(bucket, file) {
  const filename = `${crypto.randomUUID()}${path.extname(file.originalname || '')}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, { contentType: file.mimetype, upsert: true });
  if (error) throw new Error(`Upload to ${bucket} failed: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

module.exports = { uploadBuffer };
