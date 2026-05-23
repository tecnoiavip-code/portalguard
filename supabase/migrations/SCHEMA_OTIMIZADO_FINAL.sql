-- ============================================================
-- PORTALGUARD PRO - SCHEMA OTIMIZADO FINAL
-- SQL consolidado e otimizado para Supabase
-- Versão: 2.0 - Com correções de performance e RLS aprimorado
-- ============================================================

-- ============================================================
-- 1. TYPES & ENUMS
-- ============================================================

-- Drop type if exists (for older PostgreSQL versions < 13)
DROP TYPE IF EXISTS public.app_role CASCADE;
CREATE TYPE public.app_role AS ENUM ('admin', 'security_guard', 'receptionist', 'resident');

-- ============================================================
-- 2. TABLES - CORE
-- ============================================================

-- Profiles (extends auth.users)
DROP TABLE IF EXISTS public.profiles CASCADE;
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles (separate for security)
DROP TABLE IF EXISTS public.user_roles CASCADE;
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id, role)
);

-- Residents
DROP TABLE IF EXISTS public.residents CASCADE;
CREATE TABLE public.residents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  cpf TEXT UNIQUE,
  apartment TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Vehicles (separate table for multiple vehicles per resident)
DROP TABLE IF EXISTS public.vehicles CASCADE;
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  model TEXT,
  color TEXT,
  tag TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Access entries
DROP TABLE IF EXISTS public.access_entries CASCADE;
CREATE TABLE public.access_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_name TEXT NOT NULL,
  visitor_document TEXT NOT NULL,
  visitor_type TEXT CHECK (visitor_type IN ('visitor', 'service_provider')),
  resident_id UUID REFERENCES public.residents(id),
  resident_name TEXT,
  apartment TEXT NOT NULL,
  purpose TEXT,
  company TEXT,
  notes TEXT,
  entry_time TIMESTAMPTZ DEFAULT NOW(),
  exit_time TIMESTAMPTZ,
  vehicle_plate TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  photo_url TEXT,
  auto_recognized BOOLEAN DEFAULT FALSE,
  registered_by UUID REFERENCES auth.users(id)
);

-- Mails/Packages
DROP TABLE IF EXISTS public.mails CASCADE;
CREATE TABLE public.mails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  package_type TEXT CHECK (package_type IN ('Carta', 'Pacote Pequeno', 'Pacote Médio', 'Pacote Grande')),
  notes TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT CHECK (status IN ('pending', 'delivered')) DEFAULT 'pending',
  delivered_at TIMESTAMPTZ,
  withdrawn_by TEXT,
  registered_by UUID REFERENCES auth.users(id)
);

-- Devices
DROP TABLE IF EXISTS public.devices CASCADE;
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('facial_recognition', 'vehicle_tag', 'card_reader')),
  location TEXT NOT NULL,
  status TEXT CHECK (status IN ('online', 'offline')) DEFAULT 'online',
  serial_number TEXT,
  last_sync TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. TABLES - MANAGEMENT & OPERATIONS
-- ============================================================

-- Real-time events
DROP TABLE IF EXISTS public.realtime_events CASCADE;
CREATE TABLE public.realtime_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('entry', 'exit', 'mail', 'alert', 'device')),
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  related_id UUID,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shifts/Teams
DROP TABLE IF EXISTS public.shifts CASCADE;
CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_members TEXT[] NOT NULL,
  shift_start TIMESTAMPTZ NOT NULL,
  shift_end TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Incidents
DROP TABLE IF EXISTS public.incidents CASCADE;
CREATE TABLE public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  reported_by UUID REFERENCES auth.users(id),
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Control iD Configuration
DROP TABLE IF EXISTS public.controlid_config CASCADE;
CREATE TABLE public.controlid_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name TEXT NOT NULL,
  device_ip TEXT NOT NULL,
  device_port TEXT DEFAULT '80',
  device_id TEXT,
  api_path TEXT DEFAULT '/api/notifications',
  is_active BOOLEAN DEFAULT true,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Control iD Logs
DROP TABLE IF EXISTS public.controlid_logs CASCADE;
CREATE TABLE public.controlid_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. TABLES - RESIDENT FEATURES
-- ============================================================

-- Chat messages
DROP TABLE IF EXISTS public.chat_messages CASCADE;
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('resident', 'staff')),
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Visitor authorizations
DROP TABLE IF EXISTS public.visitor_authorizations CASCADE;
CREATE TABLE public.visitor_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  visitor_name TEXT NOT NULL,
  visitor_document TEXT,
  authorized_date DATE NOT NULL,
  authorized_until DATE,
  purpose TEXT,
  vehicle_plate TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  staff_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blocked visitors
