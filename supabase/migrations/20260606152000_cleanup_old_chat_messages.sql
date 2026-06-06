-- Keep resident chat history bounded on the Supabase free plan.
-- The staff/resident chat remains useful for recent operations, while old
-- conversation records are removed by the existing daily retention job.

CREATE INDEX IF NOT EXISTS idx_chat_messages_retention
ON public.chat_messages (created_at);

DROP FUNCTION IF EXISTS public.cleanup_old_access_logs(integer);

CREATE OR REPLACE FUNCTION public.cleanup_old_access_logs(retention_days integer DEFAULT 45)
RETURNS TABLE (
  access_entries_deleted bigint,
  controlid_logs_deleted bigint,
  push_commands_deleted bigint,
  chat_messages_deleted bigint
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

  DELETE FROM public.chat_messages
  WHERE created_at IS NOT NULL
    AND created_at < access_cutoff;
  GET DIAGNOSTICS chat_messages_deleted = ROW_COUNT;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_access_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_access_logs(integer) TO service_role;

SELECT public.cleanup_old_access_logs(45);
