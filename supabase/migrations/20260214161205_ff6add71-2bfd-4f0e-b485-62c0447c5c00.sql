-- Add tracking_code and photo_url columns to mails table
ALTER TABLE public.mails ADD COLUMN tracking_code text;
ALTER TABLE public.mails ADD COLUMN photo_url text;