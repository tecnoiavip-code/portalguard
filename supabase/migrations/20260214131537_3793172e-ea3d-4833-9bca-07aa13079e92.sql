
-- Drop existing RESTRICTIVE policies on residents
DROP POLICY IF EXISTS "Admins can delete residents" ON public.residents;
DROP POLICY IF EXISTS "Admins can insert residents" ON public.residents;
DROP POLICY IF EXISTS "Admins can update residents" ON public.residents;
DROP POLICY IF EXISTS "Authorized staff can view residents" ON public.residents;
DROP POLICY IF EXISTS "Residents can view own data" ON public.residents;

-- Recreate as PERMISSIVE policies
CREATE POLICY "Admins can insert residents"
ON public.residents FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update residents"
ON public.residents FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete residents"
ON public.residents FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authorized staff can view residents"
ON public.residents FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role));

CREATE POLICY "Residents can view own data"
ON public.residents FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'resident'::app_role) AND auth_user_id = auth.uid());

-- Also fix access_entries policies (same issue)
DROP POLICY IF EXISTS "Security staff can insert entries" ON public.access_entries;
DROP POLICY IF EXISTS "Security staff can update entries" ON public.access_entries;
DROP POLICY IF EXISTS "Security staff can view entries" ON public.access_entries;
DROP POLICY IF EXISTS "Residents can view own access entries" ON public.access_entries;

CREATE POLICY "Security staff can insert entries"
ON public.access_entries FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Security staff can update entries"
ON public.access_entries FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Security staff can view entries"
ON public.access_entries FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Residents can view own access entries"
ON public.access_entries FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'resident'::app_role) AND apartment IN (
  SELECT residents.apartment FROM residents WHERE residents.auth_user_id = auth.uid()
));

-- Fix mails policies
DROP POLICY IF EXISTS "Admins can delete mails" ON public.mails;
DROP POLICY IF EXISTS "Authorized staff can insert mails" ON public.mails;
DROP POLICY IF EXISTS "Authorized staff can update mails" ON public.mails;
DROP POLICY IF EXISTS "Authorized staff can view mails" ON public.mails;
DROP POLICY IF EXISTS "Residents can view own mails" ON public.mails;

CREATE POLICY "Admins can delete mails"
ON public.mails FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authorized staff can insert mails"
ON public.mails FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role));

CREATE POLICY "Authorized staff can update mails"
ON public.mails FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role));

CREATE POLICY "Authorized staff can view mails"
ON public.mails FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'receptionist'::app_role));

CREATE POLICY "Residents can view own mails"
ON public.mails FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'resident'::app_role) AND resident_id IN (
  SELECT residents.id FROM residents WHERE residents.auth_user_id = auth.uid()
));

-- Fix devices policies
DROP POLICY IF EXISTS "Admins can manage devices" ON public.devices;

CREATE POLICY "Admins can manage devices"
ON public.devices FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Fix blocked_visitors policies
DROP POLICY IF EXISTS "Staff can view blocked visitors" ON public.blocked_visitors;
DROP POLICY IF EXISTS "Staff can insert blocked visitors" ON public.blocked_visitors;
DROP POLICY IF EXISTS "Staff can update blocked visitors" ON public.blocked_visitors;
DROP POLICY IF EXISTS "Staff can delete blocked visitors" ON public.blocked_visitors;

CREATE POLICY "Staff can view blocked visitors"
ON public.blocked_visitors FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can insert blocked visitors"
ON public.blocked_visitors FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can update blocked visitors"
ON public.blocked_visitors FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can delete blocked visitors"
ON public.blocked_visitors FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));
