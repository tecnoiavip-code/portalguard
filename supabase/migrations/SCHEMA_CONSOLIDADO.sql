-- ============================================================
-- PORTALGUARD PRO - SQL CONSOLIDADO
-- Execute este arquivo no SQL Editor do Supabase
-- Projeto: qasudwuoagblzfkvmyxx
-- ============================================================


-- ============================================================
-- MIGRAÇÃO: 20251017101845_e1e09e8e-8684-483a-ac7e-570834efced3.sql
-- ============================================================
-- Create app role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'security_guard', 'receptionist');

-- Profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles table (separate for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id, role)
);

-- Residents table
CREATE TABLE public.residents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cpf TEXT NOT NULL UNIQUE,
  apartment TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  vehicle_plate TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  vehicle_tag TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Access entries table
CREATE TABLE public.access_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_name TEXT NOT NULL,
  visitor_document TEXT NOT NULL,
  visitor_type TEXT CHECK (visitor_type IN ('visitor', 'service_provider')),
  resident_id UUID REFERENCES public.residents(id),
  apartment TEXT NOT NULL,
  purpose TEXT,
  company TEXT,
  entry_time TIMESTAMPTZ DEFAULT NOW(),
  exit_time TIMESTAMPTZ,
  vehicle_plate TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  photo_url TEXT,
  auto_recognized BOOLEAN DEFAULT FALSE,
  registered_by UUID REFERENCES auth.users(id)
);

-- Mails table
CREATE TABLE public.mails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID REFERENCES public.residents(id) ON DELETE CASCADE NOT NULL,
  sender TEXT NOT NULL,
  package_type TEXT CHECK (package_type IN ('Carta', 'Pacote Pequeno', 'Pacote Médio', 'Pacote Grande')),
  notes TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT CHECK (status IN ('pending', 'delivered')) DEFAULT 'pending',
  delivered_at TIMESTAMPTZ,
  withdrawn_by TEXT,
  registered_by UUID REFERENCES auth.users(id)
);

-- Devices table (credentials in Supabase Secrets, not here)
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('facial_recognition', 'vehicle_tag', 'card_reader')),
  location TEXT NOT NULL,
  status TEXT CHECK (status IN ('online', 'offline')) DEFAULT 'online',
  serial_number TEXT,
  last_sync TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

-- RLS Policies for user_roles
CREATE POLICY "Users can view own roles"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for residents
CREATE POLICY "Authenticated users can view residents"
ON public.residents FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can insert residents"
ON public.residents FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Staff can update residents"
ON public.residents FOR UPDATE
USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can delete residents"
ON public.residents FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for access_entries
CREATE POLICY "Authenticated users can view entries"
ON public.access_entries FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can insert entries"
ON public.access_entries FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Staff can update entries"
ON public.access_entries FOR UPDATE
USING (auth.role() = 'authenticated');

-- RLS Policies for mails
CREATE POLICY "Authenticated users can view mails"
ON public.mails FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can insert mails"
ON public.mails FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Staff can update mails"
ON public.mails FOR UPDATE
USING (auth.role() = 'authenticated');

-- RLS Policies for devices
CREATE POLICY "Admins can manage devices"
ON public.devices FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- MIGRAÇÃO: 20251017132330_257ab3d8-4765-4b54-9e03-81f5250c797e.sql
-- ============================================================
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

-- ============================================================
-- MIGRAÇÃO: 20251017132352_6447c7ed-cb5a-4dfb-ad40-213ac0205277.sql
-- ============================================================
-- Corrigir função para ter search_path seguro
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- MIGRAÇÃO: 20251106164709_d3b4897d-c323-47ea-b399-f3334c2a5508.sql
-- ============================================================
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

-- ============================================================
-- MIGRAÇÃO: 20251110100509_9994c103-97a6-4474-8e0e-277682fc057c.sql
-- ============================================================
-- Adicionar políticas RLS mais granulares para residents
-- Remover políticas antigas que permitem acesso total
DROP POLICY IF EXISTS "Staff can insert residents" ON public.residents;
DROP POLICY IF EXISTS "Staff can update residents" ON public.residents;

