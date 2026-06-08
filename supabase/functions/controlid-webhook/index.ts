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

const buildPushDispatchFromQueuedCommand = (queuedCommand: any): Record<string, unknown> => {
  if (Array.isArray(queuedCommand?.transactions)) {
    return { transactions: queuedCommand.transactions };
  }

  // Keep both payload styles for maximum firmware compatibility:
  // - legacy: { verb, endpoint, body, contentType, queryString }
  // - flat:   { command, parameters }
  const defaultVerb = sanitizeString(queuedCommand?.verb || 'POST', 12) || 'POST';
  const defaultContentType = sanitizeString(queuedCommand?.contentType || 'application/json', 100) || 'application/json';

  // New schema (flat command + parameters)
  if (queuedCommand && typeof queuedCommand.command === 'string') {
    const command = sanitizeString(String(queuedCommand.command).replace(/\.fcgi$/i, ''), 120) || 'noop';
    const parameters = queuedCommand.parameters && typeof queuedCommand.parameters === 'object'
      ? queuedCommand.parameters
      : {};

    return {
      command,
      parameters,
      verb: defaultVerb,
      endpoint: command,
      body: parameters,
      contentType: defaultContentType,
    };
  }

  // Old schema: { endpoint, body, contentType, ... }
  const endpointRaw = sanitizeString(String(queuedCommand?.endpoint || ''), 200);
  const endpointNoExt = endpointRaw.replace(/\.fcgi$/i, '');
  const [endpointBaseRaw, queryRaw = ''] = endpointNoExt.split('?');
  const endpointBase = sanitizeString(endpointBaseRaw, 120) || 'noop';
  const endpointLegacy = queryRaw ? `${endpointBase}?${queryRaw}` : endpointBase;

  const body = queuedCommand?.body ?? {};
  const bodyParams = body && typeof body === 'object' && !Array.isArray(body)
    ? body
    : (typeof body === 'string' && body.length > 0 ? { data: body } : {});
  const queryParams = parseQueryStringToObject(queryRaw);

  const payload: Record<string, unknown> = {
    command: endpointBase,
    parameters: { ...queryParams, ...(bodyParams as Record<string, unknown>) },
    verb: defaultVerb,
    endpoint: endpointLegacy,
    body,
    contentType: defaultContentType,
  };

  if (queryRaw) {
    payload.queryString = queryRaw;
  }

  return payload;
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
const lastStaleRequeueCheckMap = new Map<string, number>();
const lastImageFetchQueueMap = new Map<string, number>();
const registeredDeviceAuthCacheMap = new Map<string, { allowed: boolean; expiresAt: number }>();
const lastDashboardBroadcastMap = new Map<string, number>();
const lastVehicleTagAutosyncMap = new Map<string, number>();

// Throttle DB-heavy maintenance checks to preserve Supabase free-plan quota.
const lastConfigRefreshCheckMap = new Map<string, number>();
const CONFIG_REFRESH_CHECK_INTERVAL_MS = 1800000; // 30 minutes
const CONFIG_REFRESH_INTERVAL_MS = 14400000; // 4 hours
const DEVICE_STATUS_WRITE_INTERVAL_MS = 120000; // 2 minutes
const STALE_REQUEUE_CHECK_INTERVAL_MS = 60000; // 1 minute
const NO_COMMAND_PUSH_DELAY_MS = Number.parseInt(Deno.env.get('CONTROLID_NO_COMMAND_DELAY_MS') ?? '2500', 10);
const IMAGE_FETCH_REQUEUE_INTERVAL_MS = Number.parseInt(Deno.env.get('CONTROLID_IMAGE_FETCH_REQUEUE_INTERVAL_MS') ?? '1800000', 10);
const DASHBOARD_BROADCAST_DEDUP_INTERVAL_MS = Number.parseInt(Deno.env.get('CONTROLID_DASHBOARD_DEDUP_MS') ?? '3000', 10);
const VEHICLE_TAG_AUTOSYNC_INTERVAL_MS = Number.parseInt(Deno.env.get('CONTROLID_VEHICLE_TAG_AUTOSYNC_MS') ?? '3600000', 10);
const STALE_EXECUTING_THRESHOLD_MS = 120000; // 120 seconds
const MAX_STALE_REQUEUE_RETRIES = 3;

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isFinitePositiveNumber = (value: number) => Number.isFinite(value) && value > 0;

const shouldRunThrottled = (map: Map<string, number>, key: string, intervalMs: number): boolean => {
  if (!key || !isFinitePositiveNumber(intervalMs)) return true;
  const now = Date.now();
  const lastRun = map.get(key) || 0;
  if (now - lastRun < intervalMs) return false;
  map.set(key, now);
  return true;
};

const getWebhookSecretQueryParam = (): string => {
  const webhookSecret = sanitizeString(Deno.env.get('CONTROLID_WEBHOOK_SECRET') ?? '', 1024);
  const appendSecretToCallbackUrls = (Deno.env.get('CONTROLID_APPEND_SECRET_TO_DEVICE_URLS') ?? (webhookSecret ? '1' : '0')) === '1';
  if (!appendSecretToCallbackUrls || !webhookSecret) return '';
  return `secret=${encodeURIComponent(webhookSecret)}`;
};

const appendQueryString = (path: string, queryString: string): string => {
  if (!queryString) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${queryString}`;
};

const normalizeObjectCandidate = (value: unknown): Record<string, unknown> | null => {
  const parsed = tryParseJsonString(value);
  const candidate = parsed ?? value;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  return candidate as Record<string, unknown>;
};

const normalizeArrayCandidate = (value: unknown): unknown[] => {
  const parsed = tryParseJsonString(value);
  const candidate = parsed ?? value;
  if (Array.isArray(candidate)) return candidate;
  if (candidate && typeof candidate === 'object') return [candidate];
  return [];
};

const extractAccessLogRows = (payload: any): Record<string, unknown>[] => {
  const parsedResponse = tryParseJsonString(payload?.response);
  const parsedRawData = tryParseJsonString(payload?.raw_data);
  const parsedResult = tryParseJsonString(payload?.result);

  const directCandidates: unknown[] = [
    payload?.access_logs,
    payload?.result?.access_logs,
    parsedResponse?.access_logs,
    parsedRawData?.access_logs,
    parsedResult?.access_logs,
  ];

  const rows: Record<string, unknown>[] = [];
  for (const candidate of directCandidates) {
    for (const item of normalizeArrayCandidate(candidate)) {
      const normalized = normalizeObjectCandidate(item);
      if (normalized) rows.push(normalized);
    }
  }

  const objectChanges = Array.isArray(payload?.object_changes) ? payload.object_changes : [];
  for (const change of objectChanges) {
    if (change?.object !== 'access_logs') continue;
    const normalized = normalizeObjectCandidate(change?.values);
    if (normalized) rows.push(normalized);
  }

  return rows;
};

const hasActionableAccessLogs = (payload: any): boolean => {
  const rows = extractAccessLogRows(payload);
  if (rows.length === 0) return false;

  return rows.some((row) => (
    row.card_value !== undefined ||
    row.uhf_tag !== undefined ||
    row.qrcode_value !== undefined ||
    row.identifier_id !== undefined ||
    row.user_id !== undefined ||
    row.user_name !== undefined ||
    row.name !== undefined ||
    row.event !== undefined ||
    row.portal_id !== undefined
  ));
};

const buildAccessLogEventPayload = (payload: any) => {
  const rows = extractAccessLogRows(payload);
  const firstRow = rows[0] ?? {};
  return {
    ...payload,
    ...firstRow,
    access_logs_count: rows.length,
  };
};

const getDeviceWebhookPath = (): string => {
  return appendQueryString('/functions/v1/controlid-webhook', getWebhookSecretQueryParam());
};

const getDeviceWebhookUrl = (hostname: string): string => {
  return `https://${hostname}${getDeviceWebhookPath()}`;
};

const getDeviceServerUrl = (hostname: string): string => {
  return getDeviceWebhookUrl(hostname);
};

const getControlIdServerDeviceId = (): number => {
  const raw = Number.parseInt(Deno.env.get('CONTROLID_SERVER_DEVICE_ID') ?? '900001', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 900001;
};

const CONTROLID_DASHBOARD_TOPIC = 'controlid-dashboard';
const CONTROLID_DASHBOARD_EVENT = 'controlid-event';

const compactControlIdPayload = (payload: any): Record<string, unknown> => {
  const allowedKeys = [
    'event',
    'name',
    'portal_id',
    'user_id',
    'user_name',
    'card_value',
    'uhf_tag',
    'qrcode_value',
    'identifier_id',
    'time',
    'access_granted',
    'saved_photo_path',
    'user_has_image',
    'device_type',
  ];

  const compact: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    const value = payload?.[key];
    if (value === undefined || value === null) continue;
    compact[key] = typeof value === 'string' ? sanitizeString(value, 250) : value;
  }

  return compact;
};

const buildControlIdDashboardEvent = (
  deviceId: string,
  eventType: string,
  payload: any,
  processed = true
) => ({
  id: crypto.randomUUID(),
  device_id: sanitizeString(deviceId || 'unknown-device', 100),
  event_type: sanitizeString(eventType || 'unknown', 100),
  payload: { ...compactControlIdPayload(payload), access_granted: processed },
  processed: true,
  received_at: new Date().toISOString(),
});

const getDashboardBroadcastKey = (deviceId: string, eventType: string, payload: any): string => {
  const identity =
    payload?.card_value ||
    payload?.qrcode_value ||
    payload?.uhf_tag ||
    payload?.user_id ||
    payload?.user_name ||
    'unknown';
  const portal = payload?.portal_id ?? payload?.door_id ?? 'default';
  const event = payload?.event ?? eventType;

  return [
    sanitizeString(deviceId || 'unknown-device', 100),
    sanitizeString(eventType || 'unknown', 100),
    sanitizeString(identity, 120),
    sanitizeString(portal, 40),
    sanitizeString(event, 40),
  ].join(':');
};

const shouldBroadcastControlIdEvent = (deviceId: string, eventType: string, payload: any): boolean => {
  const intervalMs = isFinitePositiveNumber(DASHBOARD_BROADCAST_DEDUP_INTERVAL_MS)
    ? DASHBOARD_BROADCAST_DEDUP_INTERVAL_MS
    : 3000;
  const key = getDashboardBroadcastKey(deviceId, eventType, payload);
  const nowMs = Date.now();
  const lastMs = lastDashboardBroadcastMap.get(key) || 0;

  if (nowMs - lastMs < intervalMs) return false;

  lastDashboardBroadcastMap.set(key, nowMs);
  return true;
};

const broadcastControlIdDashboardEvent = async (
  supabaseClient: any,
  deviceId: string,
  eventType: string,
  payload: any,
  processed = true
) => {
  if (!shouldBroadcastControlIdEvent(deviceId, eventType, payload)) {
    return;
  }

  const eventPayload = buildControlIdDashboardEvent(deviceId, eventType, payload, processed);
  const channel = supabaseClient.channel(CONTROLID_DASHBOARD_TOPIC);

  try {
    const response = await channel.send({
      type: 'broadcast',
      event: CONTROLID_DASHBOARD_EVENT,
      payload: eventPayload,
    });

    if (response !== 'ok') {
      console.error('Error broadcasting Control iD dashboard event:', response);
    }
  } catch (error) {
    console.error('Error broadcasting Control iD dashboard event:', error);
  } finally {
    await supabaseClient.removeChannel(channel).catch(() => undefined);
  }
};

const getDeviceEndpointConfig = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  let hostname = '';
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    hostname = 'uqbxicxpphcfcofufxca.supabase.co';
  }

  const webhookPath = getDeviceWebhookPath();
  return {
    hostname,
    webhookPath,
    webhookUrl: `https://${hostname}${webhookPath}`,
    pushUrl: Deno.env.get('CONTROLID_PUSH_REMOTE_ADDRESS') || `https://${hostname}${webhookPath}/push`,
  };
};

