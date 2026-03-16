import { Device } from '@/types';
import { toast } from 'sonner';

export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

export async function callDeviceApi(device: Device, endpoint: string, body?: any) {
  const ip = device.ipAddress;
  if (!ip) throw new Error('Dispositivo sem IP configurado');
  const url = `http://${ip}/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Authenticate with a Control iD device and trigger remote facial capture.
 * Returns the captured photo as base64 data URL or null if capture was only triggered (async on device).
 */
export async function capturePhotoFromDevice(
  device: Device,
  onStatus: (msg: string) => void
): Promise<string | null> {
  if (!device.ipAddress) {
    throw new Error('Dispositivo sem IP configurado. Configure o IP na tela de Dispositivos.');
  }

  onStatus('Conectando ao dispositivo...');

  // Authenticate
  onStatus('Autenticando no dispositivo...');
  const loginRes = await callDeviceApi(device, 'login.fcgi', { login: 'admin', password: 'admin' });
  const session = loginRes.session;
  if (!session) throw new Error('Falha na autenticação');

  // Trigger face capture
  onStatus('Capturando foto... Posicione o rosto em frente ao equipamento.');
  
  try {
    const result = await callDeviceApi(device, `remote_enroll.fcgi?session=${session}`, {
      type: 'face',
      save: false,
      panic: false,
    });

    // Some devices return the image directly
    if (result?.user_image || result?.face_image || result?.image) {
      const base64 = result.user_image || result.face_image || result.image;
      return `data:image/jpeg;base64,${base64.replace(/^data:image\/[a-z]+;base64,/, '')}`;
    }
  } catch {
    // If remote_enroll doesn't return image, try take_user_picture
  }

  // Try take_user_picture as fallback
  try {
    onStatus('Capturando imagem do dispositivo...');
    const picResult = await callDeviceApi(device, `take_user_picture.fcgi?session=${session}`, {});
    if (picResult?.image || picResult?.user_image) {
      const base64 = picResult.image || picResult.user_image;
      return `data:image/jpeg;base64,${base64.replace(/^data:image\/[a-z]+;base64,/, '')}`;
    }
  } catch {
    // Device may not support this endpoint
  }

  return null;
}

/**
 * Read vehicle tags from a Control iD antenna device.
 * Returns array of tag objects with value and user info.
 */
export async function syncTagsFromDevice(
  device: Device,
  onStatus: (msg: string) => void
): Promise<Array<{ value: string; userId?: number; userName?: string }>> {
  if (!device.ipAddress) {
    throw new Error('Dispositivo sem IP configurado.');
  }

  onStatus('Conectando ao dispositivo...');
  const loginRes = await callDeviceApi(device, 'login.fcgi', { login: 'admin', password: 'admin' });
  const session = loginRes.session;
  if (!session) throw new Error('Falha na autenticação');

  onStatus('Buscando TAGs cadastradas no dispositivo...');
  const cardsResult = await callDeviceApi(device, `load_objects.fcgi?session=${session}`, { object: 'cards' });
  const cards: Array<{ value: number | string; user_id?: number }> = cardsResult?.cards || [];

  // Also load users to match names
  const usersResult = await callDeviceApi(device, `load_objects.fcgi?session=${session}`, { object: 'users' });
  const users: Array<{ id: number; name: string }> = usersResult?.users || [];

  const userMap = new Map(users.map(u => [u.id, u.name]));

  return cards.map(c => ({
    value: String(c.value),
    userId: c.user_id,
    userName: c.user_id ? userMap.get(c.user_id) : undefined,
  }));
}
