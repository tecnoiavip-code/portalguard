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

const parseQueryStringToObject = (query: string): Record<string, string> => {
  if (!query) return {};
  const params = new URLSearchParams(query);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (!key) continue;
    out[sanitizeString(key, 100)] = sanitizeString(value, 500);
  }
  return out;
};

const uint8ToBase64 = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return '';
  const maybeToBase64 = (bytes as any).toBase64;
  if (typeof maybeToBase64 === 'function') {
    try {
      return maybeToBase64.call(bytes);
    } catch {
      // fallback below
    }
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const buildPushDispatchFromQueuedCommand = (queuedCommand: any): { command: string; parameters: Record<string, unknown> } => {
  // New schema (blueprint)
  if (queuedCommand && typeof queuedCommand.command === 'string') {
    const command = sanitizeString(String(queuedCommand.command).replace(/\.fcgi$/i, ''), 120);
    const parameters = queuedCommand.parameters && typeof queuedCommand.parameters === 'object'
      ? queuedCommand.parameters
      : {};
    return { command, parameters };
  }

  // Backward compatibility with old schema: { endpoint, body, ... }
  const endpointRaw = sanitizeString(String(queuedCommand?.endpoint || ''), 200);
  const endpointNoExt = endpointRaw.replace(/\.fcgi$/i, '');
  const [commandNameRaw, queryRaw = ''] = endpointNoExt.split('?');
  const command = sanitizeString(commandNameRaw, 120) || 'noop';

  const body = queuedCommand?.body;
  const bodyParams = body && typeof body === 'object' && !Array.isArray(body)
    ? body
    : (typeof body === 'string' && body.length > 0 ? { data: body } : {});

  const queryParams = parseQueryStringToObject(queryRaw);
  return { command, parameters: { ...queryParams, ...(bodyParams as Record<string, unknown>) } };
};

const isEnterpriseIdentificationPath = (path: string): boolean => {
  return (
    path.includes('new_card.fcgi') ||
    path.includes('new_qrcode.fcgi') ||
    path.includes('new_uhf_tag.fcgi') ||
    path.includes('new_user_id_and_password.fcgi') ||
    path.includes('new_biometric_image.fcgi') ||
    path.includes('new_biometric_template.fcgi')
  );
};

// Rate limiting map
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 200;

// Throttle status writes to keep push responses fast and stable
const lastDeviceStatusWriteMap = new Map<string, number>();
const deviceTypeCache = new Map<string, string | null>();

// Throttle config refresh checks (check DB at most every 1 min per device)
const lastConfigRefreshCheckMap = new Map<string, number>();
const CONFIG_REFRESH_CHECK_INTERVAL_MS = 60000; // 1 minute
const CONFIG_REFRESH_INTERVAL_MS = 1800000; // 30 minutes
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

const runBackground = (label: string, task: Promise<unknown> | unknown) => {
  if (!(task && typeof (task as any).catch === 'function')) return;

  const promise = (task as Promise<unknown>).catch((error) => {
    console.error(`Background task failed: ${label}`, error);
  });

  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
    edgeRuntime.waitUntil(promise);
    return;
  }

  // Fallback for runtimes without waitUntil support.
  promise;
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
    hostname = 'qasudwuoagblzfkvmyxx.supabase.co';
  }

  return {
    monitor: {
      request_timeout: "15000",
      hostname: `${hostname}`,
      port: "443",
      path: "/functions/v1/controlid-webhook",
      secure: "1"
    }
  };
};