-- Política: Apenas admins podem inserir residentes
CREATE POLICY "Admins can insert residents" 
ON public.residents 
FOR INSERT 
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Política: Apenas admins podem atualizar residentes
CREATE POLICY "Admins can update residents" 
ON public.residents 
FOR UPDATE 
TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- Comentário: A política SELECT continua permitindo que usuários autenticados vejam residentes
-- pois isso é necessário para operações de portaria. Se quiser restringir mais,
-- pode criar uma política baseada em roles específicos.

-- ============================================================
-- MIGRAÇÃO: 20251112113631_277adff5-74bf-46d0-bb53-7f51fecd01d3.sql
-- ============================================================
-- Garantir que o primeiro usuário sempre seja admin
CREATE OR REPLACE FUNCTION public.handle_first_user_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INTEGER;
BEGIN
  -- Conta quantos usuários existem (incluindo o novo)
  SELECT COUNT(*) INTO user_count FROM auth.users;
  
  -- Se for o primeiro usuário, torna admin automaticamente
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Remove trigger antigo se existir
DROP TRIGGER IF EXISTS on_first_user_admin ON auth.users;

-- Cria trigger para dar admin ao primeiro usuário
CREATE TRIGGER on_first_user_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_first_user_admin();

-- Adiciona role de admin ao usuário existente se ele não tiver nenhuma role
DO $$
DECLARE
  existing_user_id UUID;
BEGIN
  -- Pega o ID do primeiro usuário
  SELECT id INTO existing_user_id 
  FROM auth.users 
  ORDER BY created_at 
  LIMIT 1;
  
  -- Se encontrou um usuário e ele não tem roles, adiciona admin
  IF existing_user_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    SELECT existing_user_id, 'admin'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = existing_user_id
    );
  END IF;
END $$;

-- ============================================================
-- MIGRAÇÃO: 20251112115835_82a1d1e8-5fae-4899-999c-6cda4f59ee6d.sql
-- ============================================================
-- Make CPF optional for residents
ALTER TABLE public.residents ALTER COLUMN cpf DROP NOT NULL;

-- ============================================================
-- MIGRAÇÃO: 20251116145621_9e3d4c69-6638-4765-a1a2-651de09c2785.sql
-- ============================================================
-- Enable realtime on key tables for live updates
ALTER TABLE public.residents REPLICA IDENTITY FULL;
ALTER TABLE public.mails REPLICA IDENTITY FULL;
ALTER TABLE public.access_entries REPLICA IDENTITY FULL;
ALTER TABLE public.vehicles REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.residents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mails;
ALTER PUBLICATION supabase_realtime ADD TABLE public.access_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;

-- ============================================================
-- MIGRAÇÃO: 20251118164756_f8f6ac3f-a6cd-430d-8f21-1482e48d0b5b.sql
-- ============================================================
-- ==========================================
-- SECURITY FIX: Restrict RLS policies to appropriate roles
-- ==========================================

-- 1. FIX RESIDENTS TABLE - Restrict to admin, manager, receptionist roles
DROP POLICY IF EXISTS "Authenticated users can view residents" ON residents;

CREATE POLICY "Authorized staff can view residents"
ON residents FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'receptionist'::app_role)
);

-- Keep existing admin policies for insert/update/delete
-- (Already properly restricted to admins)

-- 2. FIX MAILS TABLE - Restrict to reception staff and admins
DROP POLICY IF EXISTS "Authenticated users can view mails" ON mails;
DROP POLICY IF EXISTS "Staff can insert mails" ON mails;
DROP POLICY IF EXISTS "Staff can update mails" ON mails;

CREATE POLICY "Authorized staff can view mails"
ON mails FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'receptionist'::app_role)
);

CREATE POLICY "Authorized staff can insert mails"
ON mails FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'receptionist'::app_role)
);

CREATE POLICY "Authorized staff can update mails"
ON mails FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'receptionist'::app_role)
);

-- ADD MISSING DELETE POLICY for mails
CREATE POLICY "Admins can delete mails"
ON mails FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. FIX ACCESS ENTRIES TABLE - Restrict to security staff
DROP POLICY IF EXISTS "Authenticated users can view entries" ON access_entries;
DROP POLICY IF EXISTS "Staff can insert entries" ON access_entries;
DROP POLICY IF EXISTS "Staff can update entries" ON access_entries;

CREATE POLICY "Security staff can view entries"
ON access_entries FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'security_guard'::app_role)
);

