-- Keep access/history logs from overloading the database.
-- Completed access entries and technical Control iD logs older than 45 days are
-- removed by a daily pg_cron job. Active visitors/providers are preserved.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_access_entries_completed_retention
ON public.access_entries (entry_time)
WHERE exit_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_controlid_logs_retention
ON public.controlid_logs (received_at);

DO $$
BEGIN
  IF to_regclass('public.push_command_queue') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_push_command_queue_retention
      ON public.push_command_queue (created_at)
      WHERE status <> ''pending''';
  END IF;
END;
$$;

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
  cutoff timestamptz;
BEGIN
  IF retention_days IS NULL OR retention_days < 1 THEN
    RAISE EXCEPTION 'retention_days must be greater than zero';
  END IF;

  cutoff := now() - make_interval(days => retention_days);

  DELETE FROM public.access_entries
  WHERE entry_time < cutoff
    AND exit_time IS NOT NULL;
  GET DIAGNOSTICS access_entries_deleted = ROW_COUNT;

  DELETE FROM public.controlid_logs
  WHERE received_at < cutoff;
  GET DIAGNOSTICS controlid_logs_deleted = ROW_COUNT;

  push_commands_deleted := 0;
  IF to_regclass('public.push_command_queue') IS NOT NULL THEN
    DELETE FROM public.push_command_queue
    WHERE created_at < cutoff
      AND status <> 'pending';
    GET DIAGNOSTICS push_commands_deleted = ROW_COUNT;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_access_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_access_logs(integer) TO service_role;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'cleanup_old_access_logs_45d'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
END;
$$;

SELECT cron.schedule(
  'cleanup_old_access_logs_45d',
  '20 3 * * *',
  $$SELECT public.cleanup_old_access_logs(45);$$
);

SELECT public.cleanup_old_access_logs(45);
