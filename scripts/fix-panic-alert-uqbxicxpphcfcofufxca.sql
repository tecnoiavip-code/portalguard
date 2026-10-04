-- Apply to the uqbxicxpphcfcofufxca database. "panic" is not an allowed
-- notifications.type value; use "general" so notifications do not roll back the alert.
CREATE OR REPLACE FUNCTION public.trigger_panic_alert(_location text DEFAULT 'other')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  new_id uuid;
  loc text := CASE WHEN _location IN ('apartment','garage','entrance','other') THEN _location ELSE 'other' END;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT id, name, apartment, phone, photo_url INTO r
  FROM public.residents WHERE auth_user_id = auth.uid() LIMIT 1;
  IF r.id IS NULL THEN RAISE EXCEPTION 'resident not found'; END IF;

  SELECT id INTO new_id FROM public.panic_alerts
  WHERE user_id = auth.uid() AND status = 'active'
    AND created_at > now() - interval '2 minutes' LIMIT 1;
  IF new_id IS NOT NULL THEN RETURN new_id; END IF;

  INSERT INTO public.panic_alerts (resident_id, user_id, apartment, resident_name, resident_phone, resident_photo_url, location_context)
  VALUES (r.id, auth.uid(), r.apartment, r.name, r.phone, r.photo_url, loc)
  RETURNING id INTO new_id;

  INSERT INTO public.notifications (user_id, title, body, type, related_id)
  SELECT DISTINCT ur.user_id, 'ALERTA DE COAÇÃO',
    'APT ' || coalesce(r.apartment,'?') || ' - ' || r.name, 'general', new_id
  FROM public.user_roles ur
  WHERE ur.role IN ('admin','receptionist','security_guard');
  RETURN new_id;
END; $$;

REVOKE ALL ON FUNCTION public.trigger_panic_alert(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trigger_panic_alert(text) TO authenticated;