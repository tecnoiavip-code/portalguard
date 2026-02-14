
CREATE TABLE public.blocked_visitors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_name TEXT NOT NULL,
  visitor_document TEXT NOT NULL,
  reason TEXT,
  blocked_by UUID,
  blocked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.blocked_visitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view blocked visitors"
ON public.blocked_visitors FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can insert blocked visitors"
ON public.blocked_visitors FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can update blocked visitors"
ON public.blocked_visitors FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));

CREATE POLICY "Staff can delete blocked visitors"
ON public.blocked_visitors FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'security_guard'::app_role));
