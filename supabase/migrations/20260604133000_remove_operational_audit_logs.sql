-- Remove the operational audit feature. Access logs remain the source of truth.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE 'SELECT cron.unschedule(''cleanup_old_audit_logs_180d'')';
    EXCEPTION
      WHEN undefined_function OR undefined_object THEN
        NULL;
    END;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.cleanup_old_audit_logs(integer);
DROP FUNCTION IF EXISTS public.record_audit_log(text, text, text, text, jsonb);

DROP TABLE IF EXISTS public.audit_logs;
