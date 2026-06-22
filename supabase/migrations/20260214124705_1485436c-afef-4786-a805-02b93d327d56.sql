
-- Announcements table
CREATE TABLE public.announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Staff can do everything
CREATE POLICY "Staff can manage announcements"
  ON public.announcements FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  );

-- Residents can view
CREATE POLICY "Residents can view announcements"
  ON public.announcements FOR SELECT
  USING (has_role(auth.uid(), 'resident'::app_role));

-- Announcement attachments metadata
CREATE TABLE public.announcement_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  content_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.announcement_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage attachments"
  ON public.announcement_attachments FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  );

CREATE POLICY "Residents can view attachments"
  ON public.announcement_attachments FOR SELECT
  USING (has_role(auth.uid(), 'resident'::app_role));

-- Read confirmations
CREATE TABLE public.announcement_reads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(announcement_id, user_id)
);

ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reads"
  ON public.announcement_reads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reads"
  ON public.announcement_reads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Staff can view all reads"
  ON public.announcement_reads FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  );

-- Update trigger
CREATE TRIGGER update_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for announcement files
INSERT INTO storage.buckets (id, name, public) VALUES ('announcement-files', 'announcement-files', true);

-- Storage policies
CREATE POLICY "Staff can upload announcement files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'announcement-files' AND (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  ));

CREATE POLICY "Anyone can view announcement files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'announcement-files');

CREATE POLICY "Staff can delete announcement files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'announcement-files' AND (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role)
  ));

-- Enable realtime for announcements
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
