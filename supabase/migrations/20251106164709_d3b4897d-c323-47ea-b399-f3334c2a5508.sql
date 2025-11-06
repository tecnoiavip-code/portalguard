-- Criar tabela de veículos separada para suportar múltiplos veículos por morador
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  model TEXT,
  color TEXT,
  tag TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índice para busca rápida por morador
CREATE INDEX IF NOT EXISTS idx_vehicles_resident_id ON public.vehicles(resident_id);

-- RLS para veículos
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view vehicles"
ON public.vehicles FOR SELECT
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Staff can insert vehicles"
ON public.vehicles FOR INSERT
WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "Staff can update vehicles"
ON public.vehicles FOR UPDATE
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Staff can delete vehicles"
ON public.vehicles FOR DELETE
USING (auth.role() = 'authenticated'::text);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_vehicles_updated_at
BEFORE UPDATE ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Criar tabela de configuração Control iD
CREATE TABLE IF NOT EXISTS public.controlid_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_ip TEXT NOT NULL,
  device_port TEXT DEFAULT '80',
  device_id TEXT,
  api_path TEXT DEFAULT '/api/notifications',
  is_active BOOLEAN DEFAULT true,
  last_sync TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS para configuração Control iD
ALTER TABLE public.controlid_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage controlid config"
ON public.controlid_config FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger para atualizar updated_at
CREATE TRIGGER update_controlid_config_updated_at
BEFORE UPDATE ON public.controlid_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Criar tabela de logs recebidos do Control iD
CREATE TABLE IF NOT EXISTS public.controlid_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_controlid_logs_device_id ON public.controlid_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_controlid_logs_event_type ON public.controlid_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_controlid_logs_received_at ON public.controlid_logs(received_at DESC);

-- RLS para logs Control iD
ALTER TABLE public.controlid_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view controlid logs"
ON public.controlid_logs FOR SELECT
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Service role can insert controlid logs"
ON public.controlid_logs FOR INSERT
WITH CHECK (true);

-- Criar tabela de equipes/plantões
CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_members TEXT[] NOT NULL,
  shift_start TIMESTAMP WITH TIME ZONE NOT NULL,
  shift_end TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS para plantões
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view shifts"
ON public.shifts FOR SELECT
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Staff can manage shifts"
ON public.shifts FOR ALL
USING (auth.role() = 'authenticated'::text);

-- Criar tabela de ocorrências
CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  reported_by UUID REFERENCES auth.users(id),
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS para ocorrências
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view incidents"
ON public.incidents FOR SELECT
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Staff can manage incidents"
ON public.incidents FOR ALL
USING (auth.role() = 'authenticated'::text);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_incidents_updated_at
BEFORE UPDATE ON public.incidents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Remover campos de veículo da tabela residents (migrar dados se existirem)
-- Nota: Manter os campos por compatibilidade, mas novos veículos vão para a tabela vehicles