-- Control iD events are now broadcast-only for the dashboard.
-- Keep the legacy table for compatibility with older deployments, but clear
-- stored device noise and remove it from Realtime publication.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'controlid_logs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.controlid_logs';
  END IF;
END $$;

TRUNCATE TABLE public.controlid_logs;

COMMENT ON TABLE public.controlid_logs IS
  'Legacy table. Control iD dashboard events are broadcast-only and should not be persisted here.';
