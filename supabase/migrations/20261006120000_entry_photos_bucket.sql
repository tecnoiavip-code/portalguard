-- Bucket para as fotos das entradas de visitantes.
-- A coluna access_entries.photo_url passa a guardar apenas o caminho neste
-- bucket: o base64 ficava na linha e estourava a cota de 500 MB do banco
-- no plano gratuito (foto de celular ~5 MB por registro, +33% em base64).
--
-- Nao reutiliza o bucket resident-photos: a policy de upload de la cobre apenas
-- admin/receptionist, e a RPC redeem_guest_pass tambem aceita security_guard.

INSERT INTO storage.buckets (id, name, public) VALUES ('entry-photos', 'entry-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Espelha o RLS de public.access_entries: qualquer usuario autenticado.
DROP POLICY IF EXISTS "Staff can upload entry photos" ON storage.objects;
CREATE POLICY "Staff can upload entry photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'entry-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Staff can view entry photos" ON storage.objects;
CREATE POLICY "Staff can view entry photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'entry-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Staff can update entry photos" ON storage.objects;
CREATE POLICY "Staff can update entry photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'entry-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Staff can delete entry photos" ON storage.objects;
CREATE POLICY "Staff can delete entry photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'entry-photos' AND auth.role() = 'authenticated');
