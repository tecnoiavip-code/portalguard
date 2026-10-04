-- Apply to uqbxicxpphcfcofufxca. The panic alert function inserts a
-- notification of type 'panic', which the old type check rejects and rolls
-- back the whole alert transaction.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('mail', 'visitor', 'authorization', 'chat', 'general', 'panic'));