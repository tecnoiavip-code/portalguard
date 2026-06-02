-- Keep short-lived operational records from growing indefinitely.
-- Unread notifications are preserved; only read notifications and internal
-- realtime events older than the retention window are removed.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_notifications_read_retention
ON public.notifications (created_at)
WHERE read = true;

CREATE INDEX IF NOT EXISTS idx_realtime_events_retention
ON public.realtime_events ((COALESCE("timestamp", created_at)));

CREATE OR REPLACE FUNCTION public.cleanup_old_operational_records(retention_days integer DEFAULT 45)
RETURNS TABLE (
  notifications_deleted bigint,
  realtime_events_deleted bigint
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

  DELETE FROM public.notifications
  WHERE read = true
    AND created_at < cutoff;
  GET DIAGNOSTICS notifications_deleted = ROW_COUNT;

  DELETE FROM public.realtime_events
  WHERE COALESCE("timestamp", created_at) < cutoff;
  GET DIAGNOSTICS realtime_events_deleted = ROW_COUNT;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_operational_records(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_operational_records(integer) TO service_role;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'cleanup_old_operational_records_45d'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
END;
$$;

SELECT cron.schedule(
  'cleanup_old_operational_records_45d',
  '40 3 * * *',
  $$SELECT public.cleanup_old_operational_records(45);$$
);

SELECT public.cleanup_old_operational_records(45);
