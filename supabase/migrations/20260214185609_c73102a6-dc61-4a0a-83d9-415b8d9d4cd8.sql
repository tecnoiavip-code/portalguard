
-- 1. Fix controlid_logs INSERT policy (currently WITH CHECK (true) - too permissive)
DROP POLICY IF EXISTS "Service role can insert controlid logs" ON public.controlid_logs;
-- Edge function uses service role key, so we allow insert for authenticated or service role
-- but restrict to admin role for regular users
CREATE POLICY "Service role can insert controlid logs" ON public.controlid_logs
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR current_setting('request.jwt.claim.role', true) = 'service_role'
);

-- 2. Restrict controlid_logs SELECT to admins only (was all authenticated)
DROP POLICY IF EXISTS "Authenticated users can view controlid logs" ON public.controlid_logs;
CREATE POLICY "Admins can view controlid logs" ON public.controlid_logs
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. Restrict incidents SELECT to admins + reporter only
DROP POLICY IF EXISTS "Authenticated users can view incidents" ON public.incidents;
CREATE POLICY "Admins and reporters can view incidents" ON public.incidents
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR (reported_by = auth.uid())
);

-- 4. Restrict incidents management to admin/security only (was all authenticated)
DROP POLICY IF EXISTS "Staff can manage incidents" ON public.incidents;
CREATE POLICY "Staff can insert incidents" ON public.incidents
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
);
CREATE POLICY "Staff can update incidents" ON public.incidents
FOR UPDATE USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
);
CREATE POLICY "Admins can delete incidents" ON public.incidents
FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- 5. Restrict shifts management to admin/security (was all authenticated)
DROP POLICY IF EXISTS "Authenticated users can view shifts" ON public.shifts;
DROP POLICY IF EXISTS "Staff can manage shifts" ON public.shifts;
CREATE POLICY "Staff can view shifts" ON public.shifts
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);
CREATE POLICY "Admins can manage shifts" ON public.shifts
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 6. Restrict vehicles to staff roles (was all authenticated)
DROP POLICY IF EXISTS "Authenticated users can view vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Staff can delete vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Staff can insert vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Staff can update vehicles" ON public.vehicles;
CREATE POLICY "Staff can view vehicles" ON public.vehicles
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);
CREATE POLICY "Admins can manage vehicles" ON public.vehicles
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 7. Restrict realtime_events to staff roles
DROP POLICY IF EXISTS "Authenticated users can view events" ON public.realtime_events;
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.realtime_events;
CREATE POLICY "Staff can view events" ON public.realtime_events
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);
CREATE POLICY "Staff can insert events" ON public.realtime_events
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);