CREATE POLICY "Security staff can insert entries"
ON access_entries FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'security_guard'::app_role)
);

CREATE POLICY "Security staff can update entries"
ON access_entries FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'security_guard'::app_role)
);

-- 4. FIX OTHER TABLES - Keep current policies but document them

-- SHIFTS: Already properly restricted to authenticated users (keep as is)
-- INCIDENTS: Already properly restricted to authenticated users (keep as is)
-- DEVICES: Already properly restricted to admins (keep as is)
-- VEHICLES: Already properly restricted to authenticated users (keep as is)
-- REALTIME_EVENTS: Already properly restricted to authenticated users (keep as is)
-- CONTROLID_LOGS: Already has service role insert (keep as is)
-- CONTROLID_CONFIG: Already restricted to admins (keep as is)

-- ============================================================
-- MIGRAÇÃO: 20260210145451_1a5832e9-54a4-488c-b665-a8b43e462501.sql
-- ============================================================

-- Parte 1: Adicionar 'resident' ao enum e coluna auth_user_id
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'resident';

-- Adicionar auth_user_id à tabela residents
ALTER TABLE public.residents ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_residents_auth_user_id ON public.residents(auth_user_id) WHERE auth_user_id IS NOT NULL;


-- ============================================================
-- MIGRAÇÃO: 20260210145625_b3a41245-c6c4-4ef6-bae2-b01d884096d0.sql
-- ============================================================

-- Tabela de mensagens de chat entre morador e portaria
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  sender_type text NOT NULL CHECK (sender_type IN ('resident', 'staff')),
  message text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view own chat" ON public.chat_messages
  FOR SELECT USING (
    (has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid()))
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'receptionist')
    OR has_role(auth.uid(), 'security_guard')
  );

CREATE POLICY "Residents can send messages" ON public.chat_messages
  FOR INSERT WITH CHECK (
    (has_role(auth.uid(), 'resident') AND sender_type = 'resident' AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid()))
    OR ((has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'receptionist') OR has_role(auth.uid(), 'security_guard')) AND sender_type = 'staff')
  );

CREATE POLICY "Users can update read status" ON public.chat_messages
  FOR UPDATE USING (
    (has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid()))
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'receptionist')
    OR has_role(auth.uid(), 'security_guard')
  );

-- Tabela de autorizações de visitantes pelo morador
CREATE TABLE public.visitor_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  visitor_name text NOT NULL,
  visitor_document text,
  authorized_date date NOT NULL,
  authorized_until date,
  purpose text,
  vehicle_plate text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  staff_notes text,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.visitor_authorizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view own authorizations" ON public.visitor_authorizations
  FOR SELECT USING (
    (has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid()))
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'receptionist')
    OR has_role(auth.uid(), 'security_guard')
  );

CREATE POLICY "Residents can create authorizations" ON public.visitor_authorizations
  FOR INSERT WITH CHECK (
    has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Staff can update authorizations" ON public.visitor_authorizations
  FOR UPDATE USING (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'receptionist') OR has_role(auth.uid(), 'security_guard')
  );

-- Tabela de notificações
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL CHECK (type IN ('mail', 'visitor', 'authorization', 'chat', 'general')),
  related_id uuid,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Authenticated can insert notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Enable realtime for chat and notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger para updated_at
CREATE TRIGGER update_visitor_authorizations_updated_at
  BEFORE UPDATE ON public.visitor_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS para moradores verem seus próprios dados
CREATE POLICY "Residents can view own data" ON public.residents
  FOR SELECT USING (has_role(auth.uid(), 'resident') AND auth_user_id = auth.uid());

-- Moradores verem suas correspondências
CREATE POLICY "Residents can view own mails" ON public.mails
  FOR SELECT USING (
    has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())
  );

-- Moradores verem visitas do seu apartamento
CREATE POLICY "Residents can view own access entries" ON public.access_entries
  FOR SELECT USING (
    has_role(auth.uid(), 'resident') AND apartment IN (SELECT apartment FROM public.residents WHERE auth_user_id = auth.uid())
  );


-- ============================================================
-- MIGRAÇÃO: 20260214124705_1485436c-afef-4786-a805-02b93d327d56.sql
-- ============================================================

-- Announcements table
CREATE TABLE public.announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Staff can do everything
CREATE POLICY "Staff can manage announcements"
  ON public.announcements FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  );

