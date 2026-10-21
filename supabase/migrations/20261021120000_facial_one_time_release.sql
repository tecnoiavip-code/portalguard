-- Liberação facial de uso único para cadastros do Novo Cadastro.
-- A portaria autoriza cada nova entrada; o leitor serve para entrada e saída.
-- O vínculo é feito pelo documento/nome que o equipamento envia (event 7).

ALTER TABLE public.access_entries
  ADD COLUMN IF NOT EXISTS entry_scan_at TIMESTAMPTZ;

-- O Novo Cadastro também registra entregadores.
ALTER TABLE public.access_entries
  DROP CONSTRAINT IF EXISTS access_entries_visitor_type_check;
ALTER TABLE public.access_entries
  ADD CONSTRAINT access_entries_visitor_type_check
  CHECK (visitor_type IN ('visitor', 'service_provider', 'delivery'));

CREATE TABLE IF NOT EXISTS public.facial_release_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT,
  subject_key TEXT NOT NULL,
  visitor_name TEXT NOT NULL,
  visitor_document TEXT,
  visitor_type TEXT DEFAULT 'visitor',
  apartment TEXT,
  resident_id UUID REFERENCES public.residents(id) ON DELETE SET NULL,
  resident_name TEXT,
  photo_url TEXT,
  company TEXT,
  vehicle_plate TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  purpose TEXT,
  badge_number TEXT,
  match_source TEXT NOT NULL DEFAULT 'device',
  match_distance DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entry_id UUID REFERENCES public.access_entries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_facial_release_status
  ON public.facial_release_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_facial_release_subject
  ON public.facial_release_requests (subject_key, status);

-- Uma leitura dupla no mesmo instante não pode criar dois pedidos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_facial_release_pending_subject
  ON public.facial_release_requests (subject_key)
  WHERE status = 'pending';

ALTER TABLE public.facial_release_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view facial release requests" ON public.facial_release_requests;
CREATE POLICY "Staff can view facial release requests"
  ON public.facial_release_requests FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
    OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  );

-- A escrita é feita pela edge function (service role). Negamos escrita direta.
DROP POLICY IF EXISTS "Staff cannot write facial release requests" ON public.facial_release_requests;
CREATE POLICY "Staff cannot write facial release requests"
  ON public.facial_release_requests FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
