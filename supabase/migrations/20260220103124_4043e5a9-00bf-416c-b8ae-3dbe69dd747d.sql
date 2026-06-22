
-- Create storage bucket for resident photos
INSERT INTO storage.buckets (id, name, public) VALUES ('resident-photos', 'resident-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload their own photos (staff only)
CREATE POLICY "Staff can upload resident photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'resident-photos' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role))
);

-- Staff can view resident photos
CREATE POLICY "Staff can view resident photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'resident-photos' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role) OR has_role(auth.uid(), 'resident'::app_role))
);

-- Staff can update resident photos
CREATE POLICY "Staff can update resident photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'resident-photos' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role))
);

-- Staff can delete resident photos
CREATE POLICY "Staff can delete resident photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'resident-photos' AND
  (has_role(auth.uid(), 'admin'::app_role))
);
