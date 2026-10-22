import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const STAFF_ROLES = new Set(['admin', 'security_guard', 'receptionist']);
const VISITOR_ACCESS_TYPES = ['visitor', 'service_provider', 'delivery'];
const REQUEST_TTL_MS = 300000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const normalizeDocument = (value: unknown) =>
  String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

const resolvePhotoUrl = async (admin: any, value: string | null) => {
  if (!value) return null;
  if (/^(data:|https?:)/i.test(value)) return value;
  const path = value.replace(/^\/+/, '');
  const { data } = await admin.storage.from('entry-photos').createSignedUrl(path, 3600);
  return data?.signedUrl || null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: { message: 'Method not allowed' } }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authorization = req.headers.get('Authorization') ?? '';
  if (!supabaseUrl || !serviceKey || !anonKey || !authorization) {
    return json({ error: { message: 'Não autenticado' } }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });

  try {
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: { message: 'Não autenticado' } }, 401);
    }

    const { data: roles } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    const isStaff = (roles || []).some((row: any) => STAFF_ROLES.has(row.role));
    if (!isStaff) {
      return json({ error: { message: 'Acesso restrito à portaria' } }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'list');
    const nowIso = new Date().toISOString();

    if (action === 'list') {
      const cutoff = new Date(Date.now() - REQUEST_TTL_MS).toISOString();
      await admin
        .from('facial_release_requests')
        .update({ status: 'expired', resolved_at: nowIso })
        .eq('status', 'pending')
        .lt('requested_at', cutoff);

      const { data: rows, error } = await admin
        .from('facial_release_requests')
        .select('*')
        .eq('status', 'pending')
        .order('requested_at', { ascending: false })
        .limit(20);
      if (error) {
        return json({ error: { message: 'Não foi possível listar os pedidos' } }, 500);
      }

      const retentionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await admin
        .from('facial_release_requests')
        .delete()
        .in('status', ['approved', 'denied', 'expired'])
        .lt('resolved_at', retentionCutoff);

      const photoIds = [...new Set((rows || [])
        .filter((row: any) => !row.photo_url && row.photo_entry_id)
        .map((row: any) => row.photo_entry_id))];
      const entryPhotos = new Map<string, string | null>();
      if (photoIds.length) {
        const { data: photos } = await admin
          .from('access_entries')
          .select('id, photo_url')
          .in('id', photoIds);
        (photos || []).forEach((photo: any) => entryPhotos.set(photo.id, photo.photo_url));
      }

      const requests = await Promise.all((rows || []).map(async (row: any) => ({
        ...row,
        photo_url: await resolvePhotoUrl(admin, row.photo_url || entryPhotos.get(row.photo_entry_id) || null),
      })));
      return json({ requests });
    }

    if (action !== 'approve' && action !== 'deny') {
      return json({ error: { message: 'Ação inválida' } }, 400);
    }

    const requestId = String(body?.request_id || '');
    if (!requestId) {
      return json({ error: { message: 'request_id é obrigatório' } }, 400);
    }

    const { data: request, error: requestError } = await admin
      .from('facial_release_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (requestError || !request) {
      return json({ error: { message: 'Pedido de liberação não encontrado' } }, 404);
    }
    if (request.status !== 'pending') {
      return json({ error: { message: 'Este pedido já foi resolvido' } }, 409);
    }

    const requestAge = Date.now() - Date.parse(request.requested_at);
    if (action === 'approve' && requestAge > REQUEST_TTL_MS) {
      await admin
        .from('facial_release_requests')
        .update({ status: 'expired', resolved_at: nowIso })
        .eq('id', requestId)
        .eq('status', 'pending');
      return json({ error: { message: 'Pedido expirado. Peça ao visitante para ler o rosto novamente.' } }, 409);
    }

    if (action === 'deny') {
      const { data: denied } = await admin
        .from('facial_release_requests')
        .update({ status: 'denied', resolved_at: nowIso, resolved_by: user.id })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (!denied) {
        return json({ error: { message: 'Este pedido já foi resolvido' } }, 409);
      }
      return json({ ok: true });
    }

    // ===== Aprovação: uma entrada + abertura remota =====
    let residentId: string | null = request.resident_id || null;
    let residentName: string | null = request.resident_name || null;
    let apartment: string = request.apartment || '';

    if (body?.resident_id) {
      const { data: resident } = await admin
        .from('residents')
        .select('id, name, apartment, person_type')
        .eq('id', String(body.resident_id))
        .maybeSingle();
      if (!resident) {
        return json({ error: { message: 'Morador selecionado não encontrado' } }, 400);
      }
      if (resident.person_type && resident.person_type !== 'morador') {
        return json({ error: { message: 'Selecione um morador para autorizar a entrada' } }, 400);
      }
      residentId = resident.id;
      residentName = resident.name;
      apartment = resident.apartment || '';
    } else if (body?.apartment) {
      apartment = String(body.apartment);
      residentId = null;
      residentName = body?.resident_name ? String(body.resident_name) : null;
    }

    if (!apartment) {
      return json({ error: { message: 'Informe o apartamento desta entrada' } }, 400);
    }
    if (residentId && !body?.resident_id) {
      const { data: linkedResident } = await admin
        .from('residents')
        .select('person_type')
        .eq('id', residentId)
        .maybeSingle();
      if (!linkedResident) {
        return json({ error: { message: 'Morador do pedido não encontrado; selecione um morador' } }, 400);
      }
      if (linkedResident.person_type && linkedResident.person_type !== 'morador') {
        return json({ error: { message: 'O pedido está vinculado a um colaborador; selecione um morador' } }, 400);
      }
    }

    const document = String(request.visitor_document || '');
    const normalizedDocument = normalizeDocument(document);
    if (normalizedDocument) {
      const { data: active } = await admin
        .from('access_entries')
        .select('id, visitor_name, apartment')
        .in('visitor_type', VISITOR_ACCESS_TYPES)
        .ilike('visitor_document', document)
        .is('exit_time', null)
        .limit(1)
        .maybeSingle();
      if (active) {
        return json({
          error: {
            message: `${active.visitor_name} já possui uma entrada ativa (${active.apartment}). Registre a saída antes de uma nova entrada.`,
          },
        }, 409);
      }
    }

    const { data: claimed } = await admin
      .from('facial_release_requests')
      .update({ status: 'approved', resolved_at: nowIso, resolved_by: user.id })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claimed) {
      return json({ error: { message: 'Este pedido já foi resolvido' } }, 409);
    }

    const entryPayload = {
      visitor_name: request.visitor_name,
      visitor_document: document,
      visitor_type: request.visitor_type || 'visitor',
      resident_id: residentId,
      resident_name: residentName,
      apartment,
      purpose: request.purpose || null,
      company: request.company || null,
      entry_time: nowIso,
      exit_time: null,
      vehicle_plate: request.vehicle_plate || null,
      vehicle_model: request.vehicle_model || null,
      vehicle_color: request.vehicle_color || null,
      photo_url: request.photo_url || null,
      auto_recognized: true,
      badge_number: request.badge_number || null,
      notes: 'Liberação facial autorizada pela portaria',
      registered_by: user.id,
    };

    const { data: entry, error: entryError } = await admin
      .from('access_entries')
      .insert(entryPayload)
      .select('id')
      .single();
    if (entryError || !entry) {
      await admin
        .from('facial_release_requests')
        .update({ status: 'pending', resolved_at: null, resolved_by: null })
        .eq('id', requestId)
        .eq('status', 'approved');
      console.error('Facial release entry error:', entryError);
      return json({ error: { message: 'Não foi possível registrar a entrada' } }, 500);
    }

    let deviceId: string | null = null;
    if (request.device_id) {
      const { data: device } = await admin
        .from('devices')
        .select('serial_number, ip_address')
        .or(`serial_number.eq.${request.device_id},ip_address.eq.${request.device_id}`)
        .limit(1)
        .maybeSingle();
      deviceId = device?.serial_number || request.device_id;
    }
    if (!deviceId) {
      const { data: device } = await admin
        .from('devices')
        .select('serial_number')
        .eq('type', 'facial_recognition')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      deviceId = device?.serial_number || null;
    }

    let remoteOpen = false;
    if (deviceId) {
      const relayAction = Deno.env.get('CONTROLID_RELAY_ACTION') === 'door' ? 'door' : 'sec_box';
      const command = {
        verb: 'POST',
        endpoint: 'execute_actions.fcgi',
        body: {
          actions: [{
            action: relayAction,
            parameters: relayAction === 'door' ? 'door=1' : 'id=65793, reason=1',
          }],
        },
        contentType: 'application/json',
      };
      const { error: queueError } = await admin
        .from('push_command_queue')
        .insert({ device_id: deviceId, command, status: 'pending' });

      if (queueError) {
        console.error('Facial release queue error:', queueError);
        await admin.from('access_entries').delete().eq('id', entry.id);
        await admin
          .from('facial_release_requests')
          .update({ status: 'pending', resolved_at: null, resolved_by: null, entry_id: null })
          .eq('id', requestId)
          .eq('status', 'approved');
        return json({ error: { message: 'Não foi possível acionar o leitor' } }, 500);
      }
      remoteOpen = true;
    }

    await admin
      .from('facial_release_requests')
      .update({ entry_id: entry.id })
      .eq('id', requestId);

    try {
      await admin.from('controlid_logs').insert({
        device_id: deviceId,
        event_type: 'facial_release',
        payload: {
          request_id: requestId,
          entry_id: entry.id,
          resident_id: residentId,
          apartment,
          approved_by: user.id,
        },
        processed: false,
      });
    } catch (logError) {
      console.error('Facial release log error:', logError);
    }

    return json({ ok: true, entry_id: entry.id, remote_open: remoteOpen });
  } catch (error: any) {
    console.error('Facial release error:', error);
    return json({ error: { message: error?.message || 'Erro inesperado' } }, 500);
  }
});
