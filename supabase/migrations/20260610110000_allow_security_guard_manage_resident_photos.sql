INSERT INTO storage.buckets (id, name, public)
VALUES ('resident-photos', 'resident-photos', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

DROP POLICY IF EXISTS "Staff can upload resident photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can view resident photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update resident photos" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete resident photos" ON storage.objects;

CREATE POLICY "Staff can upload resident photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'resident-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'receptionist'::app_role)
    OR has_role(auth.uid(), 'security_guard'::app_role)
  )
);

CREATE POLICY "Staff can view resident photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'resident-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'receptionist'::app_role)
    OR has_role(auth.uid(), 'security_guard'::app_role)
    OR has_role(auth.uid(), 'resident'::app_role)
  )
);

CREATE POLICY "Staff can update resident photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'resident-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'receptionist'::app_role)
    OR has_role(auth.uid(), 'security_guard'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'resident-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'receptionist'::app_role)
    OR has_role(auth.uid(), 'security_guard'::app_role)
  )
);

CREATE POLICY "Staff can delete resident photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'resident-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'receptionist'::app_role)
    OR has_role(auth.uid(), 'security_guard'::app_role)
  )
);
