-- Reduce auth/notification load and make resident badge counters cheap.

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role
ON public.user_roles (user_id, role);

CREATE INDEX IF NOT EXISTS idx_residents_auth_user_id
ON public.residents (auth_user_id)
WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
ON public.notifications (user_id, created_at DESC)
WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_chat_messages_resident_staff_unread
ON public.chat_messages (resident_id, created_at DESC)
WHERE sender_type = 'staff' AND read = false;

CREATE INDEX IF NOT EXISTS idx_mails_resident_pending
ON public.mails (resident_id, received_at DESC)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user_announcement
ON public.announcement_reads (user_id, announcement_id);

CREATE INDEX IF NOT EXISTS idx_access_entries_recent
ON public.access_entries (entry_time DESC);

CREATE INDEX IF NOT EXISTS idx_access_entries_active
ON public.access_entries (entry_time DESC)
WHERE exit_time IS NULL;

CREATE OR REPLACE FUNCTION public.get_resident_badge_counts()
RETURNS TABLE (
  chat integer,
  notif integer,
  mails integer,
  announcements integer,
  resident_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_resident_id uuid;
BEGIN
  IF current_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id
  INTO current_resident_id
  FROM public.residents
  WHERE auth_user_id = current_user_id
  LIMIT 1;

  IF current_resident_id IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (
      SELECT count(*)::integer
      FROM public.chat_messages
      WHERE resident_id = current_resident_id
        AND sender_type = 'staff'
        AND read = false
    ) AS chat,
    (
      SELECT count(*)::integer
      FROM public.notifications
      WHERE user_id = current_user_id
        AND read = false
    ) AS notif,
    (
      SELECT count(*)::integer
      FROM public.mails
      WHERE resident_id = current_resident_id
        AND status = 'pending'
    ) AS mails,
    GREATEST(
      0,
      (
        SELECT count(*)::integer
        FROM public.announcements
      ) - (
        SELECT count(*)::integer
        FROM public.announcement_reads
        WHERE user_id = current_user_id
      )
    ) AS announcements,
    current_resident_id AS resident_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_resident_badge_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resident_badge_counts() TO authenticated;
