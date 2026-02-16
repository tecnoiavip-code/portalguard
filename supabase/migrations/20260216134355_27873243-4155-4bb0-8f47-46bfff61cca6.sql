
-- Table to store Web Push subscriptions
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own subscriptions"
ON public.push_subscriptions
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Table to store VAPID keys (generated once)
CREATE TABLE public.vapid_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vapid_keys ENABLE ROW LEVEL SECURITY;

-- Only service role can access VAPID keys (edge functions)
-- Public key needs to be readable by authenticated users
CREATE POLICY "Authenticated can read public key"
ON public.vapid_keys
FOR SELECT
USING (auth.role() = 'authenticated');

-- Enable realtime for notifications to trigger push
ALTER PUBLICATION supabase_realtime ADD TABLE public.push_subscriptions;
