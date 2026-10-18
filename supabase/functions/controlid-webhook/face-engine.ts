// Motor de reconhecimento facial para o Supabase Edge Function (Deno).
//
// No modo Enterprise o leitor Control iD envia o evento
// POST /new_biometric_image.fcgi com a imagem em tons de cinza (1 byte por
// pixel) no corpo. Este modulo calcula o descritor facial (face-api) e casa
// contra os descritores das fotos dos moradores guardados no banco.
//
// Nada aqui e importado estaticamente no topo do webhook: o webhook usa
// `import()` dinamico dentro de try/catch para que uma falha ao carregar o
// motor (rede, WASM, memoria) NUNCA derrube o resto da function.
//
// deno-lint-ignore-file no-explicit-any
import { Buffer } from 'node:buffer';

// Versoes fixadas iguais as do app local para descritores compativeis.
const FACEAPI_VERSION = '1.7.15';
const TFJS_VERSION = '4.22.0';

// As libs pesadas (tfjs/face-api) sao carregadas sob demanda por URL absoluta
// (esm.sh). Assim o modulo pode ser importado estaticamente pelo webhook sem
// carregar ~MB de JS/memoria em CADA cold start do polling do leitor: so o
// caminho de reconhecimento facial paga esse custo.
let tf: any = null;
let wasm: any = null;
let faceapi: any = null;
let jpeg: any = null;
let PNG: any = null;

async function loadLibs(): Promise<void> {
  if (tf) return;
  tf = await import('https://esm.sh/@tensorflow/tfjs@4.22.0');
  wasm = await import('https://esm.sh/@tensorflow/tfjs-backend-wasm@4.22.0');
  faceapi = await import('https://esm.sh/@vladmandic/face-api@1.7.15/dist/face-api.node-wasm.js?deps=@tensorflow/tfjs@4.22.0,@tensorflow/tfjs-backend-wasm@4.22.0');
  jpeg = (await import('https://esm.sh/jpeg-js@0.4.4')).default;
  const pngMod: any = await import('https://esm.sh/pngjs@7.0.0');
  PNG = pngMod.PNG ?? pngMod.default?.PNG;
}

const MODEL_BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACEAPI_VERSION}/model`;
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${TFJS_VERSION}/dist/`;

export const DEFAULT_THRESHOLD = Number(Deno.env.get('PORTALGUARD_FACE_THRESHOLD') || 0.55);
const DETECTOR_INPUT = Number(Deno.env.get('PORTALGUARD_FACE_DETECTOR_INPUT') || 320);
const DETECTOR_SCORE = Number(Deno.env.get('PORTALGUARD_FACE_DETECTOR_SCORE') || 0.3);
const INDEX_REFRESH_MS = Number(Deno.env.get('PORTALGUARD_FACE_INDEX_REFRESH') || 300000);

type Descriptor = Float32Array;

interface CachedResident {
  residentId: string;
  name: string;
  apartment: string;
  descriptor: Descriptor;
}

let initPromise: Promise<void> | null = null;
let ready = false;
let initError: string | null = null;
let backendName: string | null = null;

const cache = new Map<string, CachedResident>();
let lastIndexRefresh = 0;
let lastModelLoadMs = 0;

export async function init(): Promise<boolean> {
  if (ready) return true;
  if (initPromise) {
    await initPromise;
    return ready;
  }
  initPromise = (async () => {
    const started = Date.now();
    await loadLibs();

    // WASM servido por CDN (o runtime do edge nao tem sistema de arquivos).
    try {
      wasm.setWasmPaths(WASM_BASE);
      await tf.setBackend('wasm');
      await tf.ready();
    } catch (e) {
      console.warn('[face] backend wasm indisponivel, usando cpu:', (e as Error)?.message);
      await tf.setBackend('cpu');
      await tf.ready();
    }
    backendName = tf.getBackend();

    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE);

    ready = true;
    initError = null;
    lastModelLoadMs = Date.now() - started;
    console.log(`[face] motor pronto (backend ${backendName}) em ${lastModelLoadMs}ms`);
  })();

  try {
    await initPromise;
  } catch (e) {
    initError = String((e as Error)?.message || e);
    initPromise = null;
    console.error('[face] falha ao iniciar motor facial:', initError);
  }
  return ready;
}

function bytesToTensorGray(bytes: Uint8Array, width: number, height: number): any {
  const rgba = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    const v = bytes[i];
    rgba[j] = v;
    rgba[j + 1] = v;
    rgba[j + 2] = v;
  }
  return tf.tensor3d(rgba, [height, width, 3], 'int32');
}

function decodeToTensor(buffer: Uint8Array): any {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    const png = PNG.sync.read(Buffer.from(buffer));
    const rgb = new Uint8Array(png.width * png.height * 3);
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
      rgb[j] = png.data[i];
      rgb[j + 1] = png.data[i + 1];
      rgb[j + 2] = png.data[i + 2];
    }
    return tf.tensor3d(rgb, [png.height, png.width, 3], 'int32');
  }
  const jpg = jpeg.decode(buffer, { useTArray: true });
  const rgb = new Uint8Array(jpg.width * jpg.height * 3);
  for (let i = 0, j = 0; i < jpg.data.length; i += 4, j += 3) {
    rgb[j] = jpg.data[i];
    rgb[j + 1] = jpg.data[i + 1];
    rgb[j + 2] = jpg.data[i + 2];
  }
  return tf.tensor3d(rgb, [jpg.height, jpg.width, 3], 'int32');
}

async function descriptorFromTensor(tensor: any): Promise<Descriptor | null> {
  const res = await faceapi
    .detectSingleFace(tensor, new faceapi.TinyFaceDetectorOptions({ inputSize: DETECTOR_INPUT, scoreThreshold: DETECTOR_SCORE }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return res?.descriptor ?? null;
}

// Assinatura da imagem enviada pelo leitor: 1 byte por pixel (cinza).
export async function descriptorFromGrayscale(bytes: Uint8Array, width: number, height: number): Promise<Descriptor | null> {
  if (!(await init())) return null;
  if (!width || !height || bytes.length < width * height) return null;
  const tensor = bytesToTensorGray(bytes, width, height);
  try {
    return await descriptorFromTensor(tensor);
  } finally {
    tensor.dispose();
  }
}

// Imagem codificada (JPEG/PNG) — usada no cadastro/auto-teste.
export async function descriptorFromImage(buffer: Uint8Array): Promise<Descriptor | null> {
  if (!(await init())) return null;
  const tensor = decodeToTensor(buffer);
  try {
    return await descriptorFromTensor(tensor);
  } finally {
    tensor.dispose();
  }
}

function parseDescriptor(value: unknown): Descriptor | null {
  try {
    const arr = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(arr) || arr.length !== 128) return null;
    return Float32Array.from(arr as number[]);
  } catch {
    return null;
  }
}

export interface EnrollResult {
  matched: boolean;
  reason?: string;
  resident_id?: string;
  name?: string;
  apartment?: string;
  distance?: number;
}

// Recarrega os descritores dos moradores a partir da tabela
// resident_face_descriptors. Mantem cache em memoria com TTL curto.
export async function refreshIndex(supabaseClient: any, force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - lastIndexRefresh < INDEX_REFRESH_MS && cache.size > 0) {
    return cache.size;
  }

  const { data, error } = await supabaseClient
    .from('resident_face_descriptors')
    .select('resident_id, descriptor, residents:resident_id (name, apartment)');

  if (error) {
    console.error('[face] erro ao carregar descritores:', error.message);
    return cache.size;
  }

  const next = new Map<string, CachedResident>();
  for (const row of data || []) {
    const descriptor = parseDescriptor(row.descriptor);
    if (!descriptor) continue;
    const resident = Array.isArray(row.residents) ? row.residents[0] : row.residents;
    next.set(row.resident_id, {
      residentId: row.resident_id,
      name: resident?.name || '',
      apartment: resident?.apartment || '',
      descriptor,
    });
  }
  cache.clear();
  for (const [k, v] of next) cache.set(k, v);
  lastIndexRefresh = now;
  return cache.size;
}

