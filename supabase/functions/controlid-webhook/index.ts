import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Input validation helpers
const sanitizeString = (val: any, maxLength = 255): string => {
  if (typeof val !== 'string' && typeof val !== 'number') return '';
  return String(val).trim().substring(0, maxLength);
};

const parseFormEncodedPayload = (raw: string): Record<string, string> => {
  const params = new URLSearchParams(raw);
  const entries = Array.from(params.entries()).filter(([key]) => key && key.trim().length > 0);

  if (entries.length > 0) {
    return Object.fromEntries(
      entries.map(([key, value]) => [sanitizeString(key, 100), sanitizeString(value, 500)])
    );
  }

  // Fallback parser for non-standard payloads (plain text key=value&key2=value2)
  if (!raw.includes('=')) return {};

  const result: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    const [rawKey, ...rawValueParts] = pair.split('=');
    if (!rawKey) continue;

    const key = sanitizeString(decodeURIComponent(rawKey.replace(/\+/g, ' ')), 100);
    const value = sanitizeString(decodeURIComponent(rawValueParts.join('=').replace(/\+/g, ' ')), 500);
    if (key) result[key] = value;
  }

  return result;
};

// Rate limiting map
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 200;

// Throttle status writes to keep push responses fast and stable
const lastDeviceStatusWriteMap = new Map<string, number>();
const DEVICE_STATUS_WRITE_INTERVAL_MS = 10000;

const checkRateLimit = (deviceId: string): boolean => {
  const now = Date.now();
  const limit = rateLimitMap.get(deviceId);
  if (!limit || now > limit.resetTime) {
    rateLimitMap.set(deviceId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (limit.count >= MAX_REQUESTS_PER_WINDOW) return false;
  limit.count++;
  return true;
};

const runBackground = (label: string, task: Promise<unknown>) => {
  task.catch((error) => {
    console.error(`Background task failed: ${label}`, error);
  });
};

/**
 * Get the correct monitor configuration for a device.
 * Uses the Supabase project hostname.
 */
const getMonitorConfig = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  let hostname = '';
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    hostname = 'kxdqffkkufgsizszchvw.supabase.co';
  }

  return {
    monitor: {
      request_timeout: 120000,
      hostname: hostname,
      port: 443,
      path: "/functions/v1/controlid-webhook"
    }
  };
};

const getGeneralConfig = () => ({
  general: {
    online: 1
  }
});

/**
 * Get the push server configuration.
 * We keep the base webhook path (without /push) because some firmwares append /push automatically.
 */
const getPushServerConfig = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  let hostname = '';
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    hostname = 'kxdqffkkufgsizszchvw.supabase.co';
  }

  return {
    push_server: {
      push_remote_address: `https://${hostname}/functions/v1/controlid-webhook`,
      push_request_timeout: 120000,
      push_request_period: 5
    }
  };
};

/**
 * Detect event type from URL path and payload.
 */
const detectEventType = (url: URL, payload: any): string => {
  const path = url.pathname.toLowerCase();

  // Explicit config routes first
  if (path.includes('/push-config')) return 'push_config';
  if (path.includes('/send-config')) return 'send_config';

  // Push sub-routes that must be handled before generic /push
  if (path.includes('/push/result') || path.endsWith('/result')) return 'push_result';
  if (path.includes('device_is_alive.fcgi') || path.includes('/device_is_alive')) return 'device_is_alive';
  if (path.includes('identification_event.fcgi') || path.includes('new_user_identified.fcgi')) return 'identification_event';
  if (path.includes('session_is_valid.fcgi')) return 'session_is_valid';

  // Some devices send heartbeat as POST /push (or base webhook path) with access_logs in payload
  if ((path.includes('/push') || path.endsWith('/controlid-webhook')) && payload?.access_logs !== undefined) {
    return 'device_is_alive';
  }

  // Generic push polling route (supports /push, /push/push and base /controlid-webhook)
  if (path.endsWith('/push') || (path.includes('/push') && !path.includes('.fcgi'))) {
    return 'push_request';
  }

  if (path.endsWith('/controlid-webhook') || path.endsWith('/controlid-webhook/')) {
    return 'push_request';
  }

  if (path.includes('/dao')) return 'dao';
  if (path.includes('/operation_mode')) return 'operation_mode';
  if (path.includes('/door')) return 'door';
  if (path.includes('/catra_event')) return 'catra_event';
  if (path.includes('/access_photo')) return 'access_photo';

  if (payload?.object_changes) return 'dao';
  if (payload?.access_logs !== undefined) return 'device_is_alive';
  if (payload?.operation_mode) return 'operation_mode';
  if (payload?.door) return 'door';
  if (payload?.access_photo) return 'access_photo';
  if (payload?.event) return 'catra_event';

  return 'unknown';
};

