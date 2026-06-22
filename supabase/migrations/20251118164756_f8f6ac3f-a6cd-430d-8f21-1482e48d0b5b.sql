-- ==========================================
-- SECURITY FIX: Restrict RLS policies to appropriate roles
-- ==========================================

-- 1. FIX RESIDENTS TABLE - Restrict to admin, manager, receptionist roles
DROP POLICY IF EXISTS "Authenticated users can view residents" ON residents;

CREATE POLICY "Authorized staff can view residents"
ON residents FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'receptionist'::app_role)
);

-- Keep existing admin policies for insert/update/delete
-- (Already properly restricted to admins)

-- 2. FIX MAILS TABLE - Restrict to reception staff and admins
DROP POLICY IF EXISTS "Authenticated users can view mails" ON mails;
DROP POLICY IF EXISTS "Staff can insert mails" ON mails;
DROP POLICY IF EXISTS "Staff can update mails" ON mails;

CREATE POLICY "Authorized staff can view mails"
ON mails FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'receptionist'::app_role)
);

CREATE POLICY "Authorized staff can insert mails"
ON mails FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'receptionist'::app_role)
);

CREATE POLICY "Authorized staff can update mails"
ON mails FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'receptionist'::app_role)
);

-- ADD MISSING DELETE POLICY for mails
CREATE POLICY "Admins can delete mails"
ON mails FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. FIX ACCESS ENTRIES TABLE - Restrict to security staff
DROP POLICY IF EXISTS "Authenticated users can view entries" ON access_entries;
DROP POLICY IF EXISTS "Staff can insert entries" ON access_entries;
DROP POLICY IF EXISTS "Staff can update entries" ON access_entries;

CREATE POLICY "Security staff can view entries"
ON access_entries FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'security_guard'::app_role)
);

CREATE POLICY "Security staff can insert entries"
ON access_entries FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'security_guard'::app_role)
);

CREATE POLICY "Security staff can update entries"
ON access_entries FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'security_guard'::app_role)
);

-- 4. FIX OTHER TABLES - Keep current policies but document them

-- SHIFTS: Already properly restricted to authenticated users (keep as is)
-- INCIDENTS: Already properly restricted to authenticated users (keep as is)
-- DEVICES: Already properly restricted to admins (keep as is)
-- VEHICLES: Already properly restricted to authenticated users (keep as is)
-- REALTIME_EVENTS: Already properly restricted to authenticated users (keep as is)
-- CONTROLID_LOGS: Already has service role insert (keep as is)
-- CONTROLID_CONFIG: Already restricted to admins (keep as is)