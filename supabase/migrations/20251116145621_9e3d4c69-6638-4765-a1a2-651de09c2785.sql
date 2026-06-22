-- Enable realtime on key tables for live updates
ALTER TABLE public.residents REPLICA IDENTITY FULL;
ALTER TABLE public.mails REPLICA IDENTITY FULL;
ALTER TABLE public.access_entries REPLICA IDENTITY FULL;
ALTER TABLE public.vehicles REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.residents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mails;
ALTER PUBLICATION supabase_realtime ADD TABLE public.access_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;