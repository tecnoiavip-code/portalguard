import { Device } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { invalidateCache } from '@/lib/supabase-storage';

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

function extractImageBase64(result: any): string | null {
  const candidates = [
    result?.raw_base64,
    result?.response,
    result?.raw_data,
    result?.user_image,
    result?.user_image_hash,
    result?.user_image_data,
    result?.face_image,
    result?.image,
    result?.photo,
    result?.result?.user_image,
    result?.result?.user_image_hash,
    result?.result?.user_image_data,
    result?.result?.image,
    result?.result?.photo,
    result?.result?.raw_base64,
    result?.result?.response,
  ];

  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const clean = value.replace(/^data:image\/[^;]+;base64,/i, '').replace(/\s+/g, '');
    if (clean.length > 100) return clean.replace(/-/g, '+').replace(/_/g, '/');
  }
  return null;
}

function deviceUserHasPhoto(user: any): boolean {
  return Number(user?.image_timestamp || 0) > 0
    || user?.user_has_image === true
    || user?.user_has_image === 1
    || user?.has_image === true
    || user?.has_image === 1;
}

function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function buildCardObjectId(userId: number, cardValue: number): number {
  const raw = Math.abs(hashCode(`${userId}:${cardValue}`));
  if (raw > 0) return raw;
  const fallback = Math.abs(userId) + 1;
  return fallback > 0 ? fallback : 1;
}

