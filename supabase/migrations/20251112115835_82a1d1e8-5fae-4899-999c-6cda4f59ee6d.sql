-- Make CPF optional for residents
ALTER TABLE public.residents ALTER COLUMN cpf DROP NOT NULL;