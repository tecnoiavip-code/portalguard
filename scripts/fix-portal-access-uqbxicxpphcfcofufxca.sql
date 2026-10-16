-- Execute ONLY in the current external production database (or its local replica).
-- No accounts, residents, photos or business records are deleted.
BEGIN;

-- Fail before changes if the designated account is missing or emails are ambiguous.
DO $$
BEGIN
  IF (SELECT count(*) FROM auth.users WHERE lower(btrim(email)) = 'tecno.iavip@gmail.com') <> 1 THEN
    RAISE EXCEPTION 'A conta autorizada da portaria deve existir exatamente uma vez.';
  END IF;
  IF EXISTS (
    SELECT lower(btrim(email)) FROM public.residents
    WHERE nullif(btrim(email), '') IS NOT NULL
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existem emails duplicados em residents; corrija antes de aplicar.';
  END IF;
END $$;

-- Disable the legacy first-user privilege grant, retaining the function for old references.
CREATE OR REPLACE FUNCTION public.handle_first_user_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN NEW;
END $$;

-- Remove only incorrect permissions, not users or resident registrations.
DELETE FROM public.user_roles ur USING auth.users u
WHERE ur.user_id = u.id AND (
  (ur.role IN ('admin', 'receptionist', 'security_guard') AND lower(btrim(u.email)) IS DISTINCT FROM 'tecno.iavip@gmail.com')
  OR (ur.role = 'resident' AND (
    lower(btrim(u.email)) = 'tecno.iavip@gmail.com'
    OR NOT EXISTS (SELECT 1 FROM public.residents r WHERE lower(btrim(r.email)) = lower(btrim(u.email)))
  ))
);

-- Link existing accounts to their exact normalized resident email.
UPDATE public.residents r SET auth_user_id = u.id
FROM auth.users u
WHERE lower(btrim(r.email)) = lower(btrim(u.email))
  AND lower(btrim(u.email)) <> 'tecno.iavip@gmail.com';
UPDATE public.residents r SET auth_user_id = NULL
WHERE auth_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = r.auth_user_id
    AND lower(btrim(u.email)) = lower(btrim(r.email))
    AND lower(btrim(u.email)) <> 'tecno.iavip@gmail.com'
);

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
WHERE lower(btrim(email)) = 'tecno.iavip@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT u.id, 'resident'::public.app_role
FROM auth.users u JOIN public.residents r ON r.auth_user_id = u.id
WHERE lower(btrim(u.email)) <> 'tecno.iavip@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Enforce identity even if obsolete role rows survive or an email changes.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.user_id = _user_id AND ur.role = _role AND u.email_confirmed_at IS NOT NULL
      AND CASE WHEN _role IN ('admin', 'receptionist', 'security_guard')
        THEN lower(btrim(u.email)) = 'tecno.iavip@gmail.com'
        WHEN _role = 'resident' THEN lower(btrim(u.email)) <> 'tecno.iavip@gmail.com'
          AND EXISTS (SELECT 1 FROM public.residents r WHERE r.auth_user_id = u.id
            AND lower(btrim(r.email)) = lower(btrim(u.email)))
        ELSE false END
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_portal_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE account_email text;
BEGIN
  SELECT lower(btrim(email)) INTO account_email FROM auth.users WHERE id = NEW.user_id;
  IF NEW.role IN ('admin', 'receptionist', 'security_guard') THEN
    IF account_email IS DISTINCT FROM 'tecno.iavip@gmail.com' THEN
      RAISE EXCEPTION 'Conta não autorizada para a portaria.';
    END IF;
  ELSIF NEW.role = 'resident' THEN
    IF account_email IS NULL OR account_email = 'tecno.iavip@gmail.com' OR NOT EXISTS (
      SELECT 1 FROM public.residents r WHERE lower(btrim(r.email)) = account_email
    ) THEN
      RAISE EXCEPTION 'Conta não vinculada ao cadastro de morador.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_portal_role ON public.user_roles;
CREATE TRIGGER enforce_portal_role BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_role();

-- Auth lifecycle triggers are application-owned; profile creation remains unchanged.
CREATE OR REPLACE FUNCTION public.sync_portal_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE account_email text := lower(btrim(NEW.email));
BEGIN
  DELETE FROM public.user_roles WHERE user_id = NEW.id;
  UPDATE public.residents SET auth_user_id = NULL WHERE auth_user_id = NEW.id;
  IF account_email = 'tecno.iavip@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  ELSIF (SELECT count(*) FROM public.residents WHERE lower(btrim(email)) = account_email) = 1 THEN
    UPDATE public.residents SET auth_user_id = NEW.id WHERE lower(btrim(email)) = account_email;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'resident') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_portal_account ON auth.users;
CREATE TRIGGER sync_portal_account AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_portal_account();

CREATE OR REPLACE FUNCTION public.resolve_portal_access()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN RETURN 'denied'; END IF;
  IF public.has_role(current_user_id, 'admin') OR public.has_role(current_user_id, 'receptionist')
    OR public.has_role(current_user_id, 'security_guard') THEN RETURN 'staff'; END IF;
  IF public.has_role(current_user_id, 'resident') THEN RETURN 'resident'; END IF;
  RETURN 'denied';
END $$;
REVOKE ALL ON FUNCTION public.resolve_portal_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_portal_access() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_portal_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_portal_account() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
-- Add a restrictive guard, so permissive legacy policies cannot authorize other staff.
DROP POLICY IF EXISTS "Portal role boundary" ON public.user_roles;
CREATE POLICY "Portal role boundary" ON public.user_roles AS RESTRICTIVE FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

COMMIT;
-- Validation: must show 0 unauthorized staff and 0 unlinked resident accounts.
SELECT count(*) AS unauthorized_staff FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
WHERE ur.role IN ('admin', 'security_guard', 'receptionist')
  AND lower(btrim(u.email)) IS DISTINCT FROM 'tecno.iavip@gmail.com';
SELECT count(*) AS unlinked_residents FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
WHERE ur.role = 'resident' AND NOT EXISTS (SELECT 1 FROM public.residents r
  WHERE r.auth_user_id = u.id AND lower(btrim(r.email)) = lower(btrim(u.email)));