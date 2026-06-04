-- Reduce webhook/device query cost for Control iD push mode.
-- These indexes match the queue/status lookups executed on every device poll.

CREATE INDEX IF NOT EXISTS idx_devices_ip_address
ON public.devices (ip_address)
WHERE ip_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_controlid_config_device_id
ON public.controlid_config (device_id)
WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_controlid_logs_device_received_at
ON public.controlid_logs (device_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_command_queue_pending_dispatch
ON public.push_command_queue (device_id, created_at)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_push_command_queue_executing_dispatch
ON public.push_command_queue (device_id, created_at)
WHERE status = 'executing';

CREATE INDEX IF NOT EXISTS idx_push_command_queue_executing_stale
ON public.push_command_queue (device_id, executed_at)
WHERE status = 'executing';

CREATE INDEX IF NOT EXISTS idx_push_command_queue_recent_active_config
ON public.push_command_queue (device_id, created_at DESC)
WHERE status IN ('done', 'pending', 'executing');
