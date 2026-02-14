-- Create storage bucket for mail photos
INSERT INTO storage.buckets (id, name, public) VALUES ('mail-photos', 'mail-photos', true);

-- Allow authenticated users to upload mail photos
CREATE POLICY "Staff can upload mail photos" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'mail-photos' AND (auth.role() = 'authenticated'));

-- Public read access for mail photos
CREATE POLICY "Anyone can view mail photos" ON storage.objects
FOR SELECT USING (bucket_id = 'mail-photos');

-- Staff can delete mail photos
CREATE POLICY "Staff can delete mail photos" ON storage.objects
FOR DELETE USING (bucket_id = 'mail-photos' AND (auth.role() = 'authenticated'));