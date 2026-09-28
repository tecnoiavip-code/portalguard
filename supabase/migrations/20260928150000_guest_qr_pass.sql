-- ============================================================================
-- Convite Virtual com QR Code Temporário
-- - Colunas de token/uso em visitor_authorizations
-- - RPCs validate_guest_pass / redeem_guest_pass / update_guest_pass
-- ============================================================================

-- 1) Novas colunas -----------------------------------------------------------
ALTER TABLE public.visitor_authorizations
  ADD COLUMN IF NOT EXISTS qr_code_token uuid UNIQUE DEFAULT gen_random_uuid();
ALTER TABLE public.visitor_authorizations
  ADD COLUMN IF NOT EXISTS entry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.visitor_authorizations
  ADD COLUMN IF NOT EXISTS single_use boolean NOT NULL DEFAULT true;
ALTER TABLE public.visitor_authorizations
  ADD COLUMN IF NOT EXISTS used_at timestamptz;
ALTER TABLE public.visitor_authorizations
  ADD COLUMN IF NOT EXISTS vehicle_model text;

-- Token para registros existentes (que ficaram NULL antes do default)
UPDATE public.visitor_authorizations
   SET qr_code_token = gen_random_uuid()
 WHERE qr_code_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_visitor_auth_token
  ON public.visitor_authorizations (qr_code_token);

-- 2) validate_guest_pass ------------------------------------------------------
-- Página pública do convidado (anon) e prévia da portaria.
-- Só retorna documento/nome do morador para staff autenticado.
CREATE OR REPLACE FUNCTION public.validate_guest_pass(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_visitor_name text;
  v_visitor_document text;
  v_apartment text;
  v_resident_id uuid;
  v_resident_name text;
  v_purpose text;
  v_authorized_date date;
  v_authorized_until date;
  v_vehicle_plate text;
  v_single_use boolean;
  v_used_at timestamptz;
  v_entry_count integer;
  v_status text;
  v_is_staff boolean;
  v_checkin_allowed boolean := false;
  v_reason text := null;
BEGIN
  v_is_staff :=
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'security_guard'::app_role) OR
    has_role(auth.uid(), 'receptionist'::app_role);

  SELECT va.id, va.visitor_name, va.visitor_document, r.apartment,
         va.resident_id, r.name, va.purpose,
         va.authorized_date, va.authorized_until, va.vehicle_plate,
         va.single_use, va.used_at, va.entry_count, va.status
    INTO v_id, v_visitor_name, v_visitor_document, v_apartment,
         v_resident_id, v_resident_name, v_purpose,
         v_authorized_date, v_authorized_until, v_vehicle_plate,
         v_single_use, v_used_at, v_entry_count, v_status
    FROM public.visitor_authorizations va
    LEFT JOIN public.residents r ON r.id = va.resident_id
   WHERE va.qr_code_token = _token;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false, 'valid', false, 'status', 'not_found',
      'reason', 'Convite não encontrado'
    );
  END IF;

  IF v_status = 'rejected' THEN
    v_status := 'rejected'; v_reason := 'Convite rejeitado';
    RETURN jsonb_build_object('found', true, 'valid', false, 'status', 'rejected', 'reason', v_reason);
  ELSIF v_single_use AND v_used_at IS NOT NULL THEN
    v_status := 'used'; v_reason := 'Convite já utilizado';
  ELSIF CURRENT_DATE < v_authorized_date THEN
    v_status := 'future'; v_reason := 'Autorizado para data futura';
  ELSIF CURRENT_DATE > COALESCE(v_authorized_until, v_authorized_date) THEN
    v_status := 'expired'; v_reason := 'Convite expirado';
  ELSE
    v_status := 'today'; v_checkin_allowed := true;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'valid', v_checkin_allowed,
    'status', v_status,
    'reason', v_reason,
    'visitor_name', v_visitor_name,
    'apartment', v_apartment,
    'authorized_date', to_char(v_authorized_date, 'YYYY-MM-DD'),
    'authorized_until', COALESCE(to_char(v_authorized_until, 'YYYY-MM-DD'), to_char(v_authorized_date, 'YYYY-MM-DD')),
    'purpose', v_purpose,
    'vehicle_plate', v_vehicle_plate,
    'single_use', v_single_use,
    'used_at', v_used_at,
    'entry_count', v_entry_count,
    'visitor_document', CASE WHEN v_is_staff THEN v_visitor_document ELSE NULL END,
    'resident_id', CASE WHEN v_is_staff THEN v_resident_id ELSE NULL END,
    'resident_name', CASE WHEN v_is_staff THEN v_resident_name ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_guest_pass(uuid) TO anon, authenticated;

