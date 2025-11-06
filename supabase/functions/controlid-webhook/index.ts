import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const payload = await req.json();
    console.log('Received Control iD webhook:', JSON.stringify(payload, null, 2));

    // Extrair device_id do payload
    const deviceId = payload.device_id?.toString() || 'unknown';
    
    // Determinar o tipo de evento
    let eventType = 'unknown';
    if (payload.object_changes) {
      eventType = 'dao'; // Logs de acesso, templates, cards, alarmes
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
        event_type: eventType,
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

async function processAccessLogs(supabaseClient: any, objectChanges: any[], deviceId: string) {
  console.log('Processing access logs from Control iD');
  
  for (const change of objectChanges) {
    if (change.object === 'access_logs' && change.type === 'inserted') {
      const values = change.values;
      
      // Criar entrada de acesso no sistema
      const entryData = {
        visitor_name: `Acesso Control iD - User ${values.user_id}`,
        visitor_document: values.card_value || values.user_id || 'N/A',
        visitor_type: 'visitor',
        apartment: 'N/A', // Pode ser mapeado depois
        purpose: `Evento: ${values.event}`,
        entry_time: new Date(parseInt(values.time) * 1000).toISOString(),
        auto_recognized: true,
        notes: `Device: ${deviceId}, Portal: ${values.portal_id}`
      };

      const { error } = await supabaseClient
        .from('access_entries')
        .insert(entryData);

      if (error) {
        console.error('Error creating access entry from Control iD:', error);
      } else {
        console.log('Access entry created successfully from Control iD event');
        
        // Criar evento em tempo real
        await supabaseClient
          .from('realtime_events')
          .insert({
            type: 'entry',
            description: `Acesso registrado automaticamente - Device ${deviceId}`,
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
  
  // Aqui você pode salvar a foto em storage do Supabase se necessário
  // Por enquanto, apenas registramos o evento
  
  await supabaseClient
    .from('realtime_events')
    .insert({
      type: 'entry',
      description: `Foto de acesso capturada - User ${payload.user_id}, Device ${deviceId}`,
      priority: 'low'
    });
}
