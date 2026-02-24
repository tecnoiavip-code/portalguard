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

// Rate limiting map
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 200;

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

// Queue of pending push commands per device
const pushCommandQueue = new Map<string, Array<{ verb: string; endpoint: string; body?: any }>>();

/**
 * Get the correct monitor configuration for a device.
 * Uses the Supabase project hostname.
 */
const getMonitorConfig = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  // Extract hostname from SUPABASE_URL (e.g., https://xxx.supabase.co -> xxx.supabase.co)
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
 * Detect event type from URL path and payload.
 */
const detectEventType = (url: URL, payload: any): string => {
  const path = url.pathname.toLowerCase();

  // Push mode endpoint
  if (path.includes('/push') && !path.includes('/push-config')) return 'push_request';
  
  // Push config management endpoints
  if (path.includes('/push-config')) return 'push_config';
  if (path.includes('/send-config')) return 'send_config';

  // Monitor mode endpoints
  if (path.includes('/dao')) return 'dao';
  if (path.includes('/device_is_alive') || path.includes('device_is_alive.fcgi')) return 'device_is_alive';
  if (path.includes('/operation_mode')) return 'operation_mode';
  if (path.includes('/door')) return 'door';
  if (path.includes('/catra_event')) return 'catra_event';
  if (path.includes('/access_photo')) return 'access_photo';
  if (path.includes('session_is_valid.fcgi')) return 'session_is_valid';
  if (path.includes('identification_event.fcgi')) return 'identification_event';

  // Fallback: detect from payload content
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

    // Accept GET for push mode, device_is_alive.fcgi, session_is_valid.fcgi
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
      const contentType = req.headers.get('content-type') || '';
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

    console.log('Control iD webhook received:', {
      method: req.method,
      path: url.pathname,
      event_type: eventType,
      device_id: deviceId || 'unknown',
      timestamp: new Date().toISOString()
    });

    // ===== PUSH MODE: Device polls for commands =====
    // GET /push?deviceId=XXX
    if (eventType === 'push_request' && req.method === 'GET') {
      console.log('Push request from device:', deviceId);

      // Check if there are pending commands for this device
      const queue = pushCommandQueue.get(deviceId);
      if (queue && queue.length > 0) {
        const command = queue.shift()!;
        if (queue.length === 0) pushCommandQueue.delete(deviceId);

        console.log('Sending push command to device:', deviceId, command.endpoint);
        return new Response(
          JSON.stringify(command),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // No pending commands - return empty response
      return new Response('', { status: 200, headers: corsHeaders });
    }

    // ===== SEND CONFIG: Push monitor config directly to device IP =====
    // POST /send-config { device_ip, device_serial }
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

      try {
        // Step 1: Login to get session
        const loginUrl = `http://${targetIp}:${targetPort}/login.fcgi`;
        console.log('Logging in to device:', loginUrl);
        
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

        // Step 2: Set monitor configuration
        const configUrl = `http://${targetIp}:${targetPort}/set_configuration.fcgi?session=${session}`;
        console.log('Setting configuration:', configUrl, JSON.stringify(monitorConfig));

        const configResp = await fetch(configUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(monitorConfig),
          signal: AbortSignal.timeout(10000),
        });

        const configResult = configResp.ok ? await configResp.text() : 'Failed';
        console.log('Config response:', configResult);

        // Step 3: Verify with get_configuration
        const verifyUrl = `http://${targetIp}:${targetPort}/get_configuration.fcgi?session=${session}`;
        let verifyData: any = null;
        try {
          const verifyResp = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monitor: true }),
            signal: AbortSignal.timeout(10000),
          });
          if (verifyResp.ok) {
            verifyData = await verifyResp.json();
          }
        } catch (e) {
          console.log('Could not verify config:', e);
        }

        // Log the config push
        await supabaseClient.from('controlid_logs').insert({
          device_id: targetSerial || targetIp,
          event_type: 'config_push',
          payload: { 
            sent_config: monitorConfig, 
            verify_result: verifyData,
            config_response: configResult,
            target_ip: targetIp 
          },
          processed: true,
        });

        return new Response(
          JSON.stringify({ 
            success: configResp.ok, 
            message: configResp.ok ? 'Monitor configuration sent successfully' : 'Failed to set configuration',
            sent_config: monitorConfig,
            current_config: verifyData?.monitor || null
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

    // ===== PUSH CONFIG: Queue set_configuration command for device via Push mode =====
    // POST /push-config { device_id }
    if (eventType === 'push_config' && req.method === 'POST') {
      const targetDeviceId = payload.device_id || payload.deviceId || deviceId;
      
      if (!targetDeviceId) {
        return new Response(
          JSON.stringify({ error: 'device_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const monitorConfig = getMonitorConfig();

      // Queue the set_configuration command for this device
      const command = {
        verb: 'POST',
        endpoint: 'set_configuration.fcgi',
        body: monitorConfig
      };

      const queue = pushCommandQueue.get(targetDeviceId) || [];
      queue.push(command);
      pushCommandQueue.set(targetDeviceId, queue);

      console.log('Queued monitor config push for device:', targetDeviceId);

      // Log
      await supabaseClient.from('controlid_logs').insert({
        device_id: targetDeviceId,
        event_type: 'config_push_queued',
        payload: { queued_config: monitorConfig },
        processed: false,
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Monitor configuration queued for push. The device will receive it on the next push poll.',
          config: monitorConfig
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== Handle session_is_valid.fcgi =====
    if (eventType === 'session_is_valid') {
      console.log('Session validation request - responding OK');
      return new Response(
        JSON.stringify({ session_is_valid: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== Handle device_is_alive.fcgi (Online mode) =====
    if (eventType === 'device_is_alive' && url.pathname.includes('.fcgi')) {
      console.log('Online mode device_is_alive from:', deviceId);
      
      if (deviceId) {
        await updateDeviceStatus(supabaseClient, deviceId);
        await supabaseClient.from('controlid_logs').insert({
          device_id: deviceId || 'unknown',
          event_type: 'device_is_alive',
          payload: payload,
          processed: true
        });
      }

      const accessLogs = payload?.access_logs || 0;
      return new Response(
        JSON.stringify({ connected: true, access_logs: accessLogs }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    // Process specific events
    if (eventType === 'dao' && payload.object_changes) {
      await processAccessLogs(supabaseClient, payload.object_changes, effectiveDeviceId);
    } else if (eventType === 'device_is_alive') {
      if (effectiveDeviceId !== 'unknown-device') {
        await updateDeviceStatus(supabaseClient, effectiveDeviceId);
      }
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

async function processAccessLogs(supabaseClient: any, objectChanges: any[], deviceId: string) {
  console.log('Processing access logs from Control iD, changes:', objectChanges.length);

  for (const change of objectChanges) {
    if (change.object === 'access_logs' && change.type === 'inserted') {
      const values = change.values || {};

      const userId = sanitizeString(values.user_id, 100);
      const cardValue = sanitizeString(values.card_value, 100);
      const eventDesc = sanitizeString(values.event, 100);
      const portalId = sanitizeString(values.portal_id, 50);

      let entryTime = new Date().toISOString();
      if (values.time) {
        try {
          const ts = typeof values.time === 'number' ? values.time : parseInt(values.time);
          if (!isNaN(ts)) {
            entryTime = new Date(ts * 1000).toISOString();
          }
        } catch { /* use default */ }
      }

      const entryData = {
        visitor_name: sanitizeString(`Control iD - ${userId || cardValue || 'Desconhecido'}`, 200),
        visitor_document: sanitizeString(cardValue || userId || 'N/A', 50),
        visitor_type: 'visitor',
        apartment: 'N/A',
        purpose: sanitizeString(`Evento: ${eventDesc || 'acesso'}`, 100),
        entry_time: entryTime,
        auto_recognized: true,
        notes: sanitizeString(`Device: ${deviceId}, Portal: ${portalId}`, 500)
      };

      const { error } = await supabaseClient.from('access_entries').insert(entryData);

      if (error) {
        console.error('Error creating access entry:', error);
      } else {
        console.log('Access entry created from Control iD event');
        await supabaseClient.from('realtime_events').insert({
          type: 'entry',
          description: sanitizeString(`Acesso automático - Device ${deviceId}`, 200),
          priority: 'medium'
        });
      }
    }
  }
}

async function processIdentificationEvent(supabaseClient: any, payload: any, deviceId: string) {
  console.log('Processing online identification event from:', deviceId);

  const userId = sanitizeString(payload.user_id, 100);
  const cardValue = sanitizeString(payload.card, 100);

  const entryData = {
    visitor_name: sanitizeString(`Control iD Online - ${userId || cardValue || 'Desconhecido'}`, 200),
    visitor_document: sanitizeString(cardValue || userId || 'N/A', 50),
    visitor_type: 'visitor',
    apartment: 'N/A',
    purpose: 'Identificação Online',
    entry_time: new Date().toISOString(),
    auto_recognized: true,
    notes: sanitizeString(`Device: ${deviceId}, Online Mode`, 500)
  };

  const { error } = await supabaseClient.from('access_entries').insert(entryData);
  if (error) {
    console.error('Error creating access entry from identification:', error);
  }
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

  await supabaseClient
    .from('controlid_config')
    .update({ last_sync: now, is_active: true })
    .eq('device_id', deviceId);
}
