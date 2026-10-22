-- Evita duplicar a foto (potencialmente base64) dentro do pedido facial.
-- O pedido referencia a entrada de origem e a listagem resolve a foto sob demanda.
ALTER TABLE public.facial_release_requests
  ADD COLUMN IF NOT EXISTS photo_entry_id UUID REFERENCES public.access_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_facial_release_photo_entry
  ON public.facial_release_requests (photo_entry_id);