const getDeviceConfiguration = () => {
  const { hostname, webhookPath, pushUrl } = getDeviceEndpointConfig();
  const serverDeviceId = getControlIdServerDeviceId();
  const monitorTimeout = Deno.env.get('CONTROLID_MONITOR_REQUEST_TIMEOUT') ?? '5000';
  const onlineTimeout = Deno.env.get('CONTROLID_ONLINE_REQUEST_TIMEOUT') ?? '5000';
  const pushTimeout = Deno.env.get('CONTROLID_PUSH_REQUEST_TIMEOUT') ?? '15000';
  const pushPeriod = Number.parseInt(Deno.env.get('CONTROLID_PUSH_REQUEST_PERIOD_SECONDS') ?? '5', 10);
  const enableOnlineMode = (Deno.env.get('CONTROLID_ENABLE_ONLINE_MODE') ?? '1') !== '0';

  return {
    monitor: {
      request_timeout: monitorTimeout,
      hostname,
      port: '443',
      path: webhookPath,
      alive_interval: Deno.env.get('CONTROLID_MONITOR_ALIVE_INTERVAL') ?? '30000',
      inform_access_event_id: '1',
    },
    push_server: {
      push_request_timeout: pushTimeout,
      push_request_period: Number.isFinite(pushPeriod) && pushPeriod > 0 ? pushPeriod : 5,
      push_remote_address: pushUrl,
    },
    ...(enableOnlineMode ? {
      general: {
        online: '1',
        local_identification: '1',
      },
      online_client: {
        server_id: String(serverDeviceId),
        extract_template: '0',
        contingency_enabled: '1',
        max_request_attempts: Deno.env.get('CONTROLID_ONLINE_MAX_REQUEST_ATTEMPTS') ?? '5',
        request_timeout: onlineTimeout,
        alive_interval: Deno.env.get('CONTROLID_ONLINE_ALIVE_INTERVAL') ?? '30000',
      },
    } : {}),
  };
};

