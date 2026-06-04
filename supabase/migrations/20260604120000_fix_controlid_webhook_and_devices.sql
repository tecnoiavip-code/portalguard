-- ============================================================
-- FIX: Control iD Webhook - Ensure correct schema
-- Date: 2026-06-04
-- ============================================================

-- 1. Ensure devices table has ip_address and serial_number columns
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS serial_number TEXT;

-- 2. Ensure push_command_queue exists with all required columns
CREATE TABLE IF NOT EXISTS public.push_command_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  command jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  executed_at timestamp with time zone,
  result jsonb DEFAULT NULL
);

-- Add result column if missing (for older installations)
ALTER TABLE public.push_command_queue ADD COLUMN IF NOT EXISTS result jsonb DEFAULT NULL;

-- 3. Indexes for performance
-- Fast lookup: pending commands per device (used on every heartbeat)
CREATE INDEX IF NOT EXISTS idx_push_queue_device_status
  ON public.push_command_queue (device_id, status)
  WHERE status = 'pending';

-- Fast lookup: executing commands per device (used to match results)
CREATE INDEX IF NOT EXISTS idx_push_queue_device_executing
  ON public.push_command_queue (device_id, status, created_at)
  WHERE status = 'executing';

-- Fast lookup: auto-expire stale commands
CREATE INDEX IF NOT EXISTS idx_push_queue_device_executed_at
  ON public.push_command_queue (device_id, executed_at)
  WHERE status = 'executing';

-- 4. Index for devices lookup by serial/ip (used by updateDeviceStatus)
CREATE INDEX IF NOT EXISTS idx_devices_serial_number
  ON public.devices (serial_number)
  WHERE serial_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_devices_ip_address
  ON public.devices (ip_address)
  WHERE ip_address IS NOT NULL;

-- 5. Ensure RLS is enabled
ALTER TABLE public.push_command_queue ENABLE ROW LEVEL SECURITY;

-- Drop existing policy before recreating to avoid conflicts
DROP POLICY IF EXISTS "Service role and admins can manage push queue" ON public.push_command_queue;

-- Service role (used by Edge Functions with SUPABASE_SERVICE_ROLE_KEY) bypasses RLS.
-- This policy covers anon/authenticated access for admin users.
CREATE POLICY "Admins can manage push queue"
  ON public.push_command_queue
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 6. Ensure controlid_logs has an index for device lookup
CREATE INDEX IF NOT EXISTS idx_controlid_logs_device_received
  ON public.controlid_logs (device_id, received_at DESC);

-- 7. Cleanup: mark old stuck 'executing' commands as error
-- (prevents queue blockage after server restart / redeploy)
UPDATE public.push_command_queue
SET status = 'error',
    result = jsonb_build_object(
      'error', 'stale_on_migration',
      'migrated_at', now()::text
    )
WHERE status = 'executing'
  AND executed_at < now() - interval '10 minutes';
