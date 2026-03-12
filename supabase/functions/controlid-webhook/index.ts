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

  if (!entries.length) return {};

  return Object.fromEntries(
    entries.map(([key, value]) => [sanitizeString(key, 100), sanitizeString(value, 500)])
  );
};

// Rate limiting map
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 200;

// Throttle heartbeat logging: only log once per device per interval
const heartbeatLogMap = new Map<string, number>();
const HEARTBEAT_LOG_INTERVAL = 300000; // 5 minutes

const shouldLogHeartbeat = (deviceId: string): boolean => {
  const now = Date.now();
  const last = heartbeatLogMap.get(deviceId) || 0;
  if (now - last >= HEARTBEAT_LOG_INTERVAL) {
    heartbeatLogMap.set(deviceId, now);
    return true;
  }
  return false;
};

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
      request_timeout: "5000",
      hostname: hostname,
      port: "443",
      path: "functions/v1/controlid-webhook"
    }
  };
};

/**
 * Get the push server configuration (like iDSecure does).
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
      push_remote_address: `https://${hostname}/functions/v1/controlid-webhook/push`,
      push_request_timeout: "30000",
      push_request_period: "5"
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
  if (path.includes('/push/result')) return 'push_result';
  if (path.includes('device_is_alive.fcgi') || path.includes('/device_is_alive')) return 'device_is_alive';
  if (path.includes('identification_event.fcgi') || path.includes('new_user_identified.fcgi')) return 'identification_event';
  if (path.includes('session_is_valid.fcgi')) return 'session_is_valid';

  // Generic push polling route
  if (path.endsWith('/push') || (path.includes('/push') && !path.includes('.fcgi'))) {
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
          console.log('Non-JSON payload received, treating as raw data');
          payload = { raw_data: rawPayload.substring(0, 1000) };
        }
      }
    }

    const eventType = detectEventType(url, payload);
    const deviceId = extractDeviceId(url, payload, req);

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

    // ===== PUSH MODE: Device polls for commands (GET /push) =====
    // This is how iDSecure works: device sends GET /push periodically,
    // server responds with command or empty. Device executes and POST /push/result.
    if (eventType === 'push_request' && req.method === 'GET') {
      console.log('Push poll from device:', deviceId);

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
        // Mark as executing
        await supabaseClient
          .from('push_command_queue')
          .update({ status: 'executing', executed_at: new Date().toISOString() })
          .eq('id', pendingCmd.id);

        console.log('Sending push command to device:', deviceId, pendingCmd.command);
        return new Response(
          JSON.stringify(pendingCmd.command),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // No pending commands - return empty (iDSecure protocol)
      return new Response('', { status: 200, headers: corsHeaders });
    }

    // ===== PUSH RESULT: Device sends back result of executed command =====
    // POST /push/result or POST /push with result payload
    if (eventType === 'push_result' && req.method === 'POST') {
      console.log('Push result from device:', deviceId, JSON.stringify(payload).substring(0, 200));

      // Mark the oldest executing command as done
      const { data: executingCmd } = await supabaseClient
        .from('push_command_queue')
        .select('id')
        .eq('device_id', deviceId)
        .eq('status', 'executing')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (executingCmd) {
        await supabaseClient
          .from('push_command_queue')
          .update({ status: 'done', executed_at: new Date().toISOString() })
          .eq('id', executingCmd.id);
      }

      // Log the result
      await supabaseClient.from('controlid_logs').insert({
        device_id: deviceId || 'unknown',
        event_type: 'push_result',
        payload: payload,
        processed: true,
      });

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
      // Send both monitor and push_server configs
      const fullConfig = { ...monitorConfig, ...pushConfig };

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
      const fullConfig = { ...monitorConfig, ...pushConfig };

      const command = {
        verb: 'POST',
        endpoint: 'set_configuration.fcgi',
        body: fullConfig
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

    // ===== Handle device_is_alive.fcgi (Push/Online mode heartbeat) =====
    if (eventType === 'device_is_alive') {
      if (deviceId) {
        await updateDeviceStatus(supabaseClient, deviceId);

        // Only log heartbeat every 5 minutes to avoid flooding
        if (shouldLogHeartbeat(deviceId)) {
          await supabaseClient.from('controlid_logs').insert({
            device_id: deviceId,
            event_type: 'device_is_alive',
            payload: { access_logs: payload?.access_logs || 0 },
            processed: true
          });
          console.log('Heartbeat logged for device:', deviceId);
        }
      }

      // Push mode: return empty 200 (iDSecure protocol)
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

    // Save log
    const { error: logError } = await supabaseClient
      .from('controlid_logs')
      .insert({
        device_id: effectiveDeviceId,
        event_type: eventType,
        payload: payload,
        processed: false
      });

    if (logError) {
      console.error('Error saving Control iD log:', logError);
    }

    // Process specific events (device_is_alive already handled above with early return)
    if (eventType === 'dao' && payload.object_changes) {
      await processAccessLogs(supabaseClient, payload.object_changes, effectiveDeviceId);
    } else if (eventType === 'identification_event') {
      await processIdentificationEvent(supabaseClient, payload, effectiveDeviceId);
    }

    return new Response(
      JSON.stringify({ success: true, event_type: eventType }),
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

async function processIdentificationEvent(supabaseClient: any, payload: any, deviceId: string) {
  console.log('Processing online identification event from:', deviceId);

  const userId = sanitizeString(payload.user_id, 100);
  const cardValue = sanitizeString(payload.card, 100);
  const userName = extractUserName(payload);
  const displayName = userName || userId || cardValue || 'Desconhecido';

  const resident = await matchResident(supabaseClient, displayName);

  await supabaseClient.from('realtime_events').insert({
    type: 'entry',
    description: sanitizeString(
      resident
        ? `Acesso reconhecido: ${resident.name} - Apto ${resident.apartment}`
        : `Identificação: ${displayName} - Device ${deviceId}`,
      200
    ),
    priority: resident ? 'low' : 'medium'
  });

  console.log('Realtime event created from identification', resident ? `(matched: ${resident.name})` : '(no match)');
}

async function updateDeviceStatus(supabaseClient: any, deviceId: string) {
  console.log('Updating device status - alive:', deviceId);
  const now = new Date().toISOString();

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
