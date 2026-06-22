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