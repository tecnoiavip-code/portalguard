-- ============================================================================
-- Descritores faciais dos moradores (reconhecimento facial na nuvem)
-- - descriptor: vetor de 128 floats (modelo face_recognition_model do face-api,
--   mesma versao usada pelo app local para descritores compativeis).
-- - Populado pela edge function controlid-webhook a partir das fotos no bucket
--   resident-photos (resident-photos/<resident_id>/photo.<ext>).
-- - photo_mtime: metadado da foto (updated_at do Storage) para nao recalcular
--   o descritor sem necessidade.
-- - Acesso somente via service role (edge function); nenhuma policy de usuario
--   final e criada de proposito.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.resident_face_descriptors (
  resident_id uuid PRIMARY KEY REFERENCES public.residents(id) ON DELETE CASCADE,
  descriptor jsonb NOT NULL,
  photo_path text,
  photo_mtime text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.resident_face_descriptors ENABLE ROW LEVEL SECURITY;
