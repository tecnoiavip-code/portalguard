
-- Make buckets private
UPDATE storage.buckets SET public = false WHERE id IN ('announcement-files', 'mail-photos');

-- Drop old public SELECT policies
DROP POLICY IF EXISTS "Anyone can view announcement files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view mail photos" ON storage.objects;

-- Create authenticated SELECT policies for announcement-files
CREATE POLICY "Authenticated users can view announcement files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'announcement-files' 
  AND auth.role() = 'authenticated'
);

-- Create authenticated SELECT policies for mail-photos (staff + resident who owns the mail)
CREATE POLICY "Authenticated users can view mail photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'mail-photos' 
  AND auth.role() = 'authenticated'
);