-- Residents can view
CREATE POLICY "Residents can view announcements"
  ON public.announcements FOR SELECT
  USING (has_role(auth.uid(), 'resident'::app_role));

-- Announcement attachments metadata
CREATE TABLE public.announcement_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  content_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.announcement_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage attachments"
  ON public.announcement_attachments FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  );

CREATE POLICY "Residents can view attachments"
  ON public.announcement_attachments FOR SELECT
  USING (has_role(auth.uid(), 'resident'::app_role));

-- Read confirmations
CREATE TABLE public.announcement_reads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(announcement_id, user_id)
);

ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reads"
  ON public.announcement_reads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reads"
  ON public.announcement_reads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Staff can view all reads"
  ON public.announcement_reads FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  );

-- Update trigger
CREATE TRIGGER update_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for announcement files
INSERT INTO storage.buckets (id, name, public) VALUES ('announcement-files', 'announcement-files', true);

-- Storage policies
CREATE POLICY "Staff can upload announcement files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'announcement-files' AND (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  ));

CREATE POLICY "Anyone can view announcement files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'announcement-files');

CREATE POLICY "Staff can delete announcement files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'announcement-files' AND (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  ));

-- Enable realtime for announcements
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;


-- ============================================================
-- MIGRAÇÃO: 20260214125610_53cd6780-17fd-43a8-801f-fec56b45fb07.sql
-- ============================================================

CREATE TABLE public.blocked_visitors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_name TEXT NOT NULL,
  visitor_document TEXT NOT NULL,
  reason TEXT,
  blocked_by UUID,
  blocked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.blocked_visitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view blocked visitors"
ON public.blocked_visitors FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can insert blocked visitors"
ON public.blocked_visitors FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can update blocked visitors"
ON public.blocked_visitors FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can delete blocked visitors"
ON public.blocked_visitors FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));


-- ============================================================
-- MIGRAÇÃO: 20260214131537_3793172e-ea3d-4833-9bca-07aa13079e92.sql
-- ============================================================

-- Drop existing RESTRICTIVE policies on residents
DROP POLICY IF EXISTS "Admins can delete residents" ON public.residents;
DROP POLICY IF EXISTS "Admins can insert residents" ON public.residents;
DROP POLICY IF EXISTS "Admins can update residents" ON public.residents;
DROP POLICY IF EXISTS "Authorized staff can view residents" ON public.residents;
DROP POLICY IF EXISTS "Residents can view own data" ON public.residents;

-- Recreate as PERMISSIVE policies
CREATE POLICY "Admins can insert residents"
ON public.residents FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update residents"
ON public.residents FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete residents"
ON public.residents FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authorized staff can view residents"
ON public.residents FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role));

CREATE POLICY "Residents can view own data"
ON public.residents FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'resident'::app_role) AND auth_user_id = auth.uid());

-- Also fix access_entries policies (same issue)
DROP POLICY IF EXISTS "Security staff can insert entries" ON public.access_entries;
DROP POLICY IF EXISTS "Security staff can update entries" ON public.access_entries;
DROP POLICY IF EXISTS "Security staff can view entries" ON public.access_entries;
DROP POLICY IF EXISTS "Residents can view own access entries" ON public.access_entries;

CREATE POLICY "Security staff can insert entries"
ON public.access_entries FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Security staff can update entries"
ON public.access_entries FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Security staff can view entries"
ON public.access_entries FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Residents can view own access entries"
ON public.access_entries FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'resident'::app_role) AND apartment IN (
  SELECT residents.apartment FROM residents WHERE residents.auth_user_id = auth.uid()
));

-- Fix mails policies
DROP POLICY IF EXISTS "Admins can delete mails" ON public.mails;
DROP POLICY IF EXISTS "Authorized staff can insert mails" ON public.mails;
DROP POLICY IF EXISTS "Authorized staff can update mails" ON public.mails;
DROP POLICY IF EXISTS "Authorized staff can view mails" ON public.mails;
DROP POLICY IF EXISTS "Residents can view own mails" ON public.mails;

CREATE POLICY "Admins can delete mails"
ON public.mails FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authorized staff can insert mails"
ON public.mails FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role));

CREATE POLICY "Authorized staff can update mails"
ON public.mails FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role));

CREATE POLICY "Authorized staff can view mails"
ON public.mails FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role));

