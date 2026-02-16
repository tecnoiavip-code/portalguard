
-- Create a trigger function to auto-notify staff when a resident sends a chat message
CREATE OR REPLACE FUNCTION public.notify_staff_on_resident_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only notify for resident messages
  IF NEW.sender_type = 'resident' THEN
    INSERT INTO public.notifications (user_id, title, body, type, related_id)
    SELECT ur.user_id, 'Nova mensagem de morador', LEFT(NEW.message, 100), 'chat', NEW.resident_id
    FROM public.user_roles ur
    WHERE ur.role IN ('admin', 'receptionist', 'security_guard');
  END IF;
  RETURN NEW;
END;
$function$;

-- Create the trigger
CREATE TRIGGER on_resident_chat_message
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_staff_on_resident_message();
