CREATE POLICY "Admins can delete access entries"
ON public.access_entries
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));