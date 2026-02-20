import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature',
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

/**
 * Detect event type from URL path and payload.
 * 
 * Control iD Monitor mode sends to these endpoints:
 *   POST /api/notifications/dao          - access_logs, alarm_logs, cards, users changes
 *   POST /api/notifications/device_is_alive - heartbeat
 *   POST /api/notifications/operation_mode  - operation mode changes
 *   POST /api/notifications/door         - door state changes
 *   POST /api/notifications/catra_event  - turnstile events (iDBlock)
 * 
 * Control iD Online mode sends to:
 *   POST /device_is_alive.fcgi           - heartbeat / check server availability
 *   POST /session_is_valid.fcgi          - session validation
 *   POST /identification_event.fcgi      - user identification events
 */
const detectEventType = (url: URL, payload: any): string => {
  const path = url.pathname.toLowerCase();

  // Monitor mode endpoints (sub-path based)
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
 * Control iD may send it as:
 * - Body field: device_id, deviceId
 * - Query param: deviceId
 * - Header: x-device-id
 * - Serial number in body
 */
const extractDeviceId = (url: URL, payload: any, req: Request): string => {
  // From body
  if (payload?.device_id) return sanitizeString(payload.device_id, 100);
  if (payload?.deviceId) return sanitizeString(payload.deviceId, 100);
  if (payload?.serial) return sanitizeString(payload.serial, 100);

  // From query params
  const qDeviceId = url.searchParams.get('deviceId') || url.searchParams.get('device_id');
  if (qDeviceId) return sanitizeString(qDeviceId, 100);

  // From headers
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

    // Accept GET for device_is_alive.fcgi and session_is_valid.fcgi (some devices use GET)
    if (req.method !== 'POST' && req.method !== 'GET') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse payload (may be empty for GET or device_is_alive)
    let payload: any = {};
    let rawPayload = '';
    
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || '';
      rawPayload = await req.text();
      
      if (rawPayload && rawPayload.trim()) {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          // Some Control iD endpoints send form data or octet-stream
          console.log('Non-JSON payload received, treating as raw data');
          payload = { raw_data: rawPayload.substring(0, 1000) };
        }
      }
    }

    // Detect event type from URL path + payload
    const eventType = detectEventType(url, payload);
    
    // Extract device ID from multiple sources
    const deviceId = extractDeviceId(url, payload, req);

    console.log('Control iD webhook received:', {
      method: req.method,
      path: url.pathname,
      event_type: eventType,
      device_id: deviceId || 'unknown',
      timestamp: new Date().toISOString()
    });

    // Handle session_is_valid.fcgi - respond immediately (Online mode check)
    if (eventType === 'session_is_valid') {
      console.log('Session validation request - responding OK');
      return new Response(
        JSON.stringify({ session_is_valid: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle device_is_alive.fcgi (Online mode) - respond with empty or expected format
    if (eventType === 'device_is_alive' && url.pathname.includes('.fcgi')) {
      console.log('Online mode device_is_alive from:', deviceId);
      
      // Update device status if we have a device ID
      if (deviceId) {
        await updateDeviceStatus(supabaseClient, deviceId);
        
        // Save log
        await supabaseClient.from('controlid_logs').insert({
          device_id: deviceId || 'unknown',
          event_type: 'device_is_alive',
          payload: payload,
          processed: true
        });
      }

      // Response expected by Control iD online mode
      const accessLogs = payload?.access_logs || 0;
      return new Response(
        JSON.stringify({ connected: true, access_logs: accessLogs }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For events without device_id, use "unknown" but still process
    const effectiveDeviceId = deviceId || 'unknown-device';

    // Check rate limit
    if (!checkRateLimit(effectiveDeviceId)) {
      console.error('Rate limit exceeded', { device_id: effectiveDeviceId });
      return new Response(
        JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save the log
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

  // Try matching by serial_number first
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
    // Fallback: try matching by name
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

  // Update controlid_config
  await supabaseClient
    .from('controlid_config')
    .update({ last_sync: now, is_active: true })
    .eq('device_id', deviceId);
}
