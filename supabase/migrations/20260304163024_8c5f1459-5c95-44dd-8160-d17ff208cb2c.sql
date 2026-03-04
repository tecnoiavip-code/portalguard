
CREATE OR REPLACE FUNCTION public.auto_validate_guest_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When a new access entry is created, check if there's a matching pending visitor authorization
  -- Match by visitor name (case-insensitive) and authorized_date = today
  UPDATE public.visitor_authorizations
  SET status = 'approved', updated_at = now()
  WHERE status = 'pending'
    AND authorized_date = CURRENT_DATE
    AND LOWER(TRIM(visitor_name)) = LOWER(TRIM(NEW.visitor_name));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_validate_guest_list
AFTER INSERT ON public.access_entries
FOR EACH ROW
EXECUTE FUNCTION public.auto_validate_guest_list();