const getGeneralConfig = () => {
  const onlineMode = Deno.env.get('CONTROLID_ONLINE_MODE') ?? '0';
  const defaultOperationMode = onlineMode === '1' ? 'online' : 'standalone';

  return {
    general: {
      // Master 128 / firmware family commonly accepts this shape.
      language: Deno.env.get('CONTROLID_LANGUAGE') ?? 'portuguese',
      operation_mode: Deno.env.get('CONTROLID_OPERATION_MODE') ?? defaultOperationMode,
      // Default to standalone/autonomous mode.
      // Can be overridden by setting CONTROLID_ONLINE_MODE env var to "1".
      online: onlineMode,
      // Relevant only when online = "1". Keep Pro-mode as default if enabled.
      local_identification: Deno.env.get('CONTROLID_LOCAL_IDENTIFICATION') ?? '1',
    }
  };
};

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
    hostname = 'qasudwuoagblzfkvmyxx.supabase.co';
  }

  return {
    push_server: {
      push_remote_address: `https://${hostname}/functions/v1/controlid-webhook`,
      push_request_timeout: "15000",
      push_request_period: "5"
    },
    // Blueprint-compatible server stanza for firmwares that use this format.
    network: {
      use_dhcp: true,
    },
    server: {
      url: `${hostname}/functions/v1/controlid-webhook`,
      ssl: true,
      port: 443,
      request_timeout: 15,
      send_user_events: true,
      send_device_events: true,
      send_photo: true,
      image_quality: 80,
    },
    access: {
      enable_face: true,
      face_threshold: 7,
      anti_spoofing: 'passive',
    },
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
  if (path.endsWith('/access') || path.includes('/access/')) return 'access_event';
  if (path.endsWith('/user_event') || path.includes('/user_event/')) return 'user_event';
  if (path.endsWith('/photo') || path.includes('/photo/')) return 'photo_event';
  if (path.includes('device_is_alive.fcgi') || path.includes('/device_is_alive')) return 'device_is_alive';
  if (path.includes('identification_event.fcgi') || path.includes('new_user_identified.fcgi')) return 'identification_event';
  if (isEnterpriseIdentificationPath(path)) return 'enterprise_identification_event';
  if (path.includes('session_is_valid.fcgi')) return 'session_is_valid';

  // Some devices send heartbeat as POST /push (or base webhook path) with access_logs in payload
  if ((path.includes('/push') || path.endsWith('/controlid-webhook')) && payload?.access_logs !== undefined) {
    return 'device_is_alive';
  }

  // ** CRITICAL: Detect identification events sent directly to the base webhook URL
  // (monitor/online mode). The device POSTs identification data to the monitor path.
  // Must be checked BEFORE push_request fallback so the door-open response is returned.
  if (payload && typeof payload === 'object') {
    const hasEvent = payload.event !== undefined;
    const hasUserId = payload.user_id !== undefined;
    const hasUserName = payload.user_name !== undefined || payload.name !== undefined;
    const hasPortal = payload.portal_id !== undefined;
    // Identification payloads always have event + (user_id or user_name)
    if (hasEvent && (hasUserId || hasUserName || hasPortal)) {
      return 'identification_event';
    }

    // Enterprise mode identification payloads may not include "event".
    const hasIdentifierData =
      payload.card_value !== undefined ||
      payload.uhf_tag !== undefined ||
      payload.qrcode_value !== undefined ||
      payload.password !== undefined;
    const hasEnterpriseContext =
      payload.identifier_id !== undefined ||
      payload.portal_id !== undefined ||
      payload.time !== undefined;
    if (hasIdentifierData && hasEnterpriseContext) {
      return 'enterprise_identification_event';
    }
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
  if (path.includes('/secbox')) return 'secbox';
  if (path.includes('/catra_event')) return 'catra_event';
  if (path.includes('/access_photo')) return 'access_photo';

  if (payload?.object_changes) return 'dao';
  if (payload?.access_logs !== undefined) return 'device_is_alive';
  if (payload?.operation_mode) return 'operation_mode';
  if (payload?.door) return 'door';
  if (payload?.secbox) return 'secbox';
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

const buildIdentificationActions = (payload: any, deviceType?: string | null) => {
  const portalId = Number.parseInt(String(payload?.portal_id ?? '1'), 10);
  const resolvedPortal = Number.isFinite(portalId) && portalId > 0 ? portalId : 1;

  // Device-specific action mapping (Control iD docs):
  // - iDFlex / iDAccess Pro / iDAccess Nano / iDFace => sec_box
  // - iDAccess / iDFit / iDBox / iDUHF (relay) => door
  if (deviceType === 'facial_recognition') {
    return [{ action: 'sec_box', parameters: 'id=65793, reason=1' }];
  }

  if (deviceType === 'vehicle_tag' || deviceType === 'card_reader') {
    return [{ action: 'door', parameters: `door=${resolvedPortal}` }];
  }

  // Unknown device fallback: UHF/card payloads are usually relay/door devices.
  if (payload?.uhf_tag || payload?.card_value || payload?.qrcode_value) {
    return [{ action: 'door', parameters: `door=${resolvedPortal}` }];
  }

  // Unknown facial/identified-user fallback.
  return [{ action: 'sec_box', parameters: 'id=65793, reason=1' }];
};

const buildIdentificationResponse = (
  payload: any,
  url: URL,
  deviceType?: string | null,
  options?: { forceGranted?: boolean }
) => {
  const userId = Number.parseInt(String(payload?.user_id ?? '0'), 10);
  const portalId = Number.parseInt(String(payload?.portal_id ?? '1'), 10);
  const incomingEvent = Number.parseInt(String(payload?.event ?? '0'), 10);
  const userName = sanitizeString(payload?.user_name || payload?.name || '', 200);

  const isIdentified = (Number.isFinite(userId) && userId > 0) || userName.length > 0;
  // Event 3/6 = device-side denial (unknown card, etc.). Don't grant.
  const isDeniedByDevice = incomingEvent === 3 || incomingEvent === 6;
  const granted = options?.forceGranted === true ? true : isIdentified && !isDeniedByDevice;

  const resolvedPortal = Number.isFinite(portalId) && portalId > 0 ? portalId : 1;

  // Keep response close to Control iD examples for maximum compatibility.
  const result: Record<string, unknown> = {
    event: granted ? 7 : 6,
    user_id: Number.isFinite(userId) ? userId : 0,
    user_name: userName,
    user_image: false,
    portal_id: resolvedPortal,
  };

  if (granted) {
    result.actions = buildIdentificationActions(payload, deviceType);
  }

  // By documentation, identification callbacks expect the payload wrapped in "result".
  // A flat response can be re-enabled with CONTROLID_IDENT_FLAT_RESPONSE=1.
  const forceFlat = (Deno.env.get('CONTROLID_IDENT_FLAT_RESPONSE') ?? '') === '1';
  return forceFlat ? result : { result };
};

const resolveDeviceType = async (supabaseClient: any, deviceId: string): Promise<string | null> => {
  if (!deviceId) return null;
  if (deviceTypeCache.has(deviceId)) {
    return deviceTypeCache.get(deviceId) ?? null;
  }

  try {
    const { data } = await supabaseClient
      .from('devices')
      .select('type')
      .or(`serial_number.eq.${deviceId},ip_address.eq.${deviceId}`)
      .limit(1)
      .maybeSingle();

    const resolvedType = typeof data?.type === 'string' ? data.type : null;
    deviceTypeCache.set(deviceId, resolvedType);
    return resolvedType;
  } catch (error) {
    console.error('Error resolving device type for identification response:', error);
    return null;
  }
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
    payload?.raw_base64,
    payload?.user_image_hash,
    payload?.user_image_data,
    payload?.face_image,
    payload?.image,
    payload?.photo,
    payload?.photo_data,
    payload?.response,
    payload?.raw_data,
    payload?.access_photo?.image,
    payload?.access_photo?.photo,
    payload?.result?.raw_base64,
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

const getQueuedCommandName = (queuedCommand: any): string => {
  const directCommand = sanitizeString(queuedCommand?.command ?? '', 160).replace(/\.fcgi$/i, '');
  if (directCommand) return directCommand;

  const endpointRaw = sanitizeString(queuedCommand?.endpoint ?? '', 200).replace(/\.fcgi$/i, '');
  const [endpoint] = endpointRaw.split('?');
  return sanitizeString(endpoint, 160);
};

const getQueuedCommandMeta = (queuedCommand: any): Record<string, unknown> | null => {
  if (!queuedCommand || typeof queuedCommand !== 'object') return null;

  if (queuedCommand.meta && typeof queuedCommand.meta === 'object') {
    return queuedCommand.meta as Record<string, unknown>;
  }

  const parameters = queuedCommand.parameters;
  if (parameters && typeof parameters === 'object' && (parameters as any).meta && typeof (parameters as any).meta === 'object') {
    return (parameters as any).meta as Record<string, unknown>;
  }

  return null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathLower = url.pathname.toLowerCase();

  try {
    const webhookSecret = Deno.env.get('CONTROLID_WEBHOOK_SECRET') ?? '';
    const requireSecret = (Deno.env.get('CONTROLID_REQUIRE_SECRET') ?? (webhookSecret ? '1' : '0')) === '1';
    const isDeviceIngressPath =
      pathLower.endsWith('/push') ||
      pathLower.includes('/push/') ||
      pathLower.endsWith('/access') ||
      pathLower.endsWith('/user_event') ||
      pathLower.endsWith('/photo') ||
      pathLower.includes('.fcgi') ||
      pathLower.endsWith('/controlid-webhook') ||
      pathLower.endsWith('/controlid-webhook/');

    if (requireSecret && webhookSecret && isDeviceIngressPath) {
      const secret = url.searchParams.get('secret');
      if (secret !== webhookSecret) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
    }

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
    let rawPayloadBytes = new Uint8Array();
    
    if (req.method === 'POST') {
      const rawBuffer = await req.arrayBuffer();
      rawPayloadBytes = new Uint8Array(rawBuffer);
      rawPayload = new TextDecoder().decode(rawPayloadBytes);
      
      if (rawPayload && rawPayload.trim()) {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          const formPayload = parseFormEncodedPayload(rawPayload);

          if (Object.keys(formPayload).length > 0) {
            payload = formPayload;
          } else {
            console.log('Non-JSON payload received, treating as raw data');
            payload = {
              raw_data: rawPayload.substring(0, 2000),
              raw_base64: uint8ToBase64(rawPayloadBytes),
              content_type: req.headers.get('content-type') || 'application/octet-stream',
              raw_size: rawPayloadBytes.length,
            };
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

      // Auto-expire stale executing commands (>120s old) to prevent queue blockage
      if (deviceId) {
        const staleThreshold = new Date(Date.now() - 120000).toISOString();
        runBackground('expireStaleCommands', supabaseClient
          .from('push_command_queue')
          .update({ status: 'error', result: { error: 'auto_expired_stale_executing' } })
          .eq('device_id', deviceId)
          .eq('status', 'executing')
          .lt('executed_at', staleThreshold)
        );
      }

      // Check if this POST is actually a result from a previously sent command
      if (req.method === 'POST' && rawPayload && rawPayload.trim()) {
        const pushResultPayload = payload?.result ?? payload;

        const { data: executingCmd } = await supabaseClient
          .from('push_command_queue')
          .select('id, command, executed_at')
          .eq('device_id', deviceId)
          .eq('status', 'executing')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (executingCmd) {
          // Skip if this executing command is stale (>120s) - result is likely for a different command
          const executedAt = executingCmd.executed_at ? new Date(executingCmd.executed_at).getTime() : 0;
          const isStale = executedAt > 0 && (Date.now() - executedAt) > 120000;
          
          if (isStale) {
            console.log('Ignoring stale result for command:', executingCmd.id, 'device:', deviceId);
            await supabaseClient
              .from('push_command_queue')
              .update({ status: 'error', result: { error: 'stale_result_discarded', received_payload: pushResultPayload } })
              .eq('id', executingCmd.id);
          } else {
            console.log('Push result (via /push POST) from device:', deviceId, JSON.stringify(pushResultPayload).substring(0, 300));

            // Check if this is a user_get_image result — extract and save photo
            const cmd = executingCmd.command as any;
            const commandName = getQueuedCommandName(cmd);
            const commandMeta = getQueuedCommandMeta(cmd);
            const isImageResult = commandName === 'user_get_image';
            let photoUpdatePromise: Promise<unknown> = Promise.resolve();

            if (isImageResult) {
              const imageBase64 = extractPhotoBase64(pushResultPayload);
              if (imageBase64) {
                photoUpdatePromise = (async () => {
                  const photoPath = await saveAccessPhoto(supabaseClient, deviceId, imageBase64);
                  const logId = commandMeta?.log_id;
                  if (photoPath && typeof logId === 'string' && logId.length > 0) {
                    const { data: origLog } = await supabaseClient
                      .from('controlid_logs')
                      .select('payload')
                      .eq('id', logId)
                      .maybeSingle();
                    if (origLog) {
                      await supabaseClient
                        .from('controlid_logs')
                        .update({ payload: { ...origLog.payload, saved_photo_path: photoPath } })
                        .eq('id', logId);
                      console.log('Photo linked to identification log:', logId, photoPath);
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
                  result: pushResultPayload,
                })
                .eq('id', executingCmd.id),
              photoUpdatePromise,
            ]));
          }

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
        const dispatchTime = new Date().toISOString();
        const { data: markedCmd, error: markExecutingError } = await supabaseClient
          .from('push_command_queue')
          .update({ status: 'executing', executed_at: dispatchTime })
          .eq('id', pendingCmd.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();

        if (markExecutingError || !markedCmd) {
          console.error('Failed to mark push command as executing:', markExecutingError ?? 'command already claimed');
          return new Response(
            JSON.stringify({}),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Blueprint protocol: return a flat object { command, parameters }.
        const pushCommand = buildPushDispatchFromQueuedCommand(pendingCmd.command);

        console.log('Sending push command to device:', deviceId, JSON.stringify(pushCommand).substring(0, 200));

        return new Response(
          JSON.stringify(pushCommand),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // No pending commands — check if we need to auto-refresh push config
      // to prevent devices from dropping connection after ~90 minutes
      if (deviceId) {
        const now = Date.now();
        const lastCheck = lastConfigRefreshCheckMap.get(deviceId) || 0;
        if (now - lastCheck > CONFIG_REFRESH_CHECK_INTERVAL_MS) {
          lastConfigRefreshCheckMap.set(deviceId, now);
          // Check in background; if needed, queue a set_configuration for the NEXT poll
          runBackground('autoRefreshConfig', (async () => {
            const cutoff = new Date(now - CONFIG_REFRESH_INTERVAL_MS).toISOString();
            const { data: recentCfgRows } = await supabaseClient
              .from('push_command_queue')
              .select('id, command, status, created_at')
              .eq('device_id', deviceId)
              .gte('created_at', cutoff)
              .in('status', ['done', 'pending', 'executing'])
              .order('created_at', { ascending: false })
              .limit(20);

            const rows = Array.isArray(recentCfgRows) ? recentCfgRows : [];
            const hasRecentDone = rows.some((row: any) =>
              row?.status === 'done' && getQueuedCommandName(row?.command) === 'set_configuration'
            );
            const hasPendingOrExecuting = rows.some((row: any) =>
              (row?.status === 'pending' || row?.status === 'executing') &&
              getQueuedCommandName(row?.command) === 'set_configuration'
            );

            if (!hasRecentDone && !hasPendingOrExecuting) {
                const monitorConfig = getMonitorConfig();
                const pushConfig = getPushServerConfig();
                const generalConfig = getGeneralConfig();
                const fullConfig = { ...monitorConfig, ...pushConfig, ...generalConfig };

                await supabaseClient.from('push_command_queue').insert({
                  device_id: deviceId,
                  command: {
                    command: 'set_configuration',
                    parameters: fullConfig,
                  },
                  status: 'pending',
                });
                console.log('Auto-queued config refresh for device:', deviceId);
            }
          })());
        }
      }

      return new Response(
        JSON.stringify({}),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== PUSH RESULT: Device sends back result of executed command =====
    // POST /push/result or POST /push with result payload
    if (eventType === 'push_result' && req.method === 'POST') {
      const pushResultPayload = payload?.result ?? payload;
      console.log('Push result from device:', deviceId, JSON.stringify(pushResultPayload).substring(0, 300));

      // Auto-expire stale executing commands before matching
      if (deviceId) {
        const staleThreshold = new Date(Date.now() - 120000).toISOString();
        runBackground(
          'expireStaleCommandsPushResult',
          supabaseClient
            .from('push_command_queue')
            .update({ status: 'error', result: { error: 'auto_expired_stale_executing' } })
            .eq('device_id', deviceId)
            .eq('status', 'executing')
            .lt('executed_at', staleThreshold)
        );
      }

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
        const commandName = getQueuedCommandName(cmd);
        const commandMeta = getQueuedCommandMeta(cmd);
        const isImageResult = commandName === 'user_get_image';
        let photoUpdatePromise: Promise<unknown> = Promise.resolve();

        if (isImageResult) {
          const imageBase64 = extractPhotoBase64(pushResultPayload);
          if (imageBase64) {
            photoUpdatePromise = (async () => {
              const photoPath = await saveAccessPhoto(supabaseClient, deviceId, imageBase64);
              const logId = commandMeta?.log_id;
              if (photoPath && typeof logId === 'string' && logId.length > 0) {
                const { data: origLog } = await supabaseClient
                  .from('controlid_logs')
                  .select('payload')
                  .eq('id', logId)
                  .maybeSingle();
                if (origLog) {
                  await supabaseClient
                    .from('controlid_logs')
                    .update({ payload: { ...origLog.payload, saved_photo_path: photoPath } })
                    .eq('id', logId);
                  console.log('Photo linked to identification log:', logId, photoPath);
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
              result: pushResultPayload,
            })
            .eq('id', executingCmd.id),
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
        command: 'set_configuration',
        parameters: fullConfig,
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
        runBackground('updateDeviceStatusAlive', updateDeviceStatus(supabaseClient, deviceId));
      }

      // Heartbeat must not create access noise; only acknowledge
      return new Response('', { status: 200, headers: corsHeaders });
    }

    // For events without device_id
    const effectiveDeviceId = deviceId || 'unknown-device';

    // ===== IDENTIFICATION EVENTS: Return authorization IMMEDIATELY, then do DB work =====
    // Critical: the device has a short timeout (~15s) and will NOT open the door if
    // the response is delayed by database operations.
    if (eventType === 'identification_event' || eventType === 'enterprise_identification_event') {
      // Never block the immediate response on DB lookup.
      const cachedType = deviceTypeCache.get(effectiveDeviceId) ?? null;
      const deviceType = cachedType;
      const identResponse = buildIdentificationResponse(payload, url, deviceType);
      console.log('Identification response (immediate):', {
        device_id: effectiveDeviceId,
        device_type: deviceType,
        event_type: eventType,
        path: url.pathname,
        portal_id: payload?.portal_id,
        event_in: payload?.event,
        response: identResponse,
      });

      // ALL database work runs in background AFTER response is sent
      runBackground('identificationPostProcess', (async () => {
        let enrichedPayload: any = payload;
        try {
          // Refresh cache asynchronously for subsequent requests.
          runBackground('warmDeviceTypeCache', resolveDeviceType(supabaseClient, effectiveDeviceId));

          // 1. Save photo if present in payload
          let savedPhotoPath: string | null = null;
          const photoBase64 = extractPhotoBase64(payload);
          if (photoBase64) {
            try {
              savedPhotoPath = await saveAccessPhoto(supabaseClient, effectiveDeviceId, photoBase64);
            } catch (e) {
              console.error('Error saving access photo:', e);
            }
          }

          enrichedPayload = savedPhotoPath
            ? { ...payload, saved_photo_path: savedPhotoPath }
            : payload;

          const logEntryId = null;

          // 3. Auto-sync vehicle tag
          const cardValue = String(payload.card_value || '');
          const identUserName = String(payload.user_name || '');
          if (cardValue && identUserName) {
            try {
              const { data: deviceRow } = await supabaseClient
                .from('devices')
                .select('type')
                .or(`serial_number.eq.${effectiveDeviceId},ip_address.eq.${effectiveDeviceId}`)
                .limit(1)
                .maybeSingle();

              if (deviceRow?.type === 'vehicle_tag') {
                const aptMatch = identUserName.match(/^(\d+\w?)\s*[-–]\s*(.+)$/i);
                if (aptMatch) {
                  const [, apt, extractedName] = aptMatch;
                  const normalizedName = extractedName.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                  const { data: residents } = await supabaseClient
                    .from('residents')
                    .select('id, name, vehicle_tag')
                    .ilike('apartment', `%${apt.trim()}`);

                  if (residents && residents.length > 0) {
                    const matched = residents.find((resident: any) => {
                      const residentName = resident.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                      return residentName.includes(normalizedName) || normalizedName.includes(residentName);
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

          // 4. Queue user_get_image if device reports user has image
          const userId = Number.parseInt(String(payload?.user_id ?? '0'), 10);
          const hasImage = payload?.user_has_image === 1 || payload?.user_has_image === '1'
            || payload?.user_has_image === true || payload?.user_has_image === 'true';

          if (hasImage && Number.isFinite(userId) && userId > 0 && !savedPhotoPath) {
            const { data: queuedImageCommands } = await supabaseClient
              .from('push_command_queue')
              .select('id, command, status')
              .eq('device_id', effectiveDeviceId)
              .in('status', ['pending', 'executing'])
              .order('created_at', { ascending: false })
              .limit(10);

            const alreadyQueued = queuedImageCommands?.some((row: any) => {
              const command = row.command as any;
              const commandName = getQueuedCommandName(command);
              const queuedUserId = Number.parseInt(
                String(command?.body?.user_id ?? command?.parameters?.user_id ?? '0'),
                10
              );
              return commandName === 'user_get_image' && queuedUserId === userId;
            }) ?? false;

            if (!alreadyQueued) {
              const { error: queueErr } = await supabaseClient
                .from('push_command_queue')
                .insert({
                  device_id: effectiveDeviceId,
                  command: {
                    verb: 'POST',
                    endpoint: 'user_get_image?get_timestamp=1',
                    body: { user_id: userId, technology: 'visible_light', get_timestamp: 1, raw: false },
                    contentType: 'application/json',
                    meta: { log_id: logEntryId, user_id: userId },
                  },
                  status: 'pending',
                });
              if (queueErr) {
                console.error('Failed to queue user_get_image:', queueErr);
              } else {
                console.log(`Queued user_get_image for user ${userId} on device ${effectiveDeviceId}, log_id: ${logEntryId}`);
              }
            }
          }
        } catch (e) {
          console.error('Error in identification post-processing:', e);
        }

        // 5. Send event to frontend by saving to controlid_logs
        try {
          await supabaseClient.from('controlid_logs').insert({
            device_id: effectiveDeviceId,
            event_type: eventType,
            payload: enrichedPayload,
            processed: true
          });
        } catch (e) {
          console.error('Error inserting identification log:', e);
        }
      })());

      // Return door-open response IMMEDIATELY (< 50ms)
      return new Response(
        JSON.stringify(identResponse),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!checkRateLimit(effectiveDeviceId)) {
      console.error('Rate limit exceeded', { device_id: effectiveDeviceId });
      return new Response(
        JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== NON-IDENTIFICATION EVENTS: Save logs and process =====
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

    const enrichedPayload = savedPhotoPath
      ? { ...payload, saved_photo_path: savedPhotoPath }
      : payload;

    // Process specific events
    if (eventType === 'dao' && payload.object_changes) {
      await processAccessLogs(supabaseClient, payload.object_changes, effectiveDeviceId);
    }

    // Ensure non-identification events also reach the frontend
    if (['dao', 'access_photo', 'catra_event', 'door', 'secbox', 'operation_mode', 'access_event', 'user_event', 'photo_event'].includes(eventType)) {
      try {
        await supabaseClient.from('controlid_logs').insert({
          device_id: effectiveDeviceId,
          event_type: eventType,
          payload: enrichedPayload,
          processed: true
        });
      } catch (e) {
        console.error('Error inserting event log:', e);
      }
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

      console.log('Control iD visual access event received', resident ? `(matched: ${resident.name})` : `(display: ${displayName})`);
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
    // Using string methods instead of regex with backslashes to avoid parsing issues in some environments
    let cleanBase64 = base64Data;
    if (cleanBase64.startsWith('data:image')) {
      const commaIndex = cleanBase64.indexOf(',');
      if (commaIndex !== -1) {
        cleanBase64 = cleanBase64.substring(commaIndex + 1);
      }
    }
    // Remove spaces and newlines
    cleanBase64 = cleanBase64.split(' ').join('').split('\n').join('').split('\r').join('');
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