DROP TABLE IF EXISTS public.blocked_visitors CASCADE;
CREATE TABLE public.blocked_visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_name TEXT NOT NULL,
  visitor_document TEXT NOT NULL,
  reason TEXT,
  blocked_by UUID,
  blocked_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- Notifications
DROP TABLE IF EXISTS public.notifications CASCADE;
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mail', 'visitor', 'authorization', 'chat', 'general')),
  related_id UUID,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcements
DROP TABLE IF EXISTS public.announcements CASCADE;
CREATE TABLE public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcement attachments
DROP TABLE IF EXISTS public.announcement_attachments CASCADE;
CREATE TABLE public.announcement_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  content_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcement reads
DROP TABLE IF EXISTS public.announcement_reads CASCADE;
CREATE TABLE public.announcement_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);

-- ============================================================
-- 5. ENABLE ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlid_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlid_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. FUNCTIONS & TRIGGERS
-- ============================================================

-- Function: Check if user has role
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

-- Function: Update updated_at column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Function: Handle new user signup (auto-create profile and first-user admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INTEGER;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  
  -- Make first user admin
  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger: Auto-create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Triggers: Update updated_at columns
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_residents_updated_at ON public.residents;
CREATE TRIGGER update_residents_updated_at
  BEFORE UPDATE ON public.residents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER update_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_devices_updated_at ON public.devices;
CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_shifts_updated_at ON public.shifts;
CREATE TRIGGER update_shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_incidents_updated_at ON public.incidents;
CREATE TRIGGER update_incidents_updated_at
  BEFORE UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_controlid_config_updated_at ON public.controlid_config;
CREATE TRIGGER update_controlid_config_updated_at
  BEFORE UPDATE ON public.controlid_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_chat_messages_updated_at ON public.chat_messages;
CREATE TRIGGER update_chat_messages_updated_at
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_visitor_authorizations_updated_at ON public.visitor_authorizations;
CREATE TRIGGER update_visitor_authorizations_updated_at
  BEFORE UPDATE ON public.visitor_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_announcements_updated_at ON public.announcements;
CREATE TRIGGER update_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 7. INDEXES - PERFORMANCE OPTIMIZATION
-- ============================================================

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles(created_at DESC);

-- User roles
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- Residents
CREATE INDEX IF NOT EXISTS idx_residents_apartment ON public.residents(apartment);
CREATE INDEX IF NOT EXISTS idx_residents_cpf ON public.residents(cpf);
CREATE INDEX IF NOT EXISTS idx_residents_auth_user_id ON public.residents(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_residents_created_at ON public.residents(created_at DESC);

-- Vehicles
CREATE INDEX IF NOT EXISTS idx_vehicles_resident_id ON public.vehicles(resident_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON public.vehicles(plate);
CREATE INDEX IF NOT EXISTS idx_vehicles_created_at ON public.vehicles(created_at DESC);

-- Access entries
CREATE INDEX IF NOT EXISTS idx_access_entries_resident_id ON public.access_entries(resident_id);
CREATE INDEX IF NOT EXISTS idx_access_entries_entry_time ON public.access_entries(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_access_entries_apartment ON public.access_entries(apartment);
CREATE INDEX IF NOT EXISTS idx_access_entries_visitor_document ON public.access_entries(visitor_document);

-- Mails
CREATE INDEX IF NOT EXISTS idx_mails_resident_id ON public.mails(resident_id);
CREATE INDEX IF NOT EXISTS idx_mails_status ON public.mails(status);
CREATE INDEX IF NOT EXISTS idx_mails_received_at ON public.mails(received_at DESC);

-- Real-time events
CREATE INDEX IF NOT EXISTS idx_realtime_events_timestamp ON public.realtime_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_events_type ON public.realtime_events(type);
CREATE INDEX IF NOT EXISTS idx_realtime_events_priority ON public.realtime_events(priority);

-- Shifts
CREATE INDEX IF NOT EXISTS idx_shifts_shift_start ON public.shifts(shift_start DESC);

-- Incidents
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON public.incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON public.incidents(created_at DESC);

-- Control iD logs
CREATE INDEX IF NOT EXISTS idx_controlid_logs_device_id ON public.controlid_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_controlid_logs_event_type ON public.controlid_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_controlid_logs_received_at ON public.controlid_logs(received_at DESC);

-- Chat messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_resident_id ON public.chat_messages(resident_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id ON public.chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at DESC);

-- Visitor authorizations
CREATE INDEX IF NOT EXISTS idx_visitor_authorizations_resident_id ON public.visitor_authorizations(resident_id);
CREATE INDEX IF NOT EXISTS idx_visitor_authorizations_status ON public.visitor_authorizations(status);
CREATE INDEX IF NOT EXISTS idx_visitor_authorizations_authorized_date ON public.visitor_authorizations(authorized_date);

-- Blocked visitors
CREATE INDEX IF NOT EXISTS idx_blocked_visitors_visitor_document ON public.blocked_visitors(visitor_document);
CREATE INDEX IF NOT EXISTS idx_blocked_visitors_is_active ON public.blocked_visitors(is_active);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- Announcements
CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON public.announcements(created_by);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON public.announcements(created_at DESC);

-- Announcement attachments
CREATE INDEX IF NOT EXISTS idx_announcement_attachments_announcement_id ON public.announcement_attachments(announcement_id);

-- Announcement reads
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user_id ON public.announcement_reads(user_id);

-- ============================================================
-- 8. ROW LEVEL SECURITY POLICIES
-- ============================================================

-- ============================================================
-- PROFILES
-- ============================================================
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

-- ============================================================
-- USER ROLES
-- ============================================================
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
CREATE POLICY "Admins can manage all roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- RESIDENTS
-- ============================================================
DROP POLICY IF EXISTS "Admins can insert residents" ON public.residents;
CREATE POLICY "Admins can insert residents"
ON public.residents FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update residents" ON public.residents;
CREATE POLICY "Admins can update residents"
ON public.residents FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can delete residents" ON public.residents;
CREATE POLICY "Admins can delete residents"
ON public.residents FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authorized staff can view residents" ON public.residents;
CREATE POLICY "Authorized staff can view residents"
ON public.residents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'receptionist'::app_role)
);

DROP POLICY IF EXISTS "Residents can view own data" ON public.residents;
CREATE POLICY "Residents can view own data"
ON public.residents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'resident'::app_role) AND 
  auth_user_id = auth.uid()
);

