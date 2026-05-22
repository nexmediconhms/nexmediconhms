-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  BUG #3 FIX — "Storage unavailable (row-level security policy)"   ║
-- ║                                                                    ║
-- ║  INSTRUCTIONS:                                                     ║
-- ║  1. Go to your Supabase project dashboard                         ║
-- ║  2. Click "SQL Editor" in the left sidebar                        ║
-- ║  3. Click "New query"                                              ║
-- ║  4. Copy ALL the code below and paste it in the editor            ║
-- ║  5. Click "Run" (or press Ctrl+Enter)                             ║
-- ║  6. You should see "Success" message                              ║
-- ║                                                                    ║
-- ║  WHY THIS IS NEEDED:                                               ║
-- ║  Your Supabase Storage bucket has Row Level Security (RLS) enabled ║
-- ║  but there's no INSERT policy — so every file upload fails.        ║
-- ║  The app falls back to storing files in the database (max 2 MB).   ║
-- ║  After this fix, files will upload properly to Storage (up to 50MB)║
-- ║                                                                    ║
-- ║  IMPACT AFTER FIX:                                                 ║
-- ║  ✅ No more "Storage unavailable" error message                    ║
-- ║  ✅ Photos and PDFs upload correctly (up to 50 MB)                 ║
-- ║  ✅ File attachments work properly for consultations               ║
-- ║  ✅ X-ray images, ultrasound reports etc. can be stored properly   ║
-- ╚══════════════════════════════════════════════════════════════════════╝


-- ─────────────────────────────────────────────────────
-- STEP 1: Check your bucket name
-- ─────────────────────────────────────────────────────
-- First, let's see what buckets you have:
SELECT id, name, public FROM storage.buckets;

-- ⚠️ IMPORTANT: Look at the results above.
-- If your bucket is named something OTHER than 'consultation-attachments',
-- replace 'consultation-attachments' with YOUR bucket name in ALL the
-- statements below.


-- ─────────────────────────────────────────────────────
-- STEP 2: Create the bucket if it doesn't exist
-- ─────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'consultation-attachments',          -- bucket ID
  'consultation-attachments',          -- display name
  false,                               -- NOT public (only logged-in users)
  52428800,                            -- 50 MB max file size
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ─────────────────────────────────────────────────────
-- STEP 3: Drop any old/broken policies
-- ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated users can upload"        ON storage.objects;
DROP POLICY IF EXISTS "authenticated users can read"          ON storage.objects;
DROP POLICY IF EXISTS "authenticated users can delete"        ON storage.objects;
DROP POLICY IF EXISTS "authenticated can upload to consultation-attachments"  ON storage.objects;
DROP POLICY IF EXISTS "authenticated can read consultation-attachments"       ON storage.objects;
DROP POLICY IF EXISTS "authenticated can delete own attachments"              ON storage.objects;


-- ─────────────────────────────────────────────────────
-- STEP 4: Create correct RLS policies
-- ─────────────────────────────────────────────────────

-- Allow logged-in users to UPLOAD files to this bucket
CREATE POLICY "authenticated can upload to consultation-attachments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'consultation-attachments');

-- Allow logged-in users to VIEW/DOWNLOAD files from this bucket
CREATE POLICY "authenticated can read consultation-attachments"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'consultation-attachments');

-- Allow logged-in users to DELETE files from this bucket
CREATE POLICY "authenticated can delete own attachments"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'consultation-attachments');

-- Allow logged-in users to UPDATE files (needed for overwrites)
CREATE POLICY "authenticated can update consultation-attachments"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'consultation-attachments');


-- ─────────────────────────────────────────────────────
-- DONE! Verify it worked:
-- ─────────────────────────────────────────────────────
SELECT
  policyname,
  cmd AS operation,
  permissive
FROM pg_policies
WHERE tablename = 'objects' AND schemaname = 'storage'
ORDER BY policyname;

-- You should see 4 policies listed for consultation-attachments.
-- Now go back to the app and try uploading a photo — it should work!
