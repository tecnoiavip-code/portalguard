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