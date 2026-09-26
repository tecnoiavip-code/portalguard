ALTER TABLE public.residents ADD COLUMN IF NOT EXISTS contract_type text DEFAULT NULL;
ALTER TABLE public.residents ADD COLUMN IF NOT EXISTS contract_end_date date DEFAULT NULL;