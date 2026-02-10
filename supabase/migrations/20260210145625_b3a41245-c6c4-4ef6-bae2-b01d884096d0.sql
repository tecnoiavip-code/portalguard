
-- Tabela de mensagens de chat entre morador e portaria
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  sender_type text NOT NULL CHECK (sender_type IN ('resident', 'staff')),
  message text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view own chat" ON public.chat_messages
  FOR SELECT USING (
    (has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid()))
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'receptionist')
    OR has_role(auth.uid(), 'security_guard')
  );

CREATE POLICY "Residents can send messages" ON public.chat_messages
  FOR INSERT WITH CHECK (
    (has_role(auth.uid(), 'resident') AND sender_type = 'resident' AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid()))
    OR ((has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'receptionist') OR has_role(auth.uid(), 'security_guard')) AND sender_type = 'staff')
  );

CREATE POLICY "Users can update read status" ON public.chat_messages
  FOR UPDATE USING (
    (has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid()))
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'receptionist')
    OR has_role(auth.uid(), 'security_guard')
  );

-- Tabela de autorizações de visitantes pelo morador
CREATE TABLE public.visitor_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  visitor_name text NOT NULL,
  visitor_document text,
  authorized_date date NOT NULL,
  authorized_until date,
  purpose text,
  vehicle_plate text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  staff_notes text,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.visitor_authorizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents can view own authorizations" ON public.visitor_authorizations
  FOR SELECT USING (
    (has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid()))
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'receptionist')
    OR has_role(auth.uid(), 'security_guard')
  );

CREATE POLICY "Residents can create authorizations" ON public.visitor_authorizations
  FOR INSERT WITH CHECK (
    has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "Staff can update authorizations" ON public.visitor_authorizations
  FOR UPDATE USING (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'receptionist') OR has_role(auth.uid(), 'security_guard')
  );

-- Tabela de notificações
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL CHECK (type IN ('mail', 'visitor', 'authorization', 'chat', 'general')),
  related_id uuid,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Authenticated can insert notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Enable realtime for chat and notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger para updated_at
CREATE TRIGGER update_visitor_authorizations_updated_at
  BEFORE UPDATE ON public.visitor_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS para moradores verem seus próprios dados
CREATE POLICY "Residents can view own data" ON public.residents
  FOR SELECT USING (has_role(auth.uid(), 'resident') AND auth_user_id = auth.uid());

-- Moradores verem suas correspondências
CREATE POLICY "Residents can view own mails" ON public.mails
  FOR SELECT USING (
    has_role(auth.uid(), 'resident') AND resident_id IN (SELECT id FROM public.residents WHERE auth_user_id = auth.uid())
  );

-- Moradores verem visitas do seu apartamento
CREATE POLICY "Residents can view own access entries" ON public.access_entries
  FOR SELECT USING (
    has_role(auth.uid(), 'resident') AND apartment IN (SELECT apartment FROM public.residents WHERE auth_user_id = auth.uid())
  );