const getControlIdServerDeviceObject = () => {
  const { webhookUrl } = getDeviceEndpointConfig();
  return {
    id: getControlIdServerDeviceId(),
    name: 'PortalGuard Supabase',
    ip: webhookUrl,
    public_key: '',
  };
};

const buildDeviceConfigurationTransactions = () => ({
  transactions: [
    {
      transactionid: 1,
      verb: 'POST',
      endpoint: 'create_or_modify_objects',
      body: {
        object: 'devices',
        values: [getControlIdServerDeviceObject()],
      },
      contentType: 'application/json',
    },
    {
      transactionid: 2,
      verb: 'POST',
      endpoint: 'set_configuration',
      body: getDeviceConfiguration(),
      contentType: 'application/json',
    },
  ],
});

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

  if (payload?.object_changes) return 'dao';
  if (hasActionableAccessLogs(payload)) return 'access_logs_event';

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

  if (payload?.access_logs !== undefined) return hasActionableAccessLogs(payload) ? 'access_logs_event' : 'device_is_alive';
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

const isRegisteredDeviceId = async (supabaseClient: any, deviceId: string): Promise<boolean> => {
  const normalized = sanitizeString(deviceId, 100);
  if (!normalized) return false;

  const cached = registeredDeviceAuthCacheMap.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  let allowed = false;
  const { data: bySerial } = await supabaseClient
    .from('devices')
    .select('id')
    .eq('serial_number', normalized)
    .limit(1)
    .maybeSingle();

  allowed = Boolean(bySerial);

  if (!allowed && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    const { data: byId } = await supabaseClient
      .from('devices')
      .select('id')
      .eq('id', normalized)
      .limit(1)
      .maybeSingle();
    allowed = Boolean(byId);
  }

  registeredDeviceAuthCacheMap.set(normalized, { allowed, expiresAt: Date.now() + 600000 });
  return allowed;
};

