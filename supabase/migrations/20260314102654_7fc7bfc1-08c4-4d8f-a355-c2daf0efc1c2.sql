-- Create bucket for access photos from Control iD devices
INSERT INTO storage.buckets (id, name, public)
VALUES ('access-photos', 'access-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Allow service role to upload access photos
CREATE POLICY "Service role can upload access photos"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'access-photos'
  AND (current_setting('request.jwt.claim.role', true) = 'service_role')
);

-- Staff can view access photos
CREATE POLICY "Staff can view access photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'access-photos'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
    OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  )
);