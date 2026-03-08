CREATE OR REPLACE FUNCTION public.notify_all_staff(
  _title text,
  _body text,
  _type text,
  _related_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, body, type, related_id)
  SELECT ur.user_id, _title, _body, _type, _related_id
  FROM public.user_roles ur
  WHERE ur.role IN ('admin', 'receptionist', 'security_guard');
END;
$$;