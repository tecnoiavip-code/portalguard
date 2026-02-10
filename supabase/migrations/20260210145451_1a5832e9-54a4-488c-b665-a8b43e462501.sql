
-- Parte 1: Adicionar 'resident' ao enum e coluna auth_user_id
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'resident';

-- Adicionar auth_user_id à tabela residents
ALTER TABLE public.residents ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_residents_auth_user_id ON public.residents(auth_user_id) WHERE auth_user_id IS NOT NULL;
