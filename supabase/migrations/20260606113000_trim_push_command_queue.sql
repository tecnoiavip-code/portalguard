-- Keep the Control iD push queue small on the Supabase free plan.
-- Pending commands are preserved. Finished/error commands are operational
-- artifacts and do not need the same retention as access history.

CREATE INDEX IF NOT EXISTS idx_push_command_queue_status_created_at
ON public.push_command_queue (status, created_at);

CREATE OR REPLACE FUNCTION public.cleanup_old_access_logs(retention_days integer DEFAULT 45)
RETURNS TABLE (
  access_entries_deleted bigint,
  controlid_logs_deleted bigint,
  push_commands_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  access_cutoff timestamptz;
  push_cutoff timestamptz;
BEGIN
  IF retention_days IS NULL OR retention_days < 1 THEN
    RAISE EXCEPTION 'retention_days must be greater than zero';
  END IF;

  access_cutoff := now() - make_interval(days => retention_days);
  push_cutoff := now() - interval '7 days';

  DELETE FROM public.access_entries
  WHERE entry_time < access_cutoff
    AND exit_time IS NOT NULL;
  GET DIAGNOSTICS access_entries_deleted = ROW_COUNT;

  DELETE FROM public.controlid_logs
  WHERE received_at < access_cutoff;
  GET DIAGNOSTICS controlid_logs_deleted = ROW_COUNT;

  push_commands_deleted := 0;
  IF to_regclass('public.push_command_queue') IS NOT NULL THEN
    DELETE FROM public.push_command_queue
    WHERE created_at < push_cutoff
      AND status <> 'pending';
    GET DIAGNOSTICS push_commands_deleted = ROW_COUNT;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_access_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_access_logs(integer) TO service_role;

DELETE FROM public.push_command_queue
WHERE status = 'error'
  AND created_at < now() - interval '5 minutes';