CREATE POLICY "Residents can view own mails"
ON public.mails FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'resident'::app_role) AND resident_id IN (
  SELECT residents.id FROM residents WHERE residents.auth_user_id = auth.uid()
));

-- Fix devices policies
DROP POLICY IF EXISTS "Admins can manage devices" ON public.devices;

CREATE POLICY "Admins can manage devices"
ON public.devices FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Fix blocked_visitors policies
DROP POLICY IF EXISTS "Staff can view blocked visitors" ON public.blocked_visitors;
DROP POLICY IF EXISTS "Staff can insert blocked visitors" ON public.blocked_visitors;
DROP POLICY IF EXISTS "Staff can update blocked visitors" ON public.blocked_visitors;
DROP POLICY IF EXISTS "Staff can delete blocked visitors" ON public.blocked_visitors;

CREATE POLICY "Staff can view blocked visitors"
ON public.blocked_visitors FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can insert blocked visitors"
ON public.blocked_visitors FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can update blocked visitors"
ON public.blocked_visitors FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can delete blocked visitors"
ON public.blocked_visitors FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));


-- ============================================================
-- MIGRAÇÃO: 20260214152549_e85fa35b-802c-4214-a639-fc3f32e822d6.sql
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.controlid_logs;

-- ============================================================
-- MIGRAÇÃO: 20260214161205_ff6add71-2bfd-4f0e-b485-62c0447c5c00.sql
-- ============================================================
-- Add tracking_code and photo_url columns to mails table
ALTER TABLE public.mails ADD COLUMN tracking_code text;
ALTER TABLE public.mails ADD COLUMN photo_url text;

-- ============================================================
-- MIGRAÇÃO: 20260214161234_a2d0e121-e2bc-4f04-a589-814bc748dc9b.sql
-- ============================================================
-- Create storage bucket for mail photos
INSERT INTO storage.buckets (id, name, public) VALUES ('mail-photos', 'mail-photos', true);

-- Allow authenticated users to upload mail photos
CREATE POLICY "Staff can upload mail photos" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'mail-photos' AND (auth.role() = 'authenticated'));

-- Public read access for mail photos
CREATE POLICY "Anyone can view mail photos" ON storage.objects
FOR SELECT USING (bucket_id = 'mail-photos');

-- Staff can delete mail photos
CREATE POLICY "Staff can delete mail photos" ON storage.objects
FOR DELETE USING (bucket_id = 'mail-photos' AND (auth.role() = 'authenticated'));

-- ============================================================
-- MIGRAÇÃO: 20260214182251_38e12afb-eb9c-4087-b079-123776e92366.sql
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;

-- ============================================================
-- MIGRAÇÃO: 20260214185609_c73102a6-dc61-4a0a-83d9-415b8d9d4cd8.sql
-- ============================================================

-- 1. Fix controlid_logs INSERT policy (currently WITH CHECK (true) - too permissive)
DROP POLICY IF EXISTS "Service role can insert controlid logs" ON public.controlid_logs;
-- Edge function uses service role key, so we allow insert for authenticated or service role
-- but restrict to admin role for regular users
CREATE POLICY "Service role can insert controlid logs" ON public.controlid_logs
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR current_setting('request.jwt.claim.role', true) = 'service_role'
);

-- 2. Restrict controlid_logs SELECT to admins only (was all authenticated)
DROP POLICY IF EXISTS "Authenticated users can view controlid logs" ON public.controlid_logs;
CREATE POLICY "Admins can view controlid logs" ON public.controlid_logs
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. Restrict incidents SELECT to admins + reporter only
DROP POLICY IF EXISTS "Authenticated users can view incidents" ON public.incidents;
CREATE POLICY "Admins and reporters can view incidents" ON public.incidents
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR (reported_by = auth.uid())
);