/**
 * Extract device identifier from multiple sources.
 */
const extractDeviceId = (url: URL, payload: any, req: Request): string => {
  if (payload?.device_id) return sanitizeString(payload.device_id, 100);
  if (payload?.deviceId) return sanitizeString(payload.deviceId, 100);
  if (payload?.serial) return sanitizeString(payload.serial, 100);

  const qDeviceId = url.searchParams.get('deviceId') || url.searchParams.get('device_id');
  if (qDeviceId) return sanitizeString(qDeviceId, 100);

  const hDeviceId = req.headers.get('x-device-id');
  if (hDeviceId) return sanitizeString(hDeviceId, 100);

  return '';
};

const buildIdentificationResponse = (payload: any) => {
  const userId = Number.parseInt(String(payload?.user_id ?? '0'), 10);
  const portalId = Number.parseInt(String(payload?.portal_id ?? '1'), 10);
  const incomingEvent = Number.parseInt(String(payload?.event ?? '0'), 10);
  const userName = sanitizeString(payload?.user_name || payload?.name || '', 200);

  const isIdentified = (Number.isFinite(userId) && userId > 0) || userName.length > 0;
  const isDeniedByDevice = incomingEvent === 3 || incomingEvent === 6;
  const granted = isIdentified && !isDeniedByDevice;

  const resolvedPortal = Number.isFinite(portalId) && portalId > 0 ? portalId : 1;

  return {
    result: {
      event: granted ? 7 : 6,
      user_id: Number.isFinite(userId) ? userId : 0,
      user_name: userName || 'Desconhecido',
      user_image: payload?.user_has_image === 1 || payload?.user_has_image === '1',
      portal_id: resolvedPortal,
      message: granted ? 'Acesso autorizado' : 'Acesso negado',
      actions: granted ? [{ action: 'door', parameters: `door=${resolvedPortal}` }] : []
    }
  };
};

const tryParseJsonString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const normalizeBase64Candidate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fromDataUri = trimmed.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i);
  const candidate = (fromDataUri?.[1] || trimmed).replace(/\s+/g, '');
  if (candidate.length < 100) return null;

  // Standard and URL-safe base64
  if (!/^[A-Za-z0-9+/=_-]+$/.test(candidate)) return null;
  return candidate;
};

const extractPhotoBase64 = (payload: any): string | null => {
  const parsedResponse = tryParseJsonString(payload?.response);
  const parsedRawData = tryParseJsonString(payload?.raw_data);

  const candidates: unknown[] = [
    payload?.user_image_hash,
    payload?.user_image_data,
    payload?.face_image,
    payload?.image,
    payload?.photo,
    payload?.photo_data,
    payload?.access_photo?.image,
    payload?.access_photo?.photo,
    payload?.result?.user_image,
    payload?.result?.image,
    payload?.result?.photo,
    payload?.result?.access_photo,
    payload?.response?.user_image,
    payload?.response?.image,
    payload?.response?.photo,
    parsedResponse?.user_image,
    parsedResponse?.image,
    parsedResponse?.photo,
    parsedResponse?.access_photo?.image,
    parsedResponse?.access_photo?.photo,
    parsedRawData?.user_image,
    parsedRawData?.image,
    parsedRawData?.photo,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBase64Candidate(candidate);
    if (normalized) return normalized;
  }

  return null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (req.method !== 'POST' && req.method !== 'GET') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse payload
    let payload: any = {};
    let rawPayload = '';
    
    if (req.method === 'POST') {
      rawPayload = await req.text();
      
      if (rawPayload && rawPayload.trim()) {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          const formPayload = parseFormEncodedPayload(rawPayload);

          if (Object.keys(formPayload).length > 0) {
            payload = formPayload;
          } else {
            console.log('Non-JSON payload received, treating as raw data');
            payload = { raw_data: rawPayload.substring(0, 1000) };
          }
        }
      }
    }

    const eventType = detectEventType(url, payload);
    const deviceId = extractDeviceId(url, payload, req);
    const isFcgiCallback = url.pathname.toLowerCase().includes('.fcgi');

    // Only log non-heartbeat events to reduce noise
    if (eventType !== 'device_is_alive') {
      console.log('Control iD webhook received:', {
        method: req.method,
        path: url.pathname,
        event_type: eventType,
        device_id: deviceId || 'unknown',
        timestamp: new Date().toISOString()
      });
    }

    // ===== PUSH MODE: Device polls for commands (GET/POST /push) =====
    // Some models send POST /push with access_logs as heartbeat signal.
    // Device also sends results back via POST to the same /push endpoint.
    if (eventType === 'push_request' && (req.method === 'GET' || req.method === 'POST')) {
      if (deviceId) {
        runBackground('updateDeviceStatus', updateDeviceStatus(supabaseClient, deviceId));
      }

      // Check if this POST is actually a result from a previously sent command
      if (req.method === 'POST' && rawPayload && rawPayload.trim()) {
        const { data: executingCmd } = await supabaseClient
          .from('push_command_queue')
          .select('id, command')
          .eq('device_id', deviceId)
          .eq('status', 'executing')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (executingCmd) {
          console.log('Push result (via /push POST) from device:', deviceId, JSON.stringify(payload).substring(0, 300));

          // Check if this is a user_get_image result — extract and save photo
          const cmd = executingCmd.command as any;
          const isImageResult = cmd?.endpoint === 'user_get_image' || cmd?.endpoint === 'user_get_image.fcgi';
          let photoUpdatePromise: Promise<unknown> = Promise.resolve();

          if (isImageResult) {
            const imageBase64 = extractPhotoBase64(payload);
            if (imageBase64) {
              photoUpdatePromise = (async () => {
                const photoPath = await saveAccessPhoto(supabaseClient, deviceId, imageBase64);
                if (photoPath && cmd?.meta?.log_id) {
                  // Update the original identification log with the photo
                  const { data: origLog } = await supabaseClient
                    .from('controlid_logs')
                    .select('payload')
                    .eq('id', cmd.meta.log_id)
                    .maybeSingle();
                  if (origLog) {
                    await supabaseClient
                      .from('controlid_logs')
                      .update({ payload: { ...origLog.payload, saved_photo_path: photoPath } })
                      .eq('id', cmd.meta.log_id);
                    console.log('Photo linked to identification log:', cmd.meta.log_id, photoPath);
                  }
                }
              })();
            }
          }

          runBackground('storePushResultViaPush', Promise.all([
            supabaseClient
              .from('push_command_queue')
              .update({
                status: 'done',
                executed_at: new Date().toISOString(),
                result: payload,
              })
              .eq('id', executingCmd.id),
            supabaseClient.from('controlid_logs').insert({
              device_id: deviceId || 'unknown',
              event_type: 'push_result',
              payload: { ...payload, command_id: executingCmd.id },
              processed: true,
            }),
            photoUpdatePromise,
          ]));

          return new Response('', { status: 200, headers: corsHeaders });
        }
      }

      // Fetch oldest pending command from DB queue
      const { data: pendingCmd, error: fetchErr } = await supabaseClient
        .from('push_command_queue')
        .select('id, command')
        .eq('device_id', deviceId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (fetchErr) {
        console.error('Error fetching push queue:', fetchErr);
      }

      if (pendingCmd) {
        runBackground(
          'markPushCommandExecuting',
          supabaseClient
            .from('push_command_queue')
            .update({ status: 'executing', executed_at: new Date().toISOString() })
            .eq('id', pendingCmd.id)
        );

        // Transform command to Control iD push protocol format
        const cmd = pendingCmd.command as any;
        const endpoint = String(cmd.endpoint || '').replace(/\.fcgi$/i, '');
        const body = cmd.body ?? {};
        const pushCommand = {
          verb: cmd.verb || 'POST',
          endpoint,
          body,
          contentType: cmd.contentType || 'application/json',
        };

        console.log('Sending push command to device:', deviceId, JSON.stringify(pushCommand).substring(0, 200));

        return new Response(
          JSON.stringify(pushCommand),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // No pending commands - return empty acknowledgement
      return new Response('', { status: 200, headers: corsHeaders });
    }

    // ===== PUSH RESULT: Device sends back result of executed command =====
    // POST /push/result or POST /push with result payload
    if (eventType === 'push_result' && req.method === 'POST') {
      console.log('Push result from device:', deviceId, JSON.stringify(payload).substring(0, 300));

      // Mark the oldest executing command as done and store result
      const { data: executingCmd } = await supabaseClient
        .from('push_command_queue')
        .select('id, command')
        .eq('device_id', deviceId)
        .eq('status', 'executing')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (executingCmd) {
        const cmd = executingCmd.command as any;
        const isImageResult = cmd?.endpoint === 'user_get_image' || cmd?.endpoint === 'user_get_image.fcgi';
        let photoUpdatePromise: Promise<unknown> = Promise.resolve();

        if (isImageResult) {
          const imageBase64 = extractPhotoBase64(payload);
          if (imageBase64) {
            photoUpdatePromise = (async () => {
              const photoPath = await saveAccessPhoto(supabaseClient, deviceId, imageBase64);
              if (photoPath && cmd?.meta?.log_id) {
                const { data: origLog } = await supabaseClient
                  .from('controlid_logs')
                  .select('payload')
                  .eq('id', cmd.meta.log_id)
                  .maybeSingle();
                if (origLog) {
                  await supabaseClient
                    .from('controlid_logs')
                    .update({ payload: { ...origLog.payload, saved_photo_path: photoPath } })
                    .eq('id', cmd.meta.log_id);
                  console.log('Photo linked to identification log:', cmd.meta.log_id, photoPath);
                }
              }
            })();
          }
        }

        runBackground('storePushResult', Promise.all([
          supabaseClient
            .from('push_command_queue')
            .update({
              status: 'done',
              executed_at: new Date().toISOString(),
              result: payload,
            })
            .eq('id', executingCmd.id),
          supabaseClient.from('controlid_logs').insert({
            device_id: deviceId || 'unknown',
            event_type: 'push_result',
            payload: { ...payload, command_id: executingCmd?.id || null },
            processed: true,
          }),
          photoUpdatePromise,
        ]));
      }

      // Return empty (iDSecure protocol)
      return new Response('', { status: 200, headers: corsHeaders });
    }

    // ===== SEND CONFIG: Push monitor config directly to device IP =====
    if (eventType === 'send_config' && req.method === 'POST') {
      const targetIp = payload.device_ip;
      const targetPort = payload.device_port || '80';
      const targetSerial = payload.device_serial || '';

      if (!targetIp) {
        return new Response(
          JSON.stringify({ error: 'device_ip is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Sending monitor config to device:', targetIp);

      const monitorConfig = getMonitorConfig();
      const pushConfig = getPushServerConfig();
      const generalConfig = getGeneralConfig();
      // Send monitor + push_server + online mode
      const fullConfig = { ...monitorConfig, ...pushConfig, ...generalConfig };

      try {
        const loginUrl = `http://${targetIp}:${targetPort}/login.fcgi`;
        const loginResp = await fetch(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'admin', password: 'admin' }),
          signal: AbortSignal.timeout(10000),
        });

        if (!loginResp.ok) {
          return new Response(
            JSON.stringify({ error: 'Failed to login to device', status: loginResp.status }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const loginData = await loginResp.json();
        const session = loginData.session;

        if (!session) {
          return new Response(
            JSON.stringify({ error: 'No session returned from device login' }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const configUrl = `http://${targetIp}:${targetPort}/set_configuration.fcgi?session=${session}`;
        const configResp = await fetch(configUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fullConfig),
          signal: AbortSignal.timeout(10000),
        });

        const configResult = configResp.ok ? await configResp.text() : 'Failed';

        // Verify
        const verifyUrl = `http://${targetIp}:${targetPort}/get_configuration.fcgi?session=${session}`;
        let verifyData: any = null;
        try {
          const verifyResp = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monitor: true, push_server: true }),
            signal: AbortSignal.timeout(10000),
          });
          if (verifyResp.ok) verifyData = await verifyResp.json();
        } catch (e) {
          console.log('Could not verify config:', e);
        }

        await supabaseClient.from('controlid_logs').insert({
          device_id: targetSerial || targetIp,
          event_type: 'config_push',
          payload: { sent_config: fullConfig, verify_result: verifyData, config_response: configResult, target_ip: targetIp },
          processed: true,
        });

        return new Response(
          JSON.stringify({ 
            success: configResp.ok, 
            message: configResp.ok ? 'Configuration sent successfully (monitor + push)' : 'Failed to set configuration',
            sent_config: fullConfig,
            current_config: verifyData || null
          }),
          { status: configResp.ok ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Error sending config to device:', errorMsg);
        return new Response(
          JSON.stringify({ 
            error: 'Cannot reach device', 
            details: errorMsg,
            hint: 'Verifique se o dispositivo está na mesma rede e acessível. Edge Functions rodam na nuvem e não conseguem acessar IPs de rede local (192.168.x.x). Use o endpoint /push para dispositivos em rede local.'
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ===== PUSH CONFIG: Queue set_configuration command via Push mode (DB-backed) =====
    if (eventType === 'push_config' && req.method === 'POST') {
      const targetDeviceId = payload.device_id || payload.deviceId || deviceId;
      
      if (!targetDeviceId) {
        return new Response(
          JSON.stringify({ error: 'device_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const monitorConfig = getMonitorConfig();
      const pushConfig = getPushServerConfig();
      const generalConfig = getGeneralConfig();
      const fullConfig = { ...monitorConfig, ...pushConfig, ...generalConfig };

      const command = {
        verb: 'POST',
        endpoint: 'set_configuration',
        body: fullConfig,
        contentType: 'application/json'
      };

      // Persist to DB instead of in-memory queue
      const { error: insertErr } = await supabaseClient
        .from('push_command_queue')
        .insert({
          device_id: targetDeviceId,
          command: command,
          status: 'pending',
        });

      if (insertErr) {
        console.error('Error queuing push command:', insertErr);
        return new Response(
          JSON.stringify({ error: 'Failed to queue command', details: insertErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Queued push config for device (DB-backed):', targetDeviceId);

      await supabaseClient.from('controlid_logs').insert({
        device_id: targetDeviceId,
        event_type: 'config_push_queued',
        payload: { queued_config: fullConfig },
        processed: false,
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Configuration queued for push (persistent). Device will receive it on next poll.',
          config: fullConfig
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== Handle session_is_valid.fcgi =====
    if (eventType === 'session_is_valid') {
      return new Response(
        JSON.stringify({ session_is_valid: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== Handle device_is_alive.fcgi and POST /push heartbeat =====
    if (eventType === 'device_is_alive') {
      if (deviceId) {
        await updateDeviceStatus(supabaseClient, deviceId);
      }

      // Heartbeat must not create access noise; only acknowledge
      return new Response('', { status: 200, headers: corsHeaders });
    }

    // For events without device_id
    const effectiveDeviceId = deviceId || 'unknown-device';

    if (!checkRateLimit(effectiveDeviceId)) {
      console.error('Rate limit exceeded', { device_id: effectiveDeviceId });
      return new Response(
        JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract and save photo if present in payload
    let savedPhotoPath: string | null = null;
    const photoBase64 = extractPhotoBase64(payload);
    if (photoBase64) {
      try {
        savedPhotoPath = await saveAccessPhoto(supabaseClient, effectiveDeviceId, photoBase64);
      } catch (e) {
        console.error('Error saving access photo:', e);
      }
    }

    // Include photo path in the payload before saving log
    const enrichedPayload = savedPhotoPath
      ? { ...payload, saved_photo_path: savedPhotoPath }
      : payload;

    // Save log and capture the ID for later photo linking
    const { data: logData, error: logError } = await supabaseClient
      .from('controlid_logs')
      .insert({
        device_id: effectiveDeviceId,
        event_type: eventType,
        payload: enrichedPayload,
        processed: false
      })
      .select('id')
      .single();

    const logEntryId = logData?.id || null;

    if (logError) {
      console.error('Error saving Control iD log:', logError);
    }

    // Process specific events (device_is_alive already handled above with early return)
    if (eventType === 'dao' && payload.object_changes) {
      await processAccessLogs(supabaseClient, payload.object_changes, effectiveDeviceId);
    }

    // Online identification events expect a JSON return message
    if (eventType === 'identification_event') {
      // Auto-sync card_value to resident's vehicle_tag for tag antenna devices
      const cardValue = String(payload.card_value || '');
      const identUserName = String(payload.user_name || '');
      if (cardValue && identUserName) {
        try {
          // Check if this device is a vehicle_tag type
          const { data: deviceRow } = await supabaseClient
            .from('devices')
            .select('type')
            .or(`serial_number.eq.${effectiveDeviceId},ip_address.eq.${effectiveDeviceId}`)
            .limit(1)
            .maybeSingle();

          if (deviceRow?.type === 'vehicle_tag') {
            // Parse "APT - NAME" format
            const aptMatch = identUserName.match(/^(\d+\w?)\s*[-–]\s*(.+)$/i);
            if (aptMatch) {
              const [, apt, extractedName] = aptMatch;
              const normalizedName = extractedName.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

              // Find resident by apartment ending with the number (supports "Sausalito 108" matching "108")
              const { data: residents } = await supabaseClient
                .from('residents')
                .select('id, name, vehicle_tag')
                .ilike('apartment', `%${apt.trim()}`);

              if (residents && residents.length > 0) {
                const matched = residents.find(r => {
                  const rName = r.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                  return rName.includes(normalizedName) || normalizedName.includes(rName);
                }) || (residents.length === 1 ? residents[0] : null);

                if (matched && matched.vehicle_tag !== cardValue) {
                  await supabaseClient
                    .from('residents')
                    .update({ vehicle_tag: cardValue })
                    .eq('id', matched.id);
                  console.log(`Auto-synced vehicle_tag ${cardValue} to resident ${matched.name} (${apt})`);
                }
              }
            }
          }
        } catch (e) {
          console.error('Error auto-syncing vehicle_tag:', e);
        }
      }

      // Queue user_get_image to fetch the face photo from the device
      const userId = Number.parseInt(String(payload?.user_id ?? '0'), 10);
      const hasImage = payload?.user_has_image === 1 || payload?.user_has_image === '1';
      if (hasImage && Number.isFinite(userId) && userId > 0 && !savedPhotoPath) {
        runBackground('queueUserGetImage', supabaseClient
          .from('push_command_queue')
          .insert({
            device_id: effectiveDeviceId,
            command: {
              verb: 'POST',
              endpoint: 'user_get_image',
              body: { user_id: userId },
              contentType: 'application/json',
              meta: { log_id: logEntryId, user_id: userId },
            },
            status: 'pending',
          })
          .then(() => console.log(`Queued user_get_image for user ${userId} on device ${effectiveDeviceId}`))
        );
      }

      return new Response(
        JSON.stringify(buildIdentificationResponse(payload)),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Other Control iD .fcgi callbacks expect empty 200 acknowledgements
    if (isFcgiCallback) {
      return new Response('', { status: 200, headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({ success: true, event_type: eventType, photo_saved: !!savedPhotoPath }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing Control iD webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Try to find a resident by parsing the Control iD user name format.
 */
async function matchResident(supabaseClient: any, userName: string) {
  if (!userName || userName === 'Desconhecido') return null;

  const aptNameMatch = userName.match(/^(\d+)\s*[-–]\s*(.+)$/);
  if (aptNameMatch) {
    const apartment = aptNameMatch[1].trim();
    const name = aptNameMatch[2].trim();

    const { data } = await supabaseClient
      .from('residents')
      .select('id, name, apartment')
      .eq('apartment', apartment)
      .ilike('name', `%${name}%`)
      .maybeSingle();

    if (data) return data;

    const { data: byApt } = await supabaseClient
      .from('residents')
      .select('id, name, apartment')
      .eq('apartment', apartment)
      .maybeSingle();

    if (byApt) return byApt;
  }

  const { data: byName } = await supabaseClient
    .from('residents')
    .select('id, name, apartment')
    .ilike('name', `%${userName}%`)
    .limit(1)
    .maybeSingle();

  return byName || null;
}

const extractUserName = (values: any): string => {
  return sanitizeString(
    values.user_name || values.name || values.userName || values.user || '', 200
  );
};

async function processAccessLogs(supabaseClient: any, objectChanges: any[], deviceId: string) {
  console.log('Processing access logs from Control iD, changes:', objectChanges.length);

  for (const change of objectChanges) {
    if (change.object === 'access_logs' && change.type === 'inserted') {
      const values = change.values || {};

      const userId = sanitizeString(values.user_id, 100);
      const cardValue = sanitizeString(values.card_value, 100);
      const eventDesc = sanitizeString(values.event, 100);
      const userName = extractUserName(values);

      let entryTime = new Date().toISOString();
      if (values.time) {
        try {
          const ts = typeof values.time === 'number' ? values.time : parseInt(values.time);
          if (!isNaN(ts)) {
            entryTime = new Date(ts * 1000).toISOString();
          }
        } catch { /* use default */ }
      }

      const displayName = userName || userId || cardValue || 'Desconhecido';
      const resident = await matchResident(supabaseClient, displayName);

      await supabaseClient.from('realtime_events').insert({
        type: 'entry',
        description: sanitizeString(
          resident
            ? `Acesso reconhecido: ${resident.name} - Apto ${resident.apartment}`
            : `Acesso dispositivo: ${displayName} - Device ${deviceId}`,
          200
        ),
        priority: resident ? 'low' : 'medium'
      });

      console.log('Realtime event created from Control iD', resident ? `(matched: ${resident.name})` : '(no match)');
    }

    if (change.object === 'users' && (change.type === 'inserted' || change.type === 'updated')) {
      console.log('Control iD user sync event:', change.values?.name || change.values?.id);
    }
  }
}

/**
 * Save a base64 photo from a Control iD device to Supabase Storage.
 */
async function saveAccessPhoto(supabaseClient: any, deviceId: string, base64Data: string): Promise<string | null> {
  try {
    // Remove data URI prefix if present and normalize to standard base64
    const cleanBase64 = base64Data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s+/g, '');
    const normalizedBase64 = cleanBase64.replace(/-/g, '+').replace(/_/g, '/');
    const missingPadding = normalizedBase64.length % 4;
    const paddedBase64 = missingPadding === 0
      ? normalizedBase64
      : `${normalizedBase64}${'='.repeat(4 - missingPadding)}`;

    // Decode base64 to Uint8Array
    const binaryStr = atob(paddedBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const timestamp = Date.now();
    const filePath = `${deviceId}/${timestamp}.jpg`;

    const { error } = await supabaseClient.storage
      .from('access-photos')
      .upload(filePath, bytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.error('Storage upload error:', error);
      return null;
    }

    console.log('Access photo saved:', filePath);
    return filePath;
  } catch (e) {
    console.error('Error in saveAccessPhoto:', e);
    return null;
  }
}

async function updateDeviceStatus(supabaseClient: any, deviceId: string) {
  console.log('Updating device status - alive:', deviceId);

  const nowMs = Date.now();
  const lastWriteMs = lastDeviceStatusWriteMap.get(deviceId) || 0;
  if (nowMs - lastWriteMs < DEVICE_STATUS_WRITE_INTERVAL_MS) {
    return;
  }
  lastDeviceStatusWriteMap.set(deviceId, nowMs);

  const now = new Date(nowMs).toISOString();

  const { data: deviceBySerial } = await supabaseClient
    .from('devices')
    .select('id')
    .eq('serial_number', deviceId)
    .maybeSingle();

  if (deviceBySerial) {
    await supabaseClient
      .from('devices')
      .update({ last_sync: now, status: 'online' })
      .eq('id', deviceBySerial.id);
  } else {
    const { data: deviceByIp } = await supabaseClient
      .from('devices')
      .select('id')
      .eq('ip_address', deviceId)
      .maybeSingle();

    if (deviceByIp) {
      await supabaseClient
        .from('devices')
        .update({ last_sync: now, status: 'online' })
        .eq('id', deviceByIp.id);
    } else {
      const { data: deviceByName } = await supabaseClient
        .from('devices')
        .select('id')
        .ilike('name', `%${deviceId}%`)
        .maybeSingle();

      if (deviceByName) {
        await supabaseClient
          .from('devices')
          .update({ last_sync: now, status: 'online' })
          .eq('id', deviceByName.id);
      } else {
        console.log('No matching device found for:', deviceId);
      }
    }
  }

  await supabaseClient
    .from('controlid_config')
    .update({ last_sync: now, is_active: true })
    .eq('device_id', deviceId);
}
