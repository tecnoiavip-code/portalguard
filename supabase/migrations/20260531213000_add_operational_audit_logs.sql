-- Lightweight operational audit trail for critical staff/resident actions.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc
ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
ON public.audit_logs (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_at
ON public.audit_logs (actor_user_id, created_at DESC)
WHERE actor_user_id IS NOT NULL;

DROP POLICY IF EXISTS "Staff can view audit logs" ON public.audit_logs;
CREATE POLICY "Staff can view audit logs"
ON public.audit_logs FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
);

DROP POLICY IF EXISTS "Authenticated can insert audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated can insert audit logs"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (actor_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.record_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_summary text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_role text;
  created_id uuid;
BEGIN
  IF current_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ur.role::text
  INTO current_role
  FROM public.user_roles ur
  WHERE ur.user_id = current_user_id
  ORDER BY CASE ur.role::text
    WHEN 'admin' THEN 1
    WHEN 'receptionist' THEN 2
    WHEN 'security_guard' THEN 3
    WHEN 'resident' THEN 4
    ELSE 99
  END
  LIMIT 1;

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    metadata
  )
  VALUES (
    current_user_id,
    current_role,
    NULLIF(TRIM(p_action), ''),
    NULLIF(TRIM(p_entity_type), ''),
    NULLIF(TRIM(COALESCE(p_entity_id, '')), ''),
    COALESCE(NULLIF(TRIM(p_summary), ''), 'Ação registrada'),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO created_id;

  RETURN created_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_audit_log(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_audit_log(text, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs(p_retention_days integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.audit_logs
  WHERE created_at < now() - make_interval(days => GREATEST(p_retention_days, 30));

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_audit_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_audit_logs(integer) TO authenticated;

DO $$
DECLARE
  job_exists boolean;
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = $1)'
    INTO job_exists
    USING 'cleanup_old_audit_logs_180d';

    IF job_exists THEN
      EXECUTE 'SELECT cron.unschedule($1)'
      USING 'cleanup_old_audit_logs_180d';
    END IF;

    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
    USING
      'cleanup_old_audit_logs_180d',
      '24 3 * * *',
      'SELECT public.cleanup_old_audit_logs(180);';
  END IF;
EXCEPTION
  WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
    NULL;
END;
$$;