-- ============================================================
-- VEHICLES
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view vehicles" ON public.vehicles;
CREATE POLICY "Authenticated users can view vehicles"
ON public.vehicles FOR SELECT
USING (auth.role() = 'authenticated'::text);

DROP POLICY IF EXISTS "Staff can insert vehicles" ON public.vehicles;
CREATE POLICY "Staff can insert vehicles"
ON public.vehicles FOR INSERT
WITH CHECK (auth.role() = 'authenticated'::text);

DROP POLICY IF EXISTS "Staff can update vehicles" ON public.vehicles;
CREATE POLICY "Staff can update vehicles"
ON public.vehicles FOR UPDATE
USING (auth.role() = 'authenticated'::text);

DROP POLICY IF EXISTS "Staff can delete vehicles" ON public.vehicles;
CREATE POLICY "Staff can delete vehicles"
ON public.vehicles FOR DELETE
USING (auth.role() = 'authenticated'::text);

-- ============================================================
-- ACCESS ENTRIES
-- ============================================================
DROP POLICY IF EXISTS "Security staff can insert entries" ON public.access_entries;
CREATE POLICY "Security staff can insert entries"
ON public.access_entries FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Security staff can update entries" ON public.access_entries;
CREATE POLICY "Security staff can update entries"
ON public.access_entries FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Security staff can view entries" ON public.access_entries;
CREATE POLICY "Security staff can view entries"
ON public.access_entries FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Residents can view own access entries" ON public.access_entries;
CREATE POLICY "Residents can view own access entries"
ON public.access_entries FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'resident'::app_role) AND 
  apartment IN (SELECT apartment FROM public.residents WHERE auth_user_id = auth.uid())
);

-- ============================================================
-- MAILS
-- ============================================================
DROP POLICY IF EXISTS "Admins can delete mails" ON public.mails;
CREATE POLICY "Admins can delete mails"
ON public.mails FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authorized staff can insert mails" ON public.mails;
CREATE POLICY "Authorized staff can insert mails"
ON public.mails FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'receptionist'::app_role)
);

DROP POLICY IF EXISTS "Authorized staff can update mails" ON public.mails;
CREATE POLICY "Authorized staff can update mails"
ON public.mails FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'receptionist'::app_role)
);

DROP POLICY IF EXISTS "Authorized staff can view mails" ON public.mails;
CREATE POLICY "Authorized staff can view mails"
ON public.mails FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'receptionist'::app_role)
);

DROP POLICY IF EXISTS "Residents can view own mails" ON public.mails;
CREATE POLICY "Residents can view own mails"
ON public.mails FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'resident'::app_role) AND 
  resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())
);

-- ============================================================
-- DEVICES
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage devices" ON public.devices;
CREATE POLICY "Admins can manage devices"
ON public.devices FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- REAL-TIME EVENTS
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view events" ON public.realtime_events;
CREATE POLICY "Authenticated users can view events"
ON public.realtime_events FOR SELECT
USING (auth.role() = 'authenticated'::text);

DROP POLICY IF EXISTS "Authenticated users can insert events" ON public.realtime_events;
CREATE POLICY "Authenticated users can insert events"
ON public.realtime_events FOR INSERT
WITH CHECK (auth.role() = 'authenticated'::text);

-- ============================================================
-- SHIFTS
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view shifts" ON public.shifts;
CREATE POLICY "Authenticated users can view shifts"
ON public.shifts FOR SELECT
USING (auth.role() = 'authenticated'::text);

DROP POLICY IF EXISTS "Staff can manage shifts" ON public.shifts;
CREATE POLICY "Staff can manage shifts"
ON public.shifts FOR ALL
USING (auth.role() = 'authenticated'::text);

-- ============================================================
-- INCIDENTS
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view incidents" ON public.incidents;
CREATE POLICY "Authenticated users can view incidents"
ON public.incidents FOR SELECT
USING (auth.role() = 'authenticated'::text);

DROP POLICY IF EXISTS "Staff can manage incidents" ON public.incidents;
CREATE POLICY "Staff can manage incidents"
ON public.incidents FOR ALL
USING (auth.role() = 'authenticated'::text);

-- ============================================================
-- CONTROL ID CONFIG
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage controlid config" ON public.controlid_config;
CREATE POLICY "Admins can manage controlid config"
ON public.controlid_config FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- CONTROL ID LOGS
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view controlid logs" ON public.controlid_logs;
CREATE POLICY "Authenticated users can view controlid logs"
ON public.controlid_logs FOR SELECT
USING (auth.role() = 'authenticated'::text);

DROP POLICY IF EXISTS "Service role can insert controlid logs" ON public.controlid_logs;
CREATE POLICY "Service role can insert controlid logs"
ON public.controlid_logs FOR INSERT
WITH CHECK (true);

-- ============================================================
-- CHAT MESSAGES
-- ============================================================
DROP POLICY IF EXISTS "Users can view chat messages" ON public.chat_messages;
CREATE POLICY "Users can view chat messages"
ON public.chat_messages FOR SELECT
USING (
  (public.has_role(auth.uid(), 'resident'::app_role) AND 
   resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())) OR
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'receptionist'::app_role) OR
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Users can send messages" ON public.chat_messages;
CREATE POLICY "Users can send messages"
ON public.chat_messages FOR INSERT
WITH CHECK (
  (public.has_role(auth.uid(), 'resident'::app_role) AND 
   sender_type = 'resident' AND 
   resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())) OR
  ((public.has_role(auth.uid(), 'admin'::app_role) OR 
    public.has_role(auth.uid(), 'receptionist'::app_role) OR 
    public.has_role(auth.uid(), 'security_guard'::app_role)) AND 
   sender_type = 'staff')
);

DROP POLICY IF EXISTS "Users can update read status" ON public.chat_messages;
CREATE POLICY "Users can update read status"
ON public.chat_messages FOR UPDATE
USING (
  (public.has_role(auth.uid(), 'resident'::app_role) AND 
   resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())) OR
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'receptionist'::app_role) OR
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

-- ============================================================
-- VISITOR AUTHORIZATIONS
-- ============================================================
DROP POLICY IF EXISTS "Residents can view own authorizations" ON public.visitor_authorizations;
CREATE POLICY "Residents can view own authorizations"
ON public.visitor_authorizations FOR SELECT
USING (
  (public.has_role(auth.uid(), 'resident'::app_role) AND 
   resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())) OR
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'receptionist'::app_role) OR
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Residents can create authorizations" ON public.visitor_authorizations;
CREATE POLICY "Residents can create authorizations"
ON public.visitor_authorizations FOR INSERT
WITH CHECK (
  public.has_role(auth.uid(), 'resident'::app_role) AND 
  resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())
);

