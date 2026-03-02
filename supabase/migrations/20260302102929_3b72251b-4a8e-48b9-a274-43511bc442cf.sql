CREATE POLICY "Staff can delete checks"
ON public.shift_equipment_checks
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'security_guard'::app_role)
  OR has_role(auth.uid(), 'receptionist'::app_role)
);