const buildDoorAction = (portal: number) => ({ action: 'door', parameters: `door=${portal}` });
const buildSecBoxAction = () => ({ action: 'sec_box', parameters: 'id=65793, reason=1' });

const buildIdentificationActions = (payload: any, deviceType?: string | null) => {
  const portalId = Number.parseInt(String(payload?.portal_id ?? '1'), 10);
  const resolvedPortal = Number.isFinite(portalId) && portalId > 0 ? portalId : 1;

  // Device-specific action mapping (Control iD docs):
  // - iDFlex / iDAccess Pro / iDAccess Nano / iDFace => sec_box
  // - iDAccess / iDFit / iDBox / iDUHF (relay) => door
  // Avoid mixing action types in one online authorization response because some
  // firmwares reject the whole response when one action is not valid for the model.
  if (deviceType === 'facial_recognition') {
    return [buildSecBoxAction()];
  }

  if (deviceType === 'vehicle_tag' || deviceType === 'card_reader') {
    return [buildDoorAction(resolvedPortal)];
  }

  // Unknown device fallback: UHF/card payloads are usually relay/door devices.
  if (payload?.uhf_tag || payload?.card_value || payload?.qrcode_value) {
    return [buildDoorAction(resolvedPortal)];
  }

  // Unknown identified-user fallback: most facial/pro controllers use MAE/sec_box.
  return [buildSecBoxAction()];
};

const isIdentificationPayloadGranted = (
  payload: any,
  options?: { forceGranted?: boolean }
) => {
  const userId = Number.parseInt(String(payload?.user_id ?? '0'), 10);
  const incomingEvent = Number.parseInt(String(payload?.event ?? '0'), 10);
  const userName = sanitizeString(payload?.user_name || payload?.name || '', 200);
  const explicitAccessGranted =
    payload?.access_granted === true ||
    payload?.access_granted === 1 ||
    payload?.access_granted === '1' ||
    String(payload?.access_granted ?? '').toLowerCase() === 'true';

  const isIdentified = (Number.isFinite(userId) && userId > 0) || userName.length > 0;
  const isGrantedByDevice = incomingEvent === 7 || incomingEvent === 8 || explicitAccessGranted;
  // Event 3/6 = device-side denial (unknown card, etc.). Don't grant.
  const isDeniedByDevice = incomingEvent === 3 || incomingEvent === 6;

  return options?.forceGranted === true ? true : (isIdentified || isGrantedByDevice) && !isDeniedByDevice;
};

const buildIdentificationResponse = (
  payload: any,
  url: URL,
  deviceType?: string | null,
  options?: { forceGranted?: boolean }
) => {
  const userId = Number.parseInt(String(payload?.user_id ?? '0'), 10);
  const portalId = Number.parseInt(String(payload?.portal_id ?? '1'), 10);
  const userName = sanitizeString(payload?.user_name || payload?.name || '', 200);
  const granted = isIdentificationPayloadGranted(payload, options);

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

  // Online identification callbacks expect the payload wrapped in "result".
  // A flat response is only useful for direct remote authorization API calls.
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
  if (Array.isArray(queuedCommand?.transactions)) {
    const hasConfigurationTransaction = queuedCommand.transactions.some((transaction: any) =>
      sanitizeString(transaction?.endpoint ?? '', 160).replace(/\.fcgi$/i, '') === 'set_configuration'
    );
    if (hasConfigurationTransaction) return 'set_configuration';
  }

  const directCommand = sanitizeString(queuedCommand?.command ?? '', 160).replace(/\.fcgi$/i, '');
  if (directCommand) return directCommand;

  const endpointRaw = sanitizeString(queuedCommand?.endpoint ?? '', 200).replace(/\.fcgi$/i, '');
  const [endpoint] = endpointRaw.split('?');
  return sanitizeString(endpoint, 160);
};