DROP POLICY IF EXISTS "Staff can update authorizations" ON public.visitor_authorizations;
CREATE POLICY "Staff can update authorizations"
ON public.visitor_authorizations FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'receptionist'::app_role) OR 
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

-- ============================================================
-- BLOCKED VISITORS
-- ============================================================
DROP POLICY IF EXISTS "Staff can view blocked visitors" ON public.blocked_visitors;
CREATE POLICY "Staff can view blocked visitors"
ON public.blocked_visitors FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Staff can insert blocked visitors" ON public.blocked_visitors;
CREATE POLICY "Staff can insert blocked visitors"
ON public.blocked_visitors FOR INSERT
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Staff can update blocked visitors" ON public.blocked_visitors;
CREATE POLICY "Staff can update blocked visitors"
ON public.blocked_visitors FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Staff can delete blocked visitors" ON public.blocked_visitors;
CREATE POLICY "Staff can delete blocked visitors"
ON public.blocked_visitors FOR DELETE
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR 
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
ON public.notifications FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.notifications;
CREATE POLICY "Authenticated can insert notifications"
ON public.notifications FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================
DROP POLICY IF EXISTS "Staff can manage announcements" ON public.announcements;
CREATE POLICY "Staff can manage announcements"
ON public.announcements FOR ALL
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'receptionist'::app_role) OR
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Residents can view announcements" ON public.announcements;
CREATE POLICY "Residents can view announcements"
ON public.announcements FOR SELECT
USING (public.has_role(auth.uid(), 'resident'::app_role));

-- ============================================================
-- ANNOUNCEMENT ATTACHMENTS
-- ============================================================
DROP POLICY IF EXISTS "Staff can manage attachments" ON public.announcement_attachments;
CREATE POLICY "Staff can manage attachments"
ON public.announcement_attachments FOR ALL
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'receptionist'::app_role) OR
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

DROP POLICY IF EXISTS "Residents can view attachments" ON public.announcement_attachments;
CREATE POLICY "Residents can view attachments"
ON public.announcement_attachments FOR SELECT
USING (public.has_role(auth.uid(), 'resident'::app_role));

-- ============================================================
-- ANNOUNCEMENT READS
-- ============================================================
DROP POLICY IF EXISTS "Users can view own reads" ON public.announcement_reads;
CREATE POLICY "Users can view own reads"
ON public.announcement_reads FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own reads" ON public.announcement_reads;
CREATE POLICY "Users can insert own reads"
ON public.announcement_reads FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Staff can view all reads" ON public.announcement_reads;
CREATE POLICY "Staff can view all reads"
ON public.announcement_reads FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'receptionist'::app_role) OR
  public.has_role(auth.uid(), 'security_guard'::app_role)
);

-- ============================================================
-- 9. STORAGE CONFIGURATION
-- ============================================================

-- Create storage bucket for announcements
INSERT INTO storage.buckets (id, name, public)
VALUES ('announcement-files', 'announcement-files', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 10. STORAGE POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Staff can upload announcement files" ON storage.objects;
CREATE POLICY "Staff can upload announcement files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'announcement-files' AND (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'receptionist'::app_role) OR
    public.has_role(auth.uid(), 'security_guard'::app_role)
  )
);

DROP POLICY IF EXISTS "Anyone can view announcement files" ON storage.objects;
CREATE POLICY "Anyone can view announcement files"
ON storage.objects FOR SELECT
USING (bucket_id = 'announcement-files');

DROP POLICY IF EXISTS "Staff can delete announcement files" ON storage.objects;
CREATE POLICY "Staff can delete announcement files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'announcement-files' AND (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'receptionist'::app_role) OR
    public.has_role(auth.uid(), 'security_guard'::app_role)
  )
);

-- ============================================================
-- 11. REALTIME CONFIGURATION
-- ============================================================

-- Enable replica identity for realtime
ALTER TABLE public.residents REPLICA IDENTITY FULL;
ALTER TABLE public.mails REPLICA IDENTITY FULL;
ALTER TABLE public.access_entries REPLICA IDENTITY FULL;
ALTER TABLE public.vehicles REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.announcements REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.residents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mails;
ALTER PUBLICATION supabase_realtime ADD TABLE public.access_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ============================================================
-- END OF SCHEMA
-- ============================================================
