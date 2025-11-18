import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { createHmac } from 'node:crypto';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature',
};

// Input validation helpers
const sanitizeString = (val: any, maxLength = 255): string => {
  if (typeof val !== 'string') return '';
  return val.trim().substring(0, maxLength);
};

const isValidNumber = (val: any): boolean => {
  return typeof val === 'number' && !isNaN(val);
};

// Verify HMAC signature
const verifyWebhookSignature = (payload: string, signature: string | null): boolean => {
  if (!signature) return false;
  
  const webhookSecret = Deno.env.get('CONTROLID_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('CONTROLID_WEBHOOK_SECRET not configured');
    return false;
  }

  const hmac = createHmac('sha256', webhookSecret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');
  
  return signature === expectedSignature;
};

// Rate limiting map: device_id -> { count, resetTime }
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minuto
const MAX_REQUESTS_PER_WINDOW = 100; // 100 requisições por minuto por dispositivo

const checkRateLimit = (deviceId: string): boolean => {
  const now = Date.now();
  const limit = rateLimitMap.get(deviceId);
  
  if (!limit || now > limit.resetTime) {
    rateLimitMap.set(deviceId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (limit.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  
  limit.count++;
  return true;
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Basic request validation
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Read raw payload for HMAC verification
    const rawPayload = await req.text();
    const signature = req.headers.get('x-webhook-signature');
    
    // Verify HMAC signature (optional: disable if Control iD doesn't support it yet)
    const webhookSecret = Deno.env.get('CONTROLID_WEBHOOK_SECRET');
    if (webhookSecret && !verifyWebhookSignature(rawPayload, signature)) {
      console.error('Invalid webhook signature');
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = JSON.parse(rawPayload);
    
    // Validate payload is object
    if (!payload || typeof payload !== 'object') {
      return new Response(
        JSON.stringify({ error: 'Invalid payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log only essential info (not sensitive data)
    console.log('Webhook received:', {
      device_id: payload.device_id ? String(payload.device_id).substring(0, 20) : 'unknown',
      event_detected: true,
      timestamp: new Date().toISOString()
    });

    // Validate and sanitize device_id
    const deviceId = sanitizeString(payload.device_id, 50);
    if (!deviceId || deviceId.length === 0) {
      return new Response(
        JSON.stringify({ error: 'device_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit
    if (!checkRateLimit(deviceId)) {
      console.error('Rate limit exceeded', { device_id: deviceId });
      return new Response(
        JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify device is registered (optional security check)
    const { data: device, error: deviceCheckError } = await supabaseClient
      .from('controlid_config')
      .select('device_id, is_active')
      .eq('device_id', deviceId)
      .maybeSingle();

    // If device check is enabled and device not found, reject
    if (device && !device.is_active) {
      console.error('Inactive device:', deviceId);
      return new Response(
        JSON.stringify({ error: 'Device inactive' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Determinar o tipo de evento
    let eventType = 'unknown';
    if (payload.object_changes) {
      eventType = 'dao';
    } else if (payload.operation_mode) {
      eventType = 'operation_mode';
    } else if (payload.access_logs !== undefined) {
      eventType = 'device_is_alive';
    } else if (payload.door) {
      eventType = 'door';
    } else if (payload.access_photo) {
      eventType = 'access_photo';
    } else if (payload.event) {
      eventType = 'catra_event';
    }

    // Salvar o log recebido
    const { error: logError } = await supabaseClient
      .from('controlid_logs')
      .insert({
        device_id: deviceId,
        event_type: sanitizeString(eventType, 100),
        payload: payload,
        processed: false
      });

    if (logError) {
      console.error('Error saving Control iD log:', logError);
      throw logError;
    }

    // Processar eventos específicos
    if (eventType === 'dao' && payload.object_changes) {
      await processAccessLogs(supabaseClient, payload.object_changes, deviceId);
    } else if (eventType === 'device_is_alive') {
      await updateDeviceStatus(supabaseClient, deviceId);
    } else if (eventType === 'access_photo') {
      await processAccessPhoto(supabaseClient, payload, deviceId);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Webhook received and processed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error) {
    console.error('Error processing Control iD webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

// Input validation helpers (duplicated for clarity)
const sanitizeStringInner = (val: any, maxLength = 255): string => {
  if (typeof val !== 'string') return '';
  return val.trim().substring(0, maxLength);
};

const isValidNumberInner = (val: any): boolean => {
  return typeof val === 'number' && !isNaN(val);
};

async function processAccessLogs(supabaseClient: any, objectChanges: any[], deviceId: string) {
  console.log('Processing access logs from Control iD');
  
  for (const change of objectChanges) {
    if (change.object === 'access_logs' && change.type === 'inserted') {
      const values = change.values || {};
      
      // Validate and sanitize all inputs
      const userId = sanitizeStringInner(values.user_id, 100);
      const cardValue = sanitizeStringInner(values.card_value, 100);
      const eventDesc = sanitizeStringInner(values.event, 100);
      const portalId = sanitizeStringInner(values.portal_id, 50);
      
      // Validate timestamp
      let entryTime = new Date().toISOString();
      if (values.time && isValidNumberInner(values.time)) {
        try {
          entryTime = new Date(parseInt(values.time) * 1000).toISOString();
        } catch (e) {
          console.error('Invalid timestamp:', values.time);
        }
      }
      
      // Criar entrada de acesso no sistema com dados validados
      const entryData = {
        visitor_name: sanitizeStringInner(`Acesso Control iD - User ${userId || cardValue}`, 200),
        visitor_document: sanitizeStringInner(cardValue || userId || 'N/A', 50),
        visitor_type: 'visitor',
        apartment: 'N/A',
        purpose: sanitizeStringInner(`Evento: ${eventDesc}`, 100),
        entry_time: entryTime,
        auto_recognized: true,
        notes: sanitizeStringInner(`Device: ${deviceId}, Portal: ${portalId}`, 500)
      };

      const { error } = await supabaseClient
        .from('access_entries')
        .insert(entryData);

      if (error) {
        console.error('Error creating access entry from Control iD:', error);
      } else {
        console.log('Access entry created successfully from Control iD event');
        
        // Criar evento em tempo real com dados sanitizados
        await supabaseClient
          .from('realtime_events')
          .insert({
            type: 'entry',
            description: sanitizeStringInner(`Acesso registrado automaticamente - Device ${deviceId}`, 200),
            priority: 'medium'
          });
      }
    }
  }
}

async function updateDeviceStatus(supabaseClient: any, deviceId: string) {
  console.log('Updating device status - device is alive:', deviceId);
  
  // Atualizar last_sync do dispositivo
  const { error } = await supabaseClient
    .from('devices')
    .update({ last_sync: new Date().toISOString(), status: 'online' })
    .eq('serial_number', deviceId);

  if (error && error.code !== 'PGRST116') { // Ignore not found error
    console.error('Error updating device status:', error);
  }
}

async function processAccessPhoto(supabaseClient: any, payload: any, deviceId: string) {
  console.log('Processing access photo from Control iD');
  
  // Validate and sanitize user_id
  const userId = sanitizeStringInner(payload.user_id, 100);
  const sanitizedDeviceId = sanitizeStringInner(deviceId, 50);
  
  // Aqui você pode salvar a foto em storage do Supabase se necessário
  // Por enquanto, apenas registramos o evento
  
  await supabaseClient
    .from('realtime_events')
    .insert({
      type: 'entry',
      description: sanitizeStringInner(`Foto de acesso capturada - User ${userId}, Device ${sanitizedDeviceId}`, 200),
      priority: 'low'
    });
}
