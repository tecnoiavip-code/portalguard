-- Extra indexes for the most frequent list/detail queries.
-- Keep these idempotent so they are safe on already optimized databases.

CREATE INDEX IF NOT EXISTS idx_residents_name
ON public.residents (name);

CREATE INDEX IF NOT EXISTS idx_residents_vehicle_model_not_null
ON public.residents (vehicle_model)
WHERE vehicle_model IS NOT NULL AND vehicle_model <> '';

CREATE INDEX IF NOT EXISTS idx_residents_vehicle_color_not_null
ON public.residents (vehicle_color)
WHERE vehicle_color IS NOT NULL AND vehicle_color <> '';

CREATE INDEX IF NOT EXISTS idx_access_entries_company_not_null
ON public.access_entries (company)
WHERE company IS NOT NULL AND company <> '';

CREATE INDEX IF NOT EXISTS idx_mails_received_at_desc
ON public.mails (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_visitor_authorizations_created_at_desc
ON public.visitor_authorizations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visitor_authorizations_resident_created_at
ON public.visitor_authorizations (resident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_created_at_desc
ON public.announcements (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcement_attachments_announcement_id
ON public.announcement_attachments (announcement_id);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement_id
ON public.announcement_reads (announcement_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_resident_created_at_desc
ON public.chat_messages (resident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shifts_shift_start_desc
ON public.shifts (shift_start DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_created_at_desc
ON public.incidents (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_equipment_checks_shift_id
ON public.shift_equipment_checks (shift_id);
