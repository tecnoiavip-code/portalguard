
-- Tabela de equipamentos cadastrados da portaria
CREATE TABLE public.portaria_equipment (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

ALTER TABLE public.portaria_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view equipment" ON public.portaria_equipment
  FOR SELECT USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'security_guard'::app_role) OR 
    has_role(auth.uid(), 'receptionist'::app_role)
  );

CREATE POLICY "Admins can manage equipment" ON public.portaria_equipment
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Tabela de checklist de equipamentos por plantão
CREATE TABLE public.shift_equipment_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES public.portaria_equipment(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'functional',
  notes TEXT,
  checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  checked_by UUID
);

ALTER TABLE public.shift_equipment_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view checks" ON public.shift_equipment_checks
  FOR SELECT USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'security_guard'::app_role) OR 
    has_role(auth.uid(), 'receptionist'::app_role)
  );

CREATE POLICY "Staff can insert checks" ON public.shift_equipment_checks
  FOR INSERT WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'security_guard'::app_role) OR 
    has_role(auth.uid(), 'receptionist'::app_role)
  );

CREATE POLICY "Staff can update checks" ON public.shift_equipment_checks
  FOR UPDATE USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'security_guard'::app_role) OR 
    has_role(auth.uid(), 'receptionist'::app_role)
  );

-- Adicionar tipo de plantão e shift_id de referência nos incidents
ALTER TABLE public.shifts ADD COLUMN shift_type TEXT NOT NULL DEFAULT 'diurno';

-- Adicionar referência ao plantão nas ocorrências
ALTER TABLE public.incidents ADD COLUMN shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL;