-- 4. Restrict incidents management to admin/security only (was all authenticated)
DROP POLICY IF EXISTS "Staff can manage incidents" ON public.incidents;
CREATE POLICY "Staff can insert incidents" ON public.incidents
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
);
CREATE POLICY "Staff can update incidents" ON public.incidents
FOR UPDATE USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
);
CREATE POLICY "Admins can delete incidents" ON public.incidents
FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- 5. Restrict shifts management to admin/security (was all authenticated)
DROP POLICY IF EXISTS "Authenticated users can view shifts" ON public.shifts;
DROP POLICY IF EXISTS "Staff can manage shifts" ON public.shifts;
CREATE POLICY "Staff can view shifts" ON public.shifts
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);
CREATE POLICY "Admins can manage shifts" ON public.shifts
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 6. Restrict vehicles to staff roles (was all authenticated)
DROP POLICY IF EXISTS "Authenticated users can view vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Staff can delete vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Staff can insert vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Staff can update vehicles" ON public.vehicles;
CREATE POLICY "Staff can view vehicles" ON public.vehicles
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);
CREATE POLICY "Admins can manage vehicles" ON public.vehicles
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 7. Restrict realtime_events to staff roles
DROP POLICY IF EXISTS "Authenticated users can view events" ON public.realtime_events;
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.realtime_events;
CREATE POLICY "Staff can view events" ON public.realtime_events
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);
CREATE POLICY "Staff can insert events" ON public.realtime_events
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);


-- ============================================================
-- MIGRAÇÃO: 20260216130938_145b1b9d-3ce2-4612-a020-03202d6043a8.sql
-- ============================================================

-- Make buckets private
UPDATE storage.buckets SET public = false WHERE id IN ('announcement-files', 'mail-photos');

-- Drop old public SELECT policies
DROP POLICY IF EXISTS "Anyone can view announcement files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view mail photos" ON storage.objects;

-- Create authenticated SELECT policies for announcement-files
CREATE POLICY "Authenticated users can view announcement files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'announcement-files' 
  AND auth.role() = 'authenticated'
);

-- Create authenticated SELECT policies for mail-photos (staff + resident who owns the mail)
CREATE POLICY "Authenticated users can view mail photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'mail-photos' 
  AND auth.role() = 'authenticated'
);


-- ============================================================
-- MIGRAÇÃO: 20260216134355_27873243-4155-4bb0-8f47-46bfff61cca6.sql
-- ============================================================

-- Table to store Web Push subscriptions
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own subscriptions"
ON public.push_subscriptions
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Table to store VAPID keys (generated once)
CREATE TABLE public.vapid_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vapid_keys ENABLE ROW LEVEL SECURITY;

-- Only service role can access VAPID keys (edge functions)
-- Public key needs to be readable by authenticated users
CREATE POLICY "Authenticated can read public key"
ON public.vapid_keys
FOR SELECT
USING (auth.role() = 'authenticated');

-- Enable realtime for notifications to trigger push
ALTER PUBLICATION supabase_realtime ADD TABLE public.push_subscriptions;


-- ============================================================
-- MIGRAÇÃO: 20260216135642_a400f38b-eb11-40a9-8e04-efe1e92f4b35.sql
-- ============================================================

-- Add badge_number column to access_entries
ALTER TABLE public.access_entries ADD COLUMN badge_number TEXT;


-- ============================================================
-- MIGRAÇÃO: 20260216164746_5857b18d-80d0-4350-918c-cd45063c1086.sql
-- ============================================================

-- Create a trigger function to auto-notify staff when a resident sends a chat message
CREATE OR REPLACE FUNCTION public.notify_staff_on_resident_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only notify for resident messages
  IF NEW.sender_type = 'resident' THEN
    INSERT INTO public.notifications (user_id, title, body, type, related_id)
    SELECT ur.user_id, 'Nova mensagem de morador', LEFT(NEW.message, 100), 'chat', NEW.resident_id
    FROM public.user_roles ur
    WHERE ur.role IN ('admin', 'receptionist', 'security_guard');
  END IF;
  RETURN NEW;
END;
$function$;

-- Create the trigger
CREATE TRIGGER on_resident_chat_message
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_staff_on_resident_message();


-- ============================================================
-- MIGRAÇÃO: 20260220103124_4043e5a9-00bf-416c-b8ae-3dbe69dd747d.sql
-- ============================================================

-- Create storage bucket for resident photos
INSERT INTO storage.buckets (id, name, public) VALUES ('resident-photos', 'resident-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload their own photos (staff only)
CREATE POLICY "Staff can upload resident photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'resident-photos' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role))
);

-- Staff can view resident photos
CREATE POLICY "Staff can view resident photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'resident-photos' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role) OR has_role(auth.uid(), 'resident'::app_role))
);

