
CREATE POLICY "Residents can delete own pending authorizations"
ON public.visitor_authorizations
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'resident'::app_role)
  AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())
  AND status = 'pending'
);
