-- Melhorias do Livro de Ocorrências (Relatórios):
-- 1) Foto de comprovação na ocorrência
-- 2) Vínculo opcional com apartamento/morador
-- 3) Termo de recebimento de turno ("Ciente e Recebido")

ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS photo_url text DEFAULT NULL;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS apartment text DEFAULT NULL;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS resident_id uuid DEFAULT NULL REFERENCES public.residents(id) ON DELETE SET NULL;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS resident_name text DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.shift_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  received_by text NOT NULL,
  notes text,
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shift_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view shift acknowledgments" ON public.shift_acknowledgments
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'security_guard'::app_role) OR
  has_role(auth.uid(), 'receptionist'::app_role)
);

CREATE POLICY "Staff can insert shift acknowledgments" ON public.shift_acknowledgments
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'security_guard'::app_role)
);