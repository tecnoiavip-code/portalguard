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
  timeoutMs = 60000,
  signal?: AbortSignal
): Promise<any> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

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
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
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
 * Strategy: enroll face to a temporary user, fetch the image, then remove the temp user.
 */
export type CaptureStep = 'preparing' | 'creating_user' | 'enrolling' | 'fetching' | 'cleaning' | 'done' | 'error';

export async function capturePhotoFromDevice(
  device: Device,
  onStatus: (msg: string, step?: CaptureStep, progress?: number) => void,
  signal?: AbortSignal
): Promise<string | null> {
  const serial = getDeviceSerial(device);
  if (!serial) throw new Error('Dispositivo sem número de série configurado.');

  const tempUserId = 999999;
  const checkAbort = () => { if (signal?.aborted) throw new DOMException('Captura cancelada', 'AbortError'); };

  onStatus('Preparando captura facial...', 'preparing', 10);

  try {
    checkAbort();
    // Step 1: Remove temp user if exists
    try {
      await queueCommandAndWait(serial, 'destroy_objects', {
        object: 'users',
        where: { users: { id: tempUserId } },
      }, 15000, signal);
    } catch (e: any) {
      if (e.name === 'AbortError') throw e;
    }

    checkAbort();
    onStatus('Criando usuário temporário...', 'creating_user', 25);
    await queueCommandAndWait(serial, 'create_objects', {
      object: 'users',
      values: [{ id: tempUserId, name: 'TEMP_CAPTURE', registration: 'TEMP' }],
    }, 15000, signal);

    checkAbort();
    onStatus('Posicione o rosto na frente do dispositivo...', 'enrolling', 40);
    await queueCommandAndWait(serial, 'remote_enroll', {
      type: 'face',
      save: true,
      user_id: tempUserId,
      panic: false,
    }, 60000, signal);

    checkAbort();
    onStatus('Buscando foto capturada...', 'fetching', 70);
    const photoResult = await queueCommandAndWait(serial, 'user_get_image', {
      user_id: tempUserId,
    }, 30000, signal);

    onStatus('Finalizando...', 'cleaning', 90);
    try {
      await queueCommandAndWait(serial, 'destroy_objects', {
        object: 'users',
        where: { users: { id: tempUserId } },
      }, 15000);
    } catch { /* ignore */ }

    const base64 = photoResult?.user_image || photoResult?.image || photoResult?.photo;
    if (base64) {
      const clean = String(base64).replace(/^data:image\/[a-z]+;base64,/, '');
      onStatus('Foto capturada com sucesso!', 'done', 100);
      return `data:image/jpeg;base64,${clean}`;
    }

    onStatus('Dispositivo não retornou imagem. Tente novamente.', 'error', 0);
    return null;
  } catch (err: any) {
    // Clean up on error
    try {
      await queueCommandAndWait(serial, 'destroy_objects', {
        object: 'users',
        where: { users: { id: tempUserId } },
      }, 10000);
    } catch { /* ignore */ }

    if (err.name === 'AbortError') {
      onStatus('Captura cancelada.', 'error', 0);
      return null;
    }

    onStatus(`Erro: ${err.message}`, 'error', 0);
    throw err;
  }
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

interface Resident {
  id: string;
  name: string;
  apartment: string;
  photo?: string;
}

/**
 * Sync all photos from facial recognition devices to resident profiles.
 * Gets user list from device, fetches photos for users with images,
 * matches to residents by name/apartment, and uploads to storage.
 */
export async function syncPhotosFromDevices(
  devices: Device[],
  residents: Resident[],
  onProgress: (msg: string, current: number, total: number) => void
): Promise<{ synced: number; skipped: number; errors: number }> {
  const facialDevices = devices.filter(d => d.type === 'facial_recognition');
  if (facialDevices.length === 0) throw new Error('Nenhum dispositivo facial cadastrado.');

  const normalizeStr = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const device of facialDevices) {
    const serial = getDeviceSerial(device);
    if (!serial) continue;

    onProgress(`Buscando usuários de "${device.name}"...`, synced, 0);

    let users: Array<{ id: number; name: string; image_timestamp: number }> = [];
    try {
      const result = await queueCommandAndWait(serial, 'load_objects', { object: 'users' }, 60000);
      users = result?.users || [];
    } catch (e) {
      console.error(`Error loading users from ${device.name}:`, e);
      errors++;
      continue;
    }

    // Filter users that have photos (image_timestamp > 0)
    const usersWithPhotos = users.filter(u => u.image_timestamp > 0 && u.name);
    const total = usersWithPhotos.length;
    onProgress(`Encontrados ${total} usuários com foto em "${device.name}"`, synced, total);

    for (let i = 0; i < usersWithPhotos.length; i++) {
      const deviceUser = usersWithPhotos[i];
      const userName = deviceUser.name;

      // Parse "APT - NAME" format
      const aptMatch = userName.match(/^(\d+\w?)\s*[-–]\s*(.+)$/i);
      let matchedResident: Resident | undefined;

      if (aptMatch) {
        const [, apt, extractedName] = aptMatch;
        const normalizedName = normalizeStr(extractedName);
        matchedResident = residents.find(r =>
          String(r.apartment).trim() === apt.trim() &&
          (normalizeStr(r.name).includes(normalizedName) || normalizedName.includes(normalizeStr(r.name)))
        );
      }

      if (!matchedResident) {
        // Try matching by full name
        const normalizedUserName = normalizeStr(userName);
        matchedResident = residents.find(r => {
          const rName = normalizeStr(r.name);
          return rName === normalizedUserName || rName.includes(normalizedUserName) || normalizedUserName.includes(rName);
        });
      }

      if (!matchedResident) {
        skipped++;
        continue;
      }

      // Skip if resident already has a photo
      if (matchedResident.photo) {
        skipped++;
        continue;
      }

      onProgress(`Baixando foto: ${userName} (${i + 1}/${total})`, synced, total);

      try {
        const photoResult = await queueCommandAndWait(serial, 'user_get_image', {
          user_id: deviceUser.id,
        }, 30000);

        const base64 = photoResult?.user_image || photoResult?.image || photoResult?.photo;
        if (base64) {
          const clean = String(base64).replace(/^data:image\/[a-z]+;base64,/, '');
          const dataUrl = `data:image/jpeg;base64,${clean}`;

          // Upload to storage
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
          const path = `${matchedResident.id}/photo.jpg`;

          await supabase.storage.from('resident-photos').remove([path]);
          const { error: uploadErr } = await supabase.storage
            .from('resident-photos')
            .upload(path, file, { upsert: true });

          if (!uploadErr) {
            synced++;
          } else {
            console.error('Upload error:', uploadErr);
            errors++;
          }
        } else {
          skipped++;
        }
      } catch (e) {
        console.error(`Error fetching photo for ${userName}:`, e);
        errors++;
      }
    }
  }

  return { synced, skipped, errors };
}