const buildNoCommandPushResponse = async () => {
  const forceEmptyObject = (Deno.env.get('CONTROLID_PUSH_EMPTY_OBJECT_RESPONSE') ?? '0') === '1';
  if (forceEmptyObject) {
    return new Response(
      JSON.stringify({}),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Control iD Push docs expect an empty 200 response when there is no command.
  return new Response('', { status: 200, headers: corsHeaders });
};

const normalizePushResultPayload = (payload: any): Record<string, unknown> => {
  const base = payload && typeof payload === 'object' ? payload : {};
  const parsedResponse = tryParseJsonString((base as any)?.response);
  const parsedRawData = tryParseJsonString((base as any)?.raw_data);
  const parsedResult = tryParseJsonString((base as any)?.result);

  return {
    ...base,
    ...(parsedResponse && typeof parsedResponse === 'object' ? parsedResponse : {}),
    ...(parsedRawData && typeof parsedRawData === 'object' ? parsedRawData : {}),
    ...(parsedResult && typeof parsedResult === 'object' ? parsedResult : {}),
  };
};

const pickFirstNonEmptyError = (values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || normalized === '{}' || normalized.toLowerCase() === 'ok') continue;
    return normalized.substring(0, 500);
  }
  return null;
};

const extractPushResultError = (payload: any): string | null => {
  const normalized = normalizePushResultPayload(payload);
  const directError = pickFirstNonEmptyError([
    normalized?.error,
    normalized?.message,
    (normalized as any)?.result?.error,
    (normalized as any)?.result?.message,
    (normalized as any)?.response?.error,
    (normalized as any)?.response?.message,
  ]);

  if (directError) return directError;

  if (normalized?.success === false || (normalized as any)?.result?.success === false) {
    return 'device_reported_failure';
  }

  const txResults = Array.isArray((normalized as any)?.transaction_results)
    ? (normalized as any).transaction_results
    : Array.isArray((normalized as any)?.transactions_results)
      ? (normalized as any).transactions_results
      : [];

  for (const tx of txResults) {
    if (!tx || typeof tx !== 'object') continue;
    if ((tx as any).success === false) {
      const txError = pickFirstNonEmptyError([
        (tx as any).error,
        (tx as any).message,
        (tx as any).response,
      ]);
      return txError || 'transaction_failed';
    }
  }

  const responseString = typeof (normalized as any)?.response === 'string'
    ? (normalized as any).response.trim()
    : '';
  if (/^error\b/i.test(responseString)) {
    return responseString.substring(0, 500);
  }

  return null;
};

const isCommandResultSuccessful = (payload: any): boolean => {
  // Legacy rows may not have result payload. Keep them as successful to avoid noisy requeue loops.
  if (payload === null || payload === undefined) return true;
  return extractPushResultError(payload) === null;
};

const buildCommandResultForStorage = (payload: any, errorMessage: string | null): any => {
  if (!errorMessage) return payload;
  if (payload && typeof payload === 'object') {
    return {
      ...payload,
      error: (payload as any).error || errorMessage,
      message: (payload as any).message || errorMessage,
    };
  }
  return { error: errorMessage, payload };
};

