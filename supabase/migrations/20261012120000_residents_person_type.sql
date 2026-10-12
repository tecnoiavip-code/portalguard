-- ============================================================================
-- Tipo de pessoa em residents
-- - person_type: 'morador' (padrão/NULL) | 'empregado' | 'prestador'
--   Empregados domésticos e prestadores de serviço fixos são liberados como
--   moradores (facial ou TAG), registrados somente pela portaria e sem validade.
-- ============================================================================

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS person_type text;