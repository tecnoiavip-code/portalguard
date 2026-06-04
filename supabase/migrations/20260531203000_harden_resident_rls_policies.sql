-- Harden resident/staff RLS boundaries.
-- This migration is intentionally idempotent and replaces older broad policy names.

ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Residents can view own data" ON public.residents;
CREATE POLICY "Residents can view own data"
ON public.residents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'resident'::public.app_role)
  AND auth_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Residents can view own mails" ON public.mails;
CREATE POLICY "Residents can view own mails"
ON public.mails FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'resident'::public.app_role)
  AND EXISTS (
    SELECT 1
    FROM public.residents r
    WHERE r.id = mails.resident_id
      AND r.auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Residents can view own access entries" ON public.access_entries;
CREATE POLICY "Residents can view own access entries"
ON public.access_entries FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'resident'::public.app_role)
  AND EXISTS (
    SELECT 1
    FROM public.residents r
    WHERE r.auth_user_id = auth.uid()
      AND r.apartment = access_entries.apartment
  )
);

DROP POLICY IF EXISTS "Residents can view own chat" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can view chat messages" ON public.chat_messages;
CREATE POLICY "Users can view chat messages"
ON public.chat_messages FOR SELECT
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'resident'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.residents r
      WHERE r.id = chat_messages.resident_id
        AND r.auth_user_id = auth.uid()
    )
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
);

DROP POLICY IF EXISTS "Residents can send messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.chat_messages;
CREATE POLICY "Users can send messages"
ON public.chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  (
    public.has_role(auth.uid(), 'resident'::public.app_role)
    AND sender_type = 'resident'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.residents r
      WHERE r.id = chat_messages.resident_id
        AND r.auth_user_id = auth.uid()
    )
  )
  OR (
    sender_type = 'staff'
    AND sender_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
      OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
    )
  )
);

DROP POLICY IF EXISTS "Users can update read status" ON public.chat_messages;
CREATE POLICY "Users can update read status"
ON public.chat_messages FOR UPDATE
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'resident'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.residents r
      WHERE r.id = chat_messages.resident_id
        AND r.auth_user_id = auth.uid()
    )
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
)
WITH CHECK (
  (
    public.has_role(auth.uid(), 'resident'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.residents r
      WHERE r.id = chat_messages.resident_id
        AND r.auth_user_id = auth.uid()
    )
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
);

DROP POLICY IF EXISTS "Residents can view own authorizations" ON public.visitor_authorizations;
CREATE POLICY "Residents can view own authorizations"
ON public.visitor_authorizations FOR SELECT
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'resident'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.residents r
      WHERE r.id = visitor_authorizations.resident_id
        AND r.auth_user_id = auth.uid()
    )
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
);

DROP POLICY IF EXISTS "Residents can create authorizations" ON public.visitor_authorizations;
CREATE POLICY "Residents can create authorizations"
ON public.visitor_authorizations FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'resident'::public.app_role)
  AND status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM public.residents r
    WHERE r.id = visitor_authorizations.resident_id
      AND r.auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Staff can update authorizations" ON public.visitor_authorizations;
CREATE POLICY "Staff can update authorizations"
ON public.visitor_authorizations FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
);

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
ON public.notifications FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authorized staff can insert notifications" ON public.notifications;
CREATE POLICY "Authorized staff can insert notifications"
ON public.notifications FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
);

DROP POLICY IF EXISTS "Users can view own reads" ON public.announcement_reads;
CREATE POLICY "Users can view own reads"
ON public.announcement_reads FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own reads" ON public.announcement_reads;
CREATE POLICY "Users can insert own reads"
ON public.announcement_reads FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Staff can view all reads" ON public.announcement_reads;
CREATE POLICY "Staff can view all reads"
ON public.announcement_reads FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'receptionist'::public.app_role)
  OR public.has_role(auth.uid(), 'security_guard'::public.app_role)
);