// Atualiza (recalcula) o descritor de um morador a partir da foto no Storage
// (`resident-photos/<id>/photo.<ext>`) ou do base64 legado em photo_url.
// Retorna `skipped:true` quando a foto nao mudou desde o ultimo calculo.
export async function enrollResident(
  supabaseClient: any,
  residentId: string,
  opts: { force?: boolean; knownPhotoBytes?: Uint8Array } = {},
): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  if (!(await init())) return { ok: false, reason: 'motor_indisponivel' };

  let bytes: Uint8Array | null = opts.knownPhotoBytes || null;
  let photoPath: string | null = null;
  let photoMtime: string | null = null;

  if (!bytes) {
    const { data: files } = await supabaseClient.storage
      .from('resident-photos')
      .list(residentId, { limit: 5 });
    const file = (files || []).find((f: any) => /\.(jpe?g|png|webp)$/i.test(f.name));
    if (file) {
      photoPath = `${residentId}/${file.name}`;
      photoMtime = String(file.updated_at || file.metadata?.eTag || file.id || file.name);
      if (!opts.force) {
        const { data: existing } = await supabaseClient
          .from('resident_face_descriptors')
          .select('photo_mtime')
          .eq('resident_id', residentId)
          .maybeSingle();
        if (existing?.photo_mtime && existing.photo_mtime === photoMtime) {
          return { ok: true, skipped: true };
        }
      }
      const { data: blob } = await supabaseClient.storage.from('resident-photos').download(photoPath);
      if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
    }
    // Fallback: base64 legado
    if (!bytes) {
      const { data: row } = await supabaseClient.from('residents').select('photo_url').eq('id', residentId).maybeSingle();
      const raw = row?.photo_url || '';
      const m = String(raw).match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
      if (m) bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    }
  }

  if (!bytes) return { ok: false, reason: 'sem_foto' };

  const descriptor = await descriptorFromImage(bytes);
  if (!descriptor) return { ok: false, reason: 'rosto_nao_detectado' };

  const { error } = await supabaseClient
    .from('resident_face_descriptors')
    .upsert({
      resident_id: residentId,
      descriptor: Array.from(descriptor),
      photo_path: photoPath,
      photo_mtime: photoMtime,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'resident_id' });

  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

// Recalcula/enrola os descritores em lotes (offset/limit) para nao estourar o
// limite de CPU/tempo do worker do edge. Chame repetidamente avancando `offset`.
export async function syncAll(
  supabaseClient: any,
  offset = 0,
  limit = 6,
): Promise<{ total: number; offset: number; processed: number; next_offset: number; done: boolean; enrolled: number; skipped: number; failed: number; no_photo: number }> {
  await init();
  const { data: residents } = await supabaseClient
    .from('residents')
    .select('id')
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  const batch = residents || [];
  const result = {
    total: 0,
    offset,
    processed: batch.length,
    next_offset: offset + batch.length,
    done: batch.length < limit,
    enrolled: 0,
    skipped: 0,
    failed: 0,
    no_photo: 0,
  };

  for (const r of batch) {
    try {
      const res = await enrollResident(supabaseClient, r.id);
      if (res.ok && res.skipped) result.skipped += 1;
      else if (res.ok) result.enrolled += 1;
      else if (res.reason === 'sem_foto') result.no_photo += 1;
      else result.failed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export async function matchDescriptor(descriptor: Descriptor, threshold = DEFAULT_THRESHOLD): Promise<EnrollResult> {
  if (cache.size === 0) return { matched: false, reason: 'sem_moradores_indexados' };
  let best: CachedResident | null = null;
  let bestDistance = Infinity;
  for (const info of cache.values()) {
    const distance = faceapi.euclideanDistance(descriptor, info.descriptor);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = info;
    }
  }
  if (best && bestDistance <= threshold) {
    return {
      matched: true,
      resident_id: best.residentId,
      name: best.name,
      apartment: best.apartment,
      distance: bestDistance,
    };
  }
  return { matched: false, reason: 'abaixo_do_limiar', distance: bestDistance };
}

// Adiciona um descritor em memoria (apenas para o auto-teste, sem tocar no banco).
export function debugAddDescriptor(residentId: string, name: string, descriptor: Descriptor) {
  cache.set(residentId, { residentId, name, apartment: '', descriptor });
}

// Lista os descritores atualmente em memoria (auto-teste).
export function listIndexed() {
  return Array.from(cache.values()).map((c) => ({ resident_id: c.residentId, name: c.name, apartment: c.apartment }));
}

export function status() {
  return {
    ready,
    backend: backendName,
    error: initError,
    indexed: cache.size,
    model_load_ms: lastModelLoadMs,
    threshold: DEFAULT_THRESHOLD,
  };
}
