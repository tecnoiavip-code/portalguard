import { Device } from '@/types';
import { supabase } from '@/integrations/supabase/client';

export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

function getDeviceSerial(device: Device): string {
  return device.serialNumber || device.id;
}

function normalizePushResult(result: any): any {
  if (!result || typeof result !== 'object') return result || {};
  const parse = (v: unknown) => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!(t.startsWith('{') || t.startsWith('['))) return null;
    try { return JSON.parse(t); } catch { return null; }
  };
  return {
    ...result,
    ...(result.raw_data && typeof result.raw_data === 'object' ? result.raw_data : {}),
    ...(parse(result.raw_data) || {}),
    ...(result.response && typeof result.response === 'object' ? result.response : {}),
    ...(parse(result.response) || {}),
    ...(result.result && typeof result.result === 'object' ? result.result : {}),
  };
}

/**
 * Queue a command to a device via push_command_queue and poll for result.
 */
async function queueCommandAndWait(
  deviceSerial: string,
  endpoint: string,
  body: any,
  timeoutMs = 60000
): Promise<any> {
  const { data: inserted, error: insertErr } = await supabase
    .from('push_command_queue')
    .insert({
      device_id: deviceSerial,
      command: { verb: 'POST', endpoint, body, contentType: 'application/json' },
      status: 'pending',
    } as any)
    .select('id')
    .single();

  if (insertErr || !inserted) {
    throw new Error('Falha ao enfileirar comando: ' + (insertErr?.message || 'unknown'));
  }

  const commandId = inserted.id;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { data: cmd } = await supabase
      .from('push_command_queue')
      .select('status, result')
      .eq('id', commandId)
      .single();

    if (cmd?.status === 'done') {
      return normalizePushResult(cmd.result);
    }
    if (cmd?.status === 'error') {
      const errorResult = normalizePushResult(cmd.result);
      throw new Error(errorResult?.message || errorResult?.error || 'Comando retornou erro do dispositivo');
    }
  }

  throw new Error('Timeout: o dispositivo não respondeu a tempo. Verifique se está online.');
}

/**
 * Capture photo from a Control iD facial device via push queue.
 */
export async function capturePhotoFromDevice(
  device: Device,
  onStatus: (msg: string) => void
): Promise<string | null> {
  const serial = getDeviceSerial(device);
  if (!serial) throw new Error('Dispositivo sem número de série configurado.');

  onStatus('Enviando comando de captura facial ao dispositivo...');

  try {
    const result = await queueCommandAndWait(serial, 'remote_enroll', {
      type: 'face',
      save: false,
      panic: false,
    }, 60000);

    const base64 = result?.user_image || result?.face_image || result?.image;
    if (base64) {
      const clean = String(base64).replace(/^data:image\/[a-z]+;base64,/, '');
      return `data:image/jpeg;base64,${clean}`;
    }
  } catch (err: any) {
    onStatus(`Erro: ${err.message}`);
    throw err;
  }

  // Try take_user_picture as fallback
  try {
    onStatus('Tentando captura alternativa...');
    const result = await queueCommandAndWait(serial, 'take_user_picture', {}, 30000);
    const base64 = result?.image || result?.user_image;
    if (base64) {
      const clean = String(base64).replace(/^data:image\/[a-z]+;base64,/, '');
      return `data:image/jpeg;base64,${clean}`;
    }
  } catch {
    // fallback failed
  }

  return null;
}

/**
 * Read vehicle tags from a Control iD device via push queue.
 */
export async function syncTagsFromDevice(
  device: Device,
  onStatus: (msg: string) => void
): Promise<Array<{ value: string; userId?: number; userName?: string }>> {
  const serial = getDeviceSerial(device);
  if (!serial) throw new Error('Dispositivo sem número de série configurado.');

  onStatus('Buscando TAGs cadastradas no dispositivo...');

  // Load cards
  const cardsResult = await queueCommandAndWait(serial, 'load_objects', { object: 'cards' }, 60000);
  const cards: Array<{ value: number | string; user_id?: number }> = cardsResult?.cards || [];

  onStatus('Buscando usuários do dispositivo...');

  // Load users to match names
  const usersResult = await queueCommandAndWait(serial, 'load_objects', { object: 'users' }, 60000);
  const users: Array<{ id: number; name: string }> = usersResult?.users || [];

  const userMap = new Map(users.map(u => [u.id, u.name]));

  return cards.map(c => ({
    value: String(c.value),
    userId: c.user_id,
    userName: c.user_id ? userMap.get(c.user_id) : undefined,
  }));
}