-- 3) update_guest_pass --------------------------------------------------------
-- Convidado informa veículo (pré-check-in) OU o morador alterna uso único/dia todo.
CREATE OR REPLACE FUNCTION public.update_guest_pass(
  _token uuid,
  _vehicle_plate text DEFAULT NULL,
  _vehicle_model text DEFAULT NULL,
  _single_use boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_resident_id uuid;
  v_is_owner boolean := false;
BEGIN
  SELECT id, resident_id INTO v_id, v_resident_id
    FROM public.visitor_authorizations WHERE qr_code_token = _token;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Convite não encontrado');
  END IF;

  -- Troca de modo (uso único / dia todo): somente o morador responsável
  IF _single_use IS NOT NULL THEN
    IF NOT (has_role(auth.uid(), 'resident'::app_role)) THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Somente o morador pode alterar o modo do convite');
    END IF;
    SELECT EXISTS(
      SELECT 1 FROM public.residents r
       WHERE r.id = v_resident_id AND r.auth_user_id = auth.uid()
    ) INTO v_is_owner;
    IF NOT v_is_owner THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Este convite não pertence ao seu apartamento');
    END IF;
    UPDATE public.visitor_authorizations
       SET single_use = _single_use, updated_at = now()
     WHERE id = v_id;
  END IF;

  -- Pré-check-in do convidado: dados do veículo (o token é a credencial do portador)
  IF _vehicle_plate IS NOT NULL OR _vehicle_model IS NOT NULL THEN
    UPDATE public.visitor_authorizations
       SET vehicle_plate = COALESCE(_vehicle_plate, vehicle_plate),
           vehicle_model = COALESCE(_vehicle_model, vehicle_model),
           updated_at = now()
     WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_guest_pass(uuid, text, text, boolean) TO anon, authenticated;

-- 4) redeem_guest_pass --------------------------------------------------------
-- Check-in na portaria: valida, cria access_entries, atualiza convite e
-- notifica o morador.
CREATE OR REPLACE FUNCTION public.redeem_guest_pass(
  _token uuid,
  _vehicle_plate text DEFAULT NULL,
  _vehicle_model text DEFAULT NULL,
  _photo_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_visitor_name text;
  v_visitor_document text;
  v_purpose text;
  v_resident_id uuid;
  v_resident_name text;
  v_apartment text;
  v_authorized_date date;
  v_authorized_until date;
  v_vehicle_plate text;
  v_vehicle_model text;
  v_status text;
  v_single_use boolean;
  v_used_at timestamptz;
  v_entry_id uuid;
  v_blocked boolean := false;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR
          has_role(auth.uid(), 'security_guard'::app_role) OR
          has_role(auth.uid(), 'receptionist'::app_role)) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Acesso negado');
  END IF;

  SELECT va.id, va.visitor_name, va.visitor_document, va.purpose,
         va.resident_id, r.name, r.apartment,
         va.authorized_date, va.authorized_until,
         va.vehicle_plate, va.vehicle_model,
         va.status, va.single_use, va.used_at
    INTO v_id, v_visitor_name, v_visitor_document, v_purpose,
         v_resident_id, v_resident_name, v_apartment,
         v_authorized_date, v_authorized_until,
         v_vehicle_plate, v_vehicle_model,
         v_status, v_single_use, v_used_at
    FROM public.visitor_authorizations va
    LEFT JOIN public.residents r ON r.id = va.resident_id
   WHERE va.qr_code_token = _token;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Convite não encontrado');
  END IF;
  IF v_status = 'rejected' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Convite rejeitado');
  END IF;
  IF v_single_use AND v_used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Convite já utilizado');
  END IF;
  IF CURRENT_DATE < v_authorized_date THEN
    RETURN jsonb_build_object('ok', false, 'message', format('Convite válido a partir de %s', to_char(v_authorized_date, 'DD/MM/YYYY')));
  END IF;
  IF CURRENT_DATE > COALESCE(v_authorized_until, v_authorized_date) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Convite expirado');
  END IF;

  -- Lista de restrição (bloqueados)
  IF v_visitor_document IS NOT NULL AND v_visitor_document <> '' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.blocked_visitors b
       WHERE b.visitor_document = v_visitor_document AND b.is_active
    ) INTO v_blocked;
    IF v_blocked THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Visitante está na lista de bloqueio');
    END IF;
  END IF;

  INSERT INTO public.access_entries (
    visitor_name, visitor_document, visitor_type, resident_id, resident_name,
    apartment, purpose, entry_time, exit_time,
    vehicle_plate, vehicle_model, photo_url, registered_by
  ) VALUES (
    v_visitor_name, COALESCE(v_visitor_document, ''), 'visitor', v_resident_id, v_resident_name,
    v_apartment, v_purpose, now(), NULL,
    COALESCE(NULLIF(_vehicle_plate, ''), v_vehicle_plate),
    COALESCE(NULLIF(_vehicle_model, ''), v_vehicle_model),
    _photo_url, auth.uid()
  )
  RETURNING id INTO v_entry_id;

  UPDATE public.visitor_authorizations
     SET entry_count = entry_count + 1,
         used_at = now(),
         status = CASE WHEN single_use THEN 'expired'::text ELSE status END,
         updated_at = now()
   WHERE id = v_id;

  -- Notifica o morador (in-app; o realtime entrega ao portal do morador)
  INSERT INTO public.notifications (user_id, title, body, type, related_id)
  SELECT r.auth_user_id, '🚪 Visita autorizada chegou',
         format('%s entrou no condomínio (convite QR)', v_visitor_name),
         'visitor', v_entry_id
    FROM public.residents r
   WHERE r.id = v_resident_id AND r.auth_user_id IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true, 'entry_id', v_entry_id,
    'visitor_name', v_visitor_name,
    'visitor_document', v_visitor_document,
    'resident_name', v_resident_name,
    'apartment', v_apartment,
    'vehicle_plate', COALESCE(NULLIF(_vehicle_plate, ''), v_vehicle_plate)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_guest_pass(uuid, text, text, text) TO authenticated;