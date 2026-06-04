-- Enforce uppercase text for visitor/provider access records.

CREATE OR REPLACE FUNCTION public.uppercase_access_entry_text()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.visitor_name := upper(NEW.visitor_name);
  NEW.visitor_document := upper(NEW.visitor_document);
  NEW.resident_name := upper(NEW.resident_name);
  NEW.apartment := upper(NEW.apartment);
  NEW.purpose := upper(NEW.purpose);
  NEW.vehicle_plate := upper(NEW.vehicle_plate);
  NEW.vehicle_model := upper(NEW.vehicle_model);
  NEW.vehicle_color := upper(NEW.vehicle_color);
  NEW.company := upper(NEW.company);
  NEW.badge_number := upper(NEW.badge_number);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uppercase_access_entry_text ON public.access_entries;
CREATE TRIGGER trg_uppercase_access_entry_text
BEFORE INSERT OR UPDATE ON public.access_entries
FOR EACH ROW
EXECUTE FUNCTION public.uppercase_access_entry_text();

UPDATE public.access_entries
SET
  visitor_name = upper(visitor_name),
  visitor_document = upper(visitor_document),
  resident_name = upper(resident_name),
  apartment = upper(apartment),
  purpose = upper(purpose),
  vehicle_plate = upper(vehicle_plate),
  vehicle_model = upper(vehicle_model),
  vehicle_color = upper(vehicle_color),
  company = upper(company),
  badge_number = upper(badge_number);