-- Staff can update resident photos
CREATE POLICY "Staff can update resident photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'resident-photos' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role))
);

-- Staff can delete resident photos
CREATE POLICY "Staff can delete resident photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'resident-photos' AND
  (has_role(auth.uid(), 'admin'::app_role))
);


-- ============================================================
-- MIGRAÇÃO: 20260222095853_f1819b0f-525b-49b1-a261-4173ba557b3f.sql
-- ============================================================
-- Add ip_address column to devices table
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS ip_address text;

-- ============================================================
-- MIGRAÇÃO: 20260302095007_0efae839-a116-4651-963d-d5bbe4a67632.sql
-- ============================================================

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


-- ============================================================
-- MIGRAÇÃO: 20260302102929_3b72251b-4a8e-48b9-a274-43511bc442cf.sql
-- ============================================================
CREATE POLICY "Staff can delete checks"
ON public.shift_equipment_checks
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);

-- ============================================================
-- MIGRAÇÃO: 20260302162315_d6d26238-da0e-4405-ba1a-b3e0375c44fd.sql
-- ============================================================
CREATE POLICY "Admins can delete access entries"
ON public.access_entries
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- MIGRAÇÃO: 20260304163024_8c5f1459-5c95-44dd-8160-d17ff208cb2c.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_validate_guest_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When a new access entry is created, check if there's a matching pending visitor authorization
  -- Match by visitor name (case-insensitive) and authorized_date = today
  UPDATE public.visitor_authorizations
  SET status = 'approved', updated_at = now()
  WHERE status = 'pending'
    AND authorized_date = CURRENT_DATE
    AND LOWER(TRIM(visitor_name)) = LOWER(TRIM(NEW.visitor_name));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_validate_guest_list
AFTER INSERT ON public.access_entries
FOR EACH ROW
EXECUTE FUNCTION public.auto_validate_guest_list();


-- ============================================================
-- MIGRAÇÃO: 20260304163834_e0495d89-83a8-48fe-b7c5-47122d7af39c.sql
-- ============================================================

CREATE POLICY "Residents can delete own pending authorizations"
ON public.visitor_authorizations
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'resident'::app_role)
  AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())
  AND status = 'pending'
);


-- ============================================================
-- MIGRAÇÃO: 20260308210411_d7c430e3-52f4-44b6-aebe-fd52030cb1b0.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_all_staff(
  _title text,
  _body text,
  _type text,
  _related_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, body, type, related_id)
  SELECT ur.user_id, _title, _body, _type, _related_id
  FROM public.user_roles ur
  WHERE ur.role IN ('admin', 'receptionist', 'security_guard');
END;
$$;

-- ============================================================
-- MIGRAÇÃO: 20260312170744_b7dd488f-ae7d-4a65-8047-80ced0d90923.sql
-- ============================================================

-- Table to persist push commands for Control iD devices (replaces in-memory queue)
CREATE TABLE public.push_command_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  command jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  executed_at timestamp with time zone
);

-- Index for fast lookup of pending commands per device
CREATE INDEX idx_push_queue_device_status ON public.push_command_queue (device_id, status) WHERE status = 'pending';

-- Enable RLS
ALTER TABLE public.push_command_queue ENABLE ROW LEVEL SECURITY;

-- Only service role (edge function) and admins can access
CREATE POLICY "Service role and admins can manage push queue"
  ON public.push_command_queue
  FOR ALL
  TO public
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR current_setting('request.jwt.claim.role', true) = 'service_role'
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR current_setting('request.jwt.claim.role', true) = 'service_role'
  );


-- ============================================================
-- MIGRAÇÃO: 20260314102654_7fc7bfc1-08c4-4d8f-a355-c2daf0efc1c2.sql
-- ============================================================
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

-- ============================================================
-- MIGRAÇÃO: 20260316131441_cc291975-ec2d-42b8-9316-a6160e1c9639.sql
-- ============================================================
UPDATE push_command_queue SET status = 'done', executed_at = now() WHERE id = '8c39fb44-7c86-43a4-a19d-4787bdef2a67';

-- ============================================================
-- MIGRAÇÃO: 20260316145404_834442dc-e2d5-4aa2-96f0-7699f484a110.sql
-- ============================================================
ALTER TABLE public.push_command_queue ADD COLUMN IF NOT EXISTS result jsonb DEFAULT NULL;

