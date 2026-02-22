-- Add ip_address column to devices table
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS ip_address text;