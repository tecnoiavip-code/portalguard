
-- Table to persist push commands for Control iD devices (replaces in-memory queue)
CREATE TABLE public.push_command_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  command jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  executed_at timestamp with time zone
);

-- Index for fast lookup of pending commands per device
CREATE INDEX idx_push_queue_device_status ON public.push_command_queue (device_id, status) WHERE status = 'pending';

-- Enable RLS
ALTER TABLE public.push_command_queue ENABLE ROW LEVEL SECURITY;

-- Only service role (edge function) and admins can access
CREATE POLICY "Service role and admins can manage push queue"
  ON public.push_command_queue
  FOR ALL
  TO public
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR current_setting('request.jwt.claim.role', true) = 'service_role'
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR current_setting('request.jwt.claim.role', true) = 'service_role'
  );