const requeueStaleExecutingCommands = async (supabaseClient: any, deviceId: string) => {
  if (!deviceId) return;

  const staleThreshold = new Date(Date.now() - STALE_EXECUTING_THRESHOLD_MS).toISOString();
  const { data: staleRows, error } = await supabaseClient
    .from('push_command_queue')
    .select('id, result')
    .eq('device_id', deviceId)
    .eq('status', 'executing')
    .lt('executed_at', staleThreshold)
    .order('executed_at', { ascending: true })
    .limit(20);

  if (error || !staleRows || staleRows.length === 0) return;

  const nowIso = new Date().toISOString();
  for (const row of staleRows) {
    const prevResult = row?.result && typeof row.result === 'object'
      ? row.result as Record<string, unknown>
      : {};

    const prevRetriesRaw = Number((prevResult as any).stale_retries ?? 0);
    const prevRetries = Number.isFinite(prevRetriesRaw) && prevRetriesRaw > 0 ? prevRetriesRaw : 0;
    const nextRetries = prevRetries + 1;
    const shouldRetry = nextRetries <= MAX_STALE_REQUEUE_RETRIES;

    const nextResult = {
      ...prevResult,
      stale_retries: nextRetries,
      stale_reason: 'auto_expired_stale_executing',
      stale_updated_at: nowIso,
    };

    await supabaseClient
      .from('push_command_queue')
      .update({
        status: shouldRetry ? 'pending' : 'error',
        executed_at: shouldRetry ? null : nowIso,
        result: nextResult,
      })
      .eq('id', row.id)
      .eq('status', 'executing');
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathLower = url.pathname.toLowerCase();

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // CONTROLID_WEBHOOK_SUSPENDED is the only flag that can suspend the integration.
    // Older CONTROLID_WEBHOOK_ENABLED=0 values are ignored to avoid silently breaking devices.
    const controlIdSuspended = (Deno.env.get('CONTROLID_WEBHOOK_SUSPENDED') ?? '0') === '1';
    if (controlIdSuspended) {
      const isFcgiCallback = pathLower.includes('.fcgi');
      if (isFcgiCallback || pathLower.endsWith('/push') || pathLower.includes('/push/')) {
        return new Response('', { status: 200, headers: corsHeaders });
      }

      return new Response(
        JSON.stringify({ success: true, suspended: true, message: 'Control iD integration temporarily suspended' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        const allowRegisteredDevice = deviceId ? await isRegisteredDeviceId(supabaseClient, deviceId) : false;
        if (!allowRegisteredDevice) {
          return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }
        console.warn('Accepted registered Control iD device without webhook secret:', deviceId);
      }
    }

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
      if (deviceId && shouldRunThrottled(lastStaleRequeueCheckMap, deviceId, STALE_REQUEUE_CHECK_INTERVAL_MS)) {
        runBackground(
          'requeueStaleCommandsViaPushRequest',
          requeueStaleExecutingCommands(supabaseClient, deviceId)
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
            const isImageResult = commandName === 'user_get_image';
            let photoUpdatePromise: Promise<unknown> = Promise.resolve();

            if (isImageResult) {
              const imageBase64 = extractPhotoBase64(pushResultPayload);
              if (imageBase64) {
                photoUpdatePromise = (async () => {
                  const photoPath = await saveAccessPhoto(supabaseClient, deviceId, imageBase64);
                  if (photoPath) {
                    console.log('Access photo fetched from device:', photoPath);
                  }
                })();
              }
            }

            const pushError = extractPushResultError(pushResultPayload);
            const nextStatus = pushError ? 'error' : 'done';
            if (pushError) {
              console.error('Push command failed on device:', {
                device_id: deviceId,
                command_id: executingCmd.id,
                error: pushError,
              });
            }

            runBackground('storePushResultViaPush', Promise.all([
              supabaseClient
                .from('push_command_queue')
                .update({
                  status: nextStatus,
                  executed_at: new Date().toISOString(),
                  result: buildCommandResultForStorage(pushResultPayload, pushError),
                })
                .eq('id', executingCmd.id),
              photoUpdatePromise,
            ]));
          }

          return new Response('', { status: 200, headers: corsHeaders });
        }
      }

      // Fetch oldest pending command from DB queue (Long-polling up to 12s)
      let pendingCmd = null;
      let iterations = 0;
      
      while (iterations < 6) {
        const { data, error: fetchErr } = await supabaseClient
          .from('push_command_queue')
          .select('id, command')
          .eq('device_id', deviceId)
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (fetchErr) {
          console.error('Error fetching push queue:', fetchErr);
          break;
        }

        if (data) {
          pendingCmd = data;
          break;
        }

        iterations++;
        if (iterations < 6) await sleep(2000);
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
          return await buildNoCommandPushResponse();
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
              .select('id, command, status, created_at, result')
              .eq('device_id', deviceId)
              .gte('created_at', cutoff)
              .in('status', ['done', 'pending', 'executing'])
              .order('created_at', { ascending: false })
              .limit(20);

            const rows = Array.isArray(recentCfgRows) ? recentCfgRows : [];
            const hasRecentDone = rows.some((row: any) =>
              row?.status === 'done' &&
              getQueuedCommandName(row?.command) === 'set_configuration' &&
              isCommandResultSuccessful(row?.result)
            );
            const hasPendingOrExecuting = rows.some((row: any) =>
              (row?.status === 'pending' || row?.status === 'executing') &&
              getQueuedCommandName(row?.command) === 'set_configuration'
            );

            if (!hasRecentDone && !hasPendingOrExecuting) {
                const fullConfigCommand = buildDeviceConfigurationTransactions();

                await supabaseClient.from('push_command_queue').insert({
                  device_id: deviceId,
                  command: fullConfigCommand,
                  status: 'pending',
                });
                console.log('Auto-queued config refresh for device:', deviceId);
            }
          })());
        }
      }

      return await buildNoCommandPushResponse();
    }

    // ===== PUSH RESULT: Device sends back result of executed command =====
    // POST /push/result or POST /push with result payload
    if (eventType === 'push_result' && req.method === 'POST') {
      const pushResultPayload = payload?.result ?? payload;
      console.log('Push result from device:', deviceId, JSON.stringify(pushResultPayload).substring(0, 300));

      // Auto-expire stale executing commands before matching
      if (deviceId && shouldRunThrottled(lastStaleRequeueCheckMap, deviceId, STALE_REQUEUE_CHECK_INTERVAL_MS)) {
        runBackground(
          'requeueStaleCommandsViaPushResult',
          requeueStaleExecutingCommands(supabaseClient, deviceId)
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
        const isImageResult = commandName === 'user_get_image';
        let photoUpdatePromise: Promise<unknown> = Promise.resolve();

        if (isImageResult) {
          const imageBase64 = extractPhotoBase64(pushResultPayload);
          if (imageBase64) {
            photoUpdatePromise = (async () => {
              const photoPath = await saveAccessPhoto(supabaseClient, deviceId, imageBase64);
              if (photoPath) {
                console.log('Access photo fetched from device:', photoPath);
              }
            })();
          }
        }

        const pushError = extractPushResultError(pushResultPayload);
        const nextStatus = pushError ? 'error' : 'done';
        if (pushError) {
          console.error('Push result reported command error:', {
            device_id: deviceId,
            command_id: executingCmd.id,
            error: pushError,
          });
        }

        runBackground('storePushResult', Promise.all([
          supabaseClient
            .from('push_command_queue')
            .update({
              status: nextStatus,
              executed_at: new Date().toISOString(),
              result: buildCommandResultForStorage(pushResultPayload, pushError),
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

      console.log('Sending config to device:', targetIp);

      const serverDevice = getControlIdServerDeviceObject();
      const fullConfig = getDeviceConfiguration();

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

        const serverObjectUrl = `http://${targetIp}:${targetPort}/create_or_modify_objects.fcgi?session=${session}`;
        const serverObjectResp = await fetch(serverObjectUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            object: 'devices',
            values: [serverDevice],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!serverObjectResp.ok) {
          return new Response(
            JSON.stringify({ error: 'Failed to configure server reference', status: serverObjectResp.status }),
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
            server_device: serverDevice,
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

      try {
        // Attempt to update directly via API if possible
        // (Implementation omitted for brevity)
      } catch (err) {
        console.error('Failed to dispatch config directly:', err);
      }

      // If direct access fails, fallback to queue
      const command = buildDeviceConfigurationTransactions();

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
          config: getDeviceConfiguration()
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

    // ===== ACCESS LOG EVENTS: UHF/TAG readers may send access_logs directly =====
    // These are real vehicle events, not heartbeat. Keep response fast and avoid
    // storing noisy logs, but still broadcast them to the dashboard.
    if (eventType === 'access_logs_event') {
      if (deviceId) {
        runBackground('updateDeviceStatusAccessLog', updateDeviceStatus(supabaseClient, deviceId));
      }

      const accessEventPayload = buildAccessLogEventPayload(payload);
      const accessGranted = isIdentificationPayloadGranted(accessEventPayload);
      const cachedType = deviceTypeCache.get(effectiveDeviceId) ?? null;
      const identResponse = buildIdentificationResponse(accessEventPayload, url, cachedType);
      const dashboardPayload = cachedType
        ? { ...accessEventPayload, device_type: cachedType }
        : accessEventPayload;

      console.log('Access log event received from Control iD:', {
        device_id: effectiveDeviceId,
        event_in: accessEventPayload?.event,
        card_value: accessEventPayload?.card_value,
        uhf_tag: accessEventPayload?.uhf_tag,
        access_granted: accessGranted,
      });

      runBackground('accessLogEventPostProcess', (async () => {
        if (!cachedType) {
          runBackground('warmDeviceTypeCacheFromAccessLog', resolveDeviceType(supabaseClient, effectiveDeviceId));
        }
        await broadcastControlIdDashboardEvent(
          supabaseClient,
          effectiveDeviceId,
          eventType,
          dashboardPayload,
          accessGranted
        );
      })());

      if (accessGranted) {
        return new Response(
          JSON.stringify(identResponse),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response('', { status: 200, headers: corsHeaders });
    }

    // ===== IDENTIFICATION EVENTS: Return authorization IMMEDIATELY, then do DB work =====
    // Critical: the device has a short timeout (~15s) and will NOT open the door if
    // the response is delayed by database operations.
    if (eventType === 'identification_event' || eventType === 'enterprise_identification_event') {
      const cachedType = deviceTypeCache.get(effectiveDeviceId) ?? null;
      const identificationGranted = isIdentificationPayloadGranted(payload);
      const identResponse = buildIdentificationResponse(payload, url, cachedType);

      console.log('Identification event received (autonomous device):', {
        device_id: effectiveDeviceId,
        device_type: cachedType,
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
          let resolvedDeviceType = deviceTypeCache.get(effectiveDeviceId) ?? null;

          // Refresh cache asynchronously for subsequent requests.
          if (!resolvedDeviceType) {
            runBackground('warmDeviceTypeCache', resolveDeviceType(supabaseClient, effectiveDeviceId));
          }

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

          enrichedPayload = {
            ...payload,
            ...(resolvedDeviceType ? { device_type: resolvedDeviceType } : {}),
            ...(savedPhotoPath ? { saved_photo_path: savedPhotoPath } : {}),
          };

          // 3. Auto-sync vehicle tag
          const cardValue = String(payload.card_value || '');
          const identUserName = String(payload.user_name || '');
          if (cardValue && identUserName) {
            try {
              const autosyncIntervalMs = isFinitePositiveNumber(VEHICLE_TAG_AUTOSYNC_INTERVAL_MS)
                ? VEHICLE_TAG_AUTOSYNC_INTERVAL_MS
                : 3600000;
              const autosyncKey = `${effectiveDeviceId}:${cardValue}`;
              const nowMs = Date.now();
              const lastAutosyncMs = lastVehicleTagAutosyncMap.get(autosyncKey) || 0;

              if (nowMs - lastAutosyncMs < autosyncIntervalMs) {
                console.log('Skipping recently checked vehicle TAG autosync:', autosyncKey);
              } else {
                lastVehicleTagAutosyncMap.set(autosyncKey, nowMs);

                if (!resolvedDeviceType) {
                  resolvedDeviceType = await resolveDeviceType(supabaseClient, effectiveDeviceId);
                }

              if (resolvedDeviceType === 'vehicle_tag') {
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
            const imageFetchKey = `${effectiveDeviceId}:${userId}`;
            const nowMs = Date.now();
            const lastImageFetchMs = lastImageFetchQueueMap.get(imageFetchKey) || 0;
            const imageFetchIntervalMs = isFinitePositiveNumber(IMAGE_FETCH_REQUEUE_INTERVAL_MS)
              ? IMAGE_FETCH_REQUEUE_INTERVAL_MS
              : 1800000;

            if (nowMs - lastImageFetchMs < imageFetchIntervalMs) {
              console.log('Skipping recently queued user image fetch:', imageFetchKey);
            } else {
              const imageCutoff = new Date(nowMs - imageFetchIntervalMs).toISOString();
              const { data: queuedImageCommands } = await supabaseClient
                .from('push_command_queue')
                .select('id, command, status, created_at')
                .eq('device_id', effectiveDeviceId)
                .gte('created_at', imageCutoff)
                .in('status', ['pending', 'executing', 'done'])
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

              if (alreadyQueued) {
                lastImageFetchQueueMap.set(imageFetchKey, nowMs);
              }

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
                      meta: { user_id: userId },
                    },
                    status: 'pending',
                  });
                if (queueErr) {
                  console.error('Failed to queue user_get_image:', queueErr);
                } else {
                  lastImageFetchQueueMap.set(imageFetchKey, nowMs);
                  console.log(`Queued user_get_image for user ${userId} on device ${effectiveDeviceId}`);
                }
              }
            }
          }
        } catch (e) {
          console.error('Error in identification post-processing:', e);
        }

        // 5. Send event to frontend without persisting noisy device logs.
        await broadcastControlIdDashboardEvent(supabaseClient, effectiveDeviceId, eventType, enrichedPayload, identificationGranted);
      })());

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

    // Ensure non-identification events also reach the frontend without DB storage.
    if (['dao', 'access_photo', 'catra_event', 'door', 'secbox', 'operation_mode', 'access_event', 'user_event', 'photo_event'].includes(eventType)) {
      runBackground(
        'broadcastControlIdEvent',
        broadcastControlIdDashboardEvent(supabaseClient, effectiveDeviceId, eventType, enrichedPayload, true)
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
  const nowMs = Date.now();
  const lastWriteMs = lastDeviceStatusWriteMap.get(deviceId) || 0;
  if (nowMs - lastWriteMs < DEVICE_STATUS_WRITE_INTERVAL_MS) {
    return; // Throttled — already updated recently
  }
  lastDeviceStatusWriteMap.set(deviceId, nowMs);

  const now = new Date(nowMs).toISOString();

  console.log('Updating throttled device status:', deviceId);

  const { data: deviceRow } = await supabaseClient
    .from('devices')
    .select('id')
    .or(`serial_number.eq.${deviceId},ip_address.eq.${deviceId}`)
    .limit(1)
    .maybeSingle();

  if (deviceRow) {
    await supabaseClient
      .from('devices')
      .update({ last_sync: now, status: 'online' })
      .eq('id', deviceRow.id);
  } else {
    console.log('No matching device found for status update:', deviceId);
  }

  // Update controlid_config only if a matching entry exists (avoid pointless upsert)
  const { count } = await supabaseClient
    .from('controlid_config')
    .select('id', { count: 'exact', head: true })
    .eq('device_id', deviceId);

  if (count && count > 0) {
    await supabaseClient
      .from('controlid_config')
      .update({ last_sync: now, is_active: true })
      .eq('device_id', deviceId);
  }
}
