-- Adicionar campos faltantes na tabela residents
ALTER TABLE public.residents
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Adicionar campos faltantes na tabela access_entries
ALTER TABLE public.access_entries
ADD COLUMN IF NOT EXISTS resident_name text;

ALTER TABLE public.access_entries
ADD COLUMN IF NOT EXISTS notes text;

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_residents_apartment ON public.residents(apartment);
CREATE INDEX IF NOT EXISTS idx_residents_cpf ON public.residents(cpf);
CREATE INDEX IF NOT EXISTS idx_access_entries_resident_id ON public.access_entries(resident_id);
CREATE INDEX IF NOT EXISTS idx_access_entries_entry_time ON public.access_entries(entry_time);
CREATE INDEX IF NOT EXISTS idx_mails_resident_id ON public.mails(resident_id);
CREATE INDEX IF NOT EXISTS idx_mails_status ON public.mails(status);

-- Criar tabela para eventos em tempo real
CREATE TABLE IF NOT EXISTS public.realtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('entry', 'exit', 'mail', 'alert', 'device')),
  description text NOT NULL,
  timestamp timestamp with time zone DEFAULT now(),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  related_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now()
);

-- Habilitar RLS na tabela de eventos
ALTER TABLE public.realtime_events ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para eventos
CREATE POLICY "Authenticated users can view events"
  ON public.realtime_events FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert events"
  ON public.realtime_events FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Criar índice para eventos
CREATE INDEX IF NOT EXISTS idx_realtime_events_timestamp ON public.realtime_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_events_type ON public.realtime_events(type);

-- Adicionar trigger para atualizar updated_at em residents
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_residents_updated_at
  BEFORE UPDATE ON public.residents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();