DROP POLICY IF EXISTS "Staff can insert equipment" ON public.portaria_equipment;
CREATE POLICY "Staff can insert equipment"
ON public.portaria_equipment
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);

DROP POLICY IF EXISTS "Staff can update equipment" ON public.portaria_equipment;
CREATE POLICY "Staff can update equipment"
ON public.portaria_equipment
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);