/**
 * Queue a command to a device via push_command_queue and wait for result using Realtime.
 * Otimização: em vez de polling a cada 2s (30 queries em 60s), usa Realtime subscription (1 query + listener)
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

  // Otimização: usar Realtime em vez de polling
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      supabase.removeChannel(channel);
      reject(new Error('Timeout: o dispositivo não respondeu a tempo. Verifique se está online.'));
    }, timeoutMs);

    const abortHandler = () => {
      clearTimeout(timeoutHandle);
      supabase.removeChannel(channel);
      reject(new DOMException('Cancelled', 'AbortError'));
    };

    signal?.addEventListener('abort', abortHandler);

    const channel = supabase
      .channel(`push_result_${commandId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'push_command_queue',
          filter: `id=eq.${commandId}`,
        },
        (payload) => {
          const cmd = payload.new as any;
          if (cmd?.status === 'done') {
            clearTimeout(timeoutHandle);
            signal?.removeEventListener('abort', abortHandler);
            supabase.removeChannel(channel);
            resolve(normalizePushResult(cmd.result));
          } else if (cmd?.status === 'error') {
            clearTimeout(timeoutHandle);
            signal?.removeEventListener('abort', abortHandler);
            supabase.removeChannel(channel);
            const errorResult = normalizePushResult(cmd.result);
            reject(new Error(errorResult?.message || errorResult?.error || 'Comando retornou erro do dispositivo'));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          clearTimeout(timeoutHandle);
          signal?.removeEventListener('abort', abortHandler);
          reject(new Error('Erro ao conectar ao Realtime'));
        }
      });
  });
}

async function queueBinaryCommandAndWait(
  deviceSerial: string,
  endpoint: string,
  binaryBase64: string,
  queryParams: Record<string, string | number>,
  timeoutMs = 60000,
  signal?: AbortSignal
): Promise<any> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

  const endpointWithQuery = (() => {
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => params.set(key, String(value)));
    const qs = params.toString();
    return qs ? `${endpoint}?${qs}` : endpoint;
  })();

  const { data: inserted, error: insertErr } = await supabase
    .from('push_command_queue')
    .insert({
      device_id: deviceSerial,
      command: {
        verb: 'POST',
        endpoint: endpointWithQuery,
        body: binaryBase64,
        contentType: 'application/octet-stream',
      },
      status: 'pending',
    } as any)
    .select('id')
    .single();

  if (insertErr || !inserted) {
    throw new Error('Falha ao enfileirar comando binário: ' + (insertErr?.message || 'unknown'));
  }

  const commandId = inserted.id;

  // Otimização: usar Realtime em vez de polling
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      supabase.removeChannel(channel);
      reject(new Error('Timeout: o dispositivo não respondeu a tempo. Verifique se está online.'));
    }, timeoutMs);

    const abortHandler = () => {
      clearTimeout(timeoutHandle);
      supabase.removeChannel(channel);
      reject(new DOMException('Cancelled', 'AbortError'));
    };

    signal?.addEventListener('abort', abortHandler);

    const channel = supabase
      .channel(`push_result_binary_${commandId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'push_command_queue',
          filter: `id=eq.${commandId}`,
        },
        (payload) => {
          const cmd = payload.new as any;
          if (cmd?.status === 'done') {
            clearTimeout(timeoutHandle);
            signal?.removeEventListener('abort', abortHandler);
            supabase.removeChannel(channel);
            resolve(normalizePushResult(cmd.result));
          } else if (cmd?.status === 'error') {
            clearTimeout(timeoutHandle);
            signal?.removeEventListener('abort', abortHandler);
            supabase.removeChannel(channel);
            const errorResult = normalizePushResult(cmd.result);
            reject(new Error(errorResult?.message || errorResult?.error || 'Comando binário retornou erro do dispositivo'));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          clearTimeout(timeoutHandle);
          signal?.removeEventListener('abort', abortHandler);
          reject(new Error('Erro ao conectar ao Realtime'));
        }
      });
  });
}

/**
 * Info about the person being enrolled, used to persist biometrics on the device.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchUserImageBase64WithRetries(
  deviceSerial: string,
  userId: number,
  signal?: AbortSignal,
  onAttempt?: (attempt: number, total: number) => void
): Promise<string | null> {
  const attempts: Array<{ endpoint: string; body: Record<string, any>; timeoutMs: number }> = [
    {
      endpoint: 'user_get_image?get_timestamp=1',
      body: { user_id: userId, technology: 'visible_light', get_timestamp: 1, raw: false },
      timeoutMs: 90000,
    },
    {
      endpoint: 'user_get_image?get_timestamp=1',
      body: { user_id: userId, image_type: 'face', get_timestamp: 1, raw: false },
      timeoutMs: 90000,
    },
    {
      endpoint: 'user_get_image',
      body: { user_id: userId, technology: 'visible_light' },
      timeoutMs: 90000,
    },
  ];

  let lastError: Error | null = null;

  for (let i = 0; i < attempts.length; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const attemptNumber = i + 1;
    onAttempt?.(attemptNumber, attempts.length);

    const attempt = attempts[i];
    try {
      const result = await queueCommandAndWait(
        deviceSerial,
        attempt.endpoint,
        attempt.body,
        attempt.timeoutMs,
        signal
      );
      const base64 = extractImageBase64(result);
      if (base64) return base64;
      lastError = new Error('O dispositivo respondeu sem dados de imagem.');
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error || 'Falha ao obter imagem.'));
    }

    if (i < attempts.length - 1) {
      await sleep(2000);
    }
  }

  if (lastError) throw lastError;
  return null;
}

export interface CapturePersonInfo {
  /** Person name */
  name: string;
  /** Apartment number (for residents) */
  apartment?: string;
  /** Document (CPF for residents, visitor doc for visitors/providers) */
  document?: string;
  /** Unique identifier (resident UUID or visitor document) used to generate device user ID */
  identifier: string;
  /** Registration string saved on device (e.g. CPF or document) */
  registration?: string;
}

/**
 * Capture photo from a Control iD facial device via push queue.
 * When personInfo is provided, the biometric is persisted on the device (like iD Secure).
 * When personInfo is omitted, falls back to temporary user strategy.
 */
export type CaptureStep = 'preparing' | 'creating_user' | 'enrolling' | 'fetching' | 'cleaning' | 'done' | 'error';

export async function capturePhotoFromDevice(
  device: Device,
  onStatus: (msg: string, step?: CaptureStep, progress?: number) => void,
  signal?: AbortSignal,
  personInfo?: CapturePersonInfo
): Promise<string | null> {
  const serial = getDeviceSerial(device);
  if (!serial) throw new Error('Dispositivo sem número de série configurado.');

  const persistOnDevice = !!personInfo;
  const deviceUserId = persistOnDevice
    ? Math.abs(hashCode(personInfo.identifier))
    : 999999;

  // Build device user name in "APT - Name" format (like iD Secure)
  const deviceUserName = persistOnDevice
    ? (personInfo.apartment ? `${personInfo.apartment} - ${personInfo.name}` : personInfo.name)
    : 'TEMP_CAPTURE';

  const deviceRegistration = persistOnDevice
    ? (personInfo.registration || personInfo.document || personInfo.identifier)
    : 'TEMP';

  const checkAbort = () => { if (signal?.aborted) throw new DOMException('Captura cancelada', 'AbortError'); };

  onStatus('Preparando captura facial...', 'preparing', 10);

  // Clean up stale executing/pending commands for this device before starting
  try {
    await supabase
      .from('push_command_queue')
      .update({ status: 'error', result: { error: 'stale_cleanup_before_capture' } as any })
      .eq('device_id', serial)
      .in('status', ['executing', 'pending']);
  } catch { /* ignore cleanup errors */ }

  try {
    checkAbort();

    // Step 1: Remove existing user on device (to update data if re-enrolling)
    try {
      await queueCommandAndWait(serial, 'destroy_objects', {
        object: 'users',
        where: { users: { id: deviceUserId } },
      }, 15000, signal);
    } catch (e: any) {
      if (e.name === 'AbortError') throw e;
    }

    checkAbort();
    onStatus(
      persistOnDevice
        ? `Registrando ${personInfo.name} no dispositivo...`
        : 'Criando usuário temporário...',
      'creating_user', 25
    );
    await queueCommandAndWait(serial, 'create_objects', {
      object: 'users',
      values: [{ id: deviceUserId, name: deviceUserName, registration: deviceRegistration }],
    }, 15000, signal);

    checkAbort();
    onStatus('Posicione o rosto na frente do dispositivo...', 'enrolling', 40);
    await queueCommandAndWait(serial, 'remote_enroll', {
      type: 'face',
      save: true,
      user_id: deviceUserId,
      timeout: 30,
      panic: false,
    }, 60000, signal);

    checkAbort();
    onStatus('Buscando foto capturada...', 'fetching', 70);
    const base64 = await fetchUserImageBase64WithRetries(
      serial,
      deviceUserId,
      signal,
      (attempt, total) => {
        const progress = Math.min(89, 70 + attempt * 6);
        onStatus(`Baixando foto capturada (tentativa ${attempt}/${total})...`, 'fetching', progress);
      }
    );

    // Only clean up if NOT persisting on device
    if (!persistOnDevice) {
      onStatus('Finalizando...', 'cleaning', 90);
      try {
        await queueCommandAndWait(serial, 'destroy_objects', {
          object: 'users',
          where: { users: { id: deviceUserId } },
        }, 15000);
      } catch { /* ignore */ }
    } else {
      onStatus('Biometria salva no dispositivo!', 'cleaning', 90);
    }

    if (base64) {
      onStatus(
        persistOnDevice
          ? 'Foto capturada e biometria registrada no dispositivo!'
          : 'Foto capturada com sucesso!',
        'done', 100
      );
      return `data:image/jpeg;base64,${base64}`;
    }

    onStatus('Dispositivo não retornou imagem. Tente novamente.', 'error', 0);
    return null;
  } catch (err: any) {
    // Clean up on error only if using temp user
    if (!persistOnDevice) {
      try {
        await queueCommandAndWait(serial, 'destroy_objects', {
          object: 'users',
          where: { users: { id: deviceUserId } },
        }, 10000);
      } catch { /* ignore */ }
    }

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
      const aptMatch = userName.match(/^(\d+\w?)\s*[-\u2013]\s*(.+)$/i);
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
        const base64 = await fetchUserImageBase64WithRetries(serial, deviceUser.id);
        if (base64) {
          const dataUrl = `data:image/jpeg;base64,${base64}`;

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

/**
 * Sync a resident's biometric (photo) to all facial recognition devices.
 * Creates the user on each device and sets their facial image.
 */
export async function syncBiometricToAllDevices(
  facialDevices: Device[],
  personInfo: CapturePersonInfo,
  photoBase64: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ synced: number; errors: number; details: string[] }> {
  if (facialDevices.length === 0) {
    return { synced: 0, errors: 0, details: ['Nenhum dispositivo facial cadastrado.'] };
  }

  const deviceUserId = Math.abs(hashCode(personInfo.identifier));
  const deviceUserName = personInfo.apartment
    ? `${personInfo.apartment} - ${personInfo.name}`
    : personInfo.name;
  const deviceRegistration = personInfo.registration || personInfo.document || personInfo.identifier;

  // Clean base64 for device (remove data URI prefix)
  const cleanBase64 = photoBase64.replace(/^data:image\/[a-z]+;base64,/, '');

  let synced = 0;
  let errors = 0;
  const details: string[] = [];

  for (let i = 0; i < facialDevices.length; i++) {
    const device = facialDevices[i];
    const serial = getDeviceSerial(device);
    if (!serial) {
      details.push(`${device.name}: sem numero de serie`);
      errors++;
      continue;
    }

    onProgress?.(`Sincronizando ${device.name} (${i + 1}/${facialDevices.length})...`, i, facialDevices.length);

    try {
      // Remove stale duplicates for this resident on this device.
      // Priority: registration match; fallback: exact normalized label match.
      const registrationKey = normalizeText(deviceRegistration);
      const nameKey = normalizeText(deviceUserName);
      let removedDuplicates = 0;

      try {
        const usersResult = await queueCommandAndWait(serial, 'load_objects', {
          object: 'users',
        }, 30000);

        const users = Array.isArray(usersResult?.users) ? usersResult.users : [];
        for (const existingUser of users) {
          const existingId = Number(existingUser?.id || 0);
          if (!Number.isFinite(existingId) || existingId <= 0 || existingId === deviceUserId) continue;

          const existingRegistration = normalizeText(String(existingUser?.registration || ''));
          const existingName = normalizeText(String(existingUser?.name || ''));
          const byRegistration = !!registrationKey && existingRegistration === registrationKey;
          const byName = !registrationKey && !!nameKey && existingName === nameKey;

          if (!byRegistration && !byName) continue;

          try {
            await queueCommandAndWait(serial, 'destroy_objects', {
              object: 'users',
              where: { users: { id: existingId } },
            }, 15000);
            removedDuplicates++;
          } catch {
            // ignore per-user cleanup failure and continue
          }
        }
      } catch {
        // if we fail to list users, continue with upsert flow
      }

      // Upsert user on device (idempotent, avoids duplicates by id).
      await queueCommandAndWait(serial, 'create_or_modify_objects', {
        object: 'users',
        values: [{ id: deviceUserId, name: deviceUserName, registration: deviceRegistration }],
      }, 20000);

      // Set the facial image on the device
      await queueBinaryCommandAndWait(serial, 'user_set_image', cleanBase64, {
        user_id: deviceUserId,
        timestamp: Math.floor(Date.now() / 1000),
      }, 30000);

      synced++;
      details.push(
        removedDuplicates > 0
          ? `${device.name}: sincronizado (${removedDuplicates} duplicado(s) removido(s))`
          : `${device.name}: sincronizado`
      );
    } catch (err: any) {
      errors++;
      details.push(`${device.name}: erro - ${err.message}`);
      console.error(`Biometric sync error on ${device.name}:`, err);
    }
  }

  onProgress?.('Sincronizacao concluida!', facialDevices.length, facialDevices.length);
  return { synced, errors, details };
}

/**
 * Sync a vehicle TAG (UHF) to all facial/tag devices.
 * Creates the user (if missing) and registers the card on each device.
 */
export async function syncTagToAllDevices(
  devices: Device[],
  personInfo: CapturePersonInfo,
  tagValue: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ synced: number; errors: number; details: string[] }> {
  const targetDevices = devices.filter(
    (d) => d.type === 'facial_recognition' || d.type === 'vehicle_tag'
  );
  if (targetDevices.length === 0 || !tagValue) {
    return { synced: 0, errors: 0, details: [] };
  }

  const deviceUserId = Math.abs(hashCode(personInfo.identifier));
  const deviceUserName = personInfo.apartment
    ? `${personInfo.apartment} - ${personInfo.name}`
    : personInfo.name;
  const deviceRegistration = personInfo.registration || personInfo.document || personInfo.identifier;
  const cardValue = Number(String(tagValue).replace(/\D/g, '')) || 0;
  if (!Number.isFinite(cardValue) || cardValue <= 0) {
    return { synced: 0, errors: 1, details: ['TAG invalida para sincronizacao.'] };
  }

  let synced = 0;
  let errors = 0;
  const details: string[] = [];

  for (let i = 0; i < targetDevices.length; i++) {
    const device = targetDevices[i];
    const serial = getDeviceSerial(device);
    if (!serial) {
      errors++;
      details.push(`${device.name}: sem numero de serie`);
      continue;
    }

    onProgress?.(`Sincronizando TAG em ${device.name}...`, i, targetDevices.length);

    try {
      // Upsert user before binding cards.
      await queueCommandAndWait(serial, 'create_or_modify_objects', {
        object: 'users',
        values: [{ id: deviceUserId, name: deviceUserName, registration: deviceRegistration }],
      }, 20000);

      // Remove stale cards attached to this user (keep only one current tag).
      try {
        await queueCommandAndWait(serial, 'destroy_objects', {
          object: 'cards',
          where: { cards: { user_id: deviceUserId } },
        }, 15000);
      } catch {
        // ignore cleanup failure
      }

      // Remove this tag value from any other user (value is unique in Control iD).
      try {
        await queueCommandAndWait(serial, 'destroy_objects', {
          object: 'cards',
          where: { cards: { value: cardValue } },
        }, 15000);
      } catch {
        // ignore if value does not exist yet
      }

      // Upsert card with deterministic id to avoid duplicate rows.
      await queueCommandAndWait(serial, 'create_or_modify_objects', {
        object: 'cards',
        values: [{ id: buildCardObjectId(deviceUserId, cardValue), value: cardValue, user_id: deviceUserId }],
      }, 20000);

      synced++;
      details.push(`${device.name}: TAG sincronizada`);
    } catch (err: any) {
      errors++;
      details.push(`${device.name}: erro - ${err.message}`);
      console.error(`Tag sync error on ${device.name}:`, err);
    }
  }

  return { synced, errors, details };
}

/**
 * Remove a user (and their face/cards) from ALL devices.
 * Used when a resident is deleted from the system.
 */
export async function removeUserFromAllDevices(
  devices: Device[],
  identifier: string,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ removed: number; errors: number; details: string[] }> {
  const targetDevices = devices.filter(
    (d) => d.type === 'facial_recognition' || d.type === 'vehicle_tag'
  );
  if (targetDevices.length === 0) {
    return { removed: 0, errors: 0, details: [] };
  }

  const deviceUserId = Math.abs(hashCode(identifier));
  let removed = 0;
  let errors = 0;
  const details: string[] = [];

  for (let i = 0; i < targetDevices.length; i++) {
    const device = targetDevices[i];
    const serial = getDeviceSerial(device);
    if (!serial) continue;

    onProgress?.(`Removendo de ${device.name}...`, i, targetDevices.length);

    try {
      // Cards first (FK), then user; destroy_objects on users cascades face data
      try {
        await queueCommandAndWait(serial, 'destroy_objects', {
          object: 'cards',
          where: { cards: { user_id: deviceUserId } },
        }, 15000);
      } catch { /* ignore */ }

      await queueCommandAndWait(serial, 'destroy_objects', {
        object: 'users',
        where: { users: { id: deviceUserId } },
      }, 15000);

      removed++;
      details.push(`${device.name}: ✓ removido`);
    } catch (err: any) {
      errors++;
      details.push(`${device.name}: ✗ ${err.message}`);
    }
  }

  return { removed, errors, details };
}

/**
 * Reconcile faces and TAGs FROM hardware INTO the system.
 * Only updates existing residents — never creates new ones.
 * - Downloads missing photos to storage
 * - Downloads missing vehicle_tag values into the residents table
 */
export async function reconcileFromDevices(
  devices: Device[],
  residents: Resident[],
  onProgress: (msg: string, current: number, total: number) => void
): Promise<{ photosAdded: number; tagsAdded: number; skipped: number; errors: number }> {
  const targetDevices = devices.filter(
    (d) => d.type === 'facial_recognition' || d.type === 'vehicle_tag'
  );
  if (targetDevices.length === 0) {
    throw new Error('Nenhum dispositivo facial/tag cadastrado.');
  }

  const normalizeStr = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  let photosAdded = 0;
  let tagsAdded = 0;
  let skipped = 0;
  let errors = 0;

  // Build resident lookup by hashed id (matches deviceUserId convention)
  const byHashId = new Map<number, Resident>();
  for (const r of residents) {
    byHashId.set(Math.abs(hashCode(r.id)), r);
  }

  const matchByName = (deviceUserName: string): Resident | undefined => {
    const aptMatch = deviceUserName.match(/^(\d+\w?)\s*[-\u2013]\s*(.+)$/i);
    if (aptMatch) {
      const [, apt, extracted] = aptMatch;
      const n = normalizeStr(extracted);
      const found = residents.find(
        (r) =>
          String(r.apartment).trim() === apt.trim() &&
          (normalizeStr(r.name).includes(n) || n.includes(normalizeStr(r.name)))
      );
      if (found) return found;
    }
    const n = normalizeStr(deviceUserName);
    return residents.find((r) => {
      const rn = normalizeStr(r.name);
      return rn === n || rn.includes(n) || n.includes(rn);
    });
  };

  for (const device of targetDevices) {
    const serial = getDeviceSerial(device);
    if (!serial) continue;

    onProgress(`Lendo usuários de ${device.name}...`, 0, 0);

    let users: Array<{ id: number; name: string; image_timestamp?: number }> = [];
    let cards: Array<{ value: number | string; user_id?: number }> = [];
    try {
      const r1 = await queueCommandAndWait(serial, 'load_objects', { object: 'users' }, 60000);
      users = r1?.users || [];
      const r2 = await queueCommandAndWait(serial, 'load_objects', { object: 'cards' }, 60000);
      cards = r2?.cards || [];
    } catch (e) {
      console.error(`Reconcile: failed to load from ${device.name}`, e);
      errors++;
      continue;
    }

    const total = users.length;

    // 1) Photos
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      onProgress(`${device.name}: foto ${i + 1}/${total}`, i, total);

      const resident = byHashId.get(u.id) || matchByName(u.name || '');
      if (!resident) { skipped++; continue; }

      // Skip if resident already has photo OR device clearly reports no photo
      if ((resident as any).photo) { skipped++; continue; }
      if (!deviceUserHasPhoto(u) && 'image_timestamp' in u) { skipped++; continue; }

      try {
        const base64 = await fetchUserImageBase64WithRetries(serial, u.id);
        if (!base64) { skipped++; continue; }

        const dataUrl = `data:image/jpeg;base64,${base64}`;
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
        const path = `${resident.id}/photo.jpg`;
        await supabase.storage.from('resident-photos').remove([path]);
        const { error: upErr } = await supabase.storage
          .from('resident-photos')
          .upload(path, file, { upsert: true });
        if (upErr) { errors++; continue; }
        invalidateCache(`photo_${resident.id}`);
        photosAdded++;
      } catch (e) {
        errors++;
      }
    }

    // 2) TAGs
    for (const c of cards) {
      if (!c.user_id) continue;
      const userObj = users.find((u) => u.id === c.user_id);
      const resident = byHashId.get(c.user_id) || (userObj ? matchByName(userObj.name) : undefined);
      if (!resident) { skipped++; continue; }
      if ((resident as any).vehicle_tag || (resident as any).vehicleTag) { skipped++; continue; }

      try {
        const { error } = await supabase
          .from('residents')
          .update({ vehicle_tag: String(c.value) })
          .eq('id', resident.id);
        if (error) { errors++; continue; }
        invalidateCache('residents_list');
        tagsAdded++;
      } catch {
        errors++;
      }
    }
  }

  return { photosAdded, tagsAdded, skipped, errors };
}

/**
 * Push the monitor/webhook configuration to all devices that have a serial number.
 * Uses the controlid-webhook/push-config edge function.
 */
export async function pushConfigToAllDevices(
  devices: Device[],
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ success: number; errors: number }> {
  const targets = devices.filter((d) => d.serialNumber);
  let success = 0;
  let errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const d = targets[i];
    onProgress?.(`Configurando ${d.name}...`, i, targets.length);
    try {
      const { error } = await supabase.functions.invoke('controlid-webhook/push-config', {
        method: 'POST',
        body: { device_id: d.serialNumber },
      });
      if (error) throw error;
      success++;
    } catch (err) {
      console.error(`pushConfig error on ${d.name}:`, err);
      errors++;
    }
  }

  return { success, errors };
}

/**
 * Sync ALL residents (face + TAG) from the system to ALL devices.
 * System is the source of truth: only residents with photo/tag in DB are pushed.
 */
export async function syncAllResidentsToDevices(
  devices: Device[],
  residents: Array<{ id: string; name: string; apartment: string; cpf?: string; vehicleTag?: string }>,
  getResidentPhoto: (residentId: string) => Promise<string | null>,
  onProgress?: (msg: string, current: number, total: number) => void
): Promise<{ photosSynced: number; tagsSynced: number; skipped: number; errors: number }> {
  const facialDevices = devices.filter((d) => d.type === 'facial_recognition');
  const allTargets = devices.filter(
    (d) => d.type === 'facial_recognition' || d.type === 'vehicle_tag'
  );
  if (allTargets.length === 0) {
    return { photosSynced: 0, tagsSynced: 0, skipped: 0, errors: 0 };
  }

  let photosSynced = 0;
  let tagsSynced = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < residents.length; i++) {
    const r = residents[i];
    onProgress?.(`Sincronizando ${r.name} (${i + 1}/${residents.length})...`, i, residents.length);

    const personInfo: CapturePersonInfo = {
      name: r.name,
      apartment: r.apartment,
      document: r.cpf,
      identifier: r.id,
      registration: r.cpf || undefined,
    };

    // Photo sync
    if (facialDevices.length > 0) {
      try {
        const photoUrl = await getResidentPhoto(r.id);
        if (photoUrl) {
          let base64 = photoUrl;
          if (!photoUrl.startsWith('data:')) {
            const resp = await fetch(photoUrl);
            const blob = await resp.blob();
            base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
          const result = await syncBiometricToAllDevices(facialDevices, personInfo, base64);
          photosSynced += result.synced;
          errors += result.errors;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`Photo sync error for ${r.name}:`, err);
        errors++;
      }
    }

    // TAG sync
    if (r.vehicleTag) {
      try {
        const result = await syncTagToAllDevices(allTargets, personInfo, r.vehicleTag);
        tagsSynced += result.synced;
        errors += result.errors;
      } catch (err) {
        console.error(`TAG sync error for ${r.name}:`, err);
        errors++;
      }
    }
  }

  onProgress?.('Sincronização concluída!', residents.length, residents.length);
  return { photosSynced, tagsSynced, skipped, errors };
}

