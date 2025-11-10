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