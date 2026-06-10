import { supabase } from '@/integrations/supabase/client';
import { Resident, Mail, AccessEntry, Device, RealtimeEvent } from '@/types';

// ─────────────────────────────────────────────────────────────
// Simple in-memory cache with TTL to avoid redundant DB queries
// ─────────────────────────────────────────────────────────────
interface CacheEntry<T> { data: T; expires: number; }
const _cache: Record<string, CacheEntry<any>> = {};

function getCache<T>(key: string): T | null {
  const e = _cache[key];
  if (e && e.expires > Date.now()) return e.data as T;
  delete _cache[key];
  return null;
}
function setCache<T>(key: string, data: T, ttlMs = 60_000) {
  _cache[key] = { data, expires: Date.now() + ttlMs };
}
export function invalidateCache(...keys: string[]) {
  keys.forEach(k => { delete _cache[k]; });
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const up = (val: string | null | undefined): string | null =>
  val ? val.toUpperCase() : (val as null);

const upperValue = (val: string | null | undefined): string =>
  val ? val.toUpperCase() : '';

const MAIL_COLUMNS = 'id, resident_id, sender, package_type, notes, tracking_code, photo_url, received_at, status, delivered_at, withdrawn_by';
const ACCESS_ENTRY_COLUMNS = 'id, visitor_name, visitor_document, visitor_type, resident_id, resident_name, apartment, purpose, entry_time, exit_time, vehicle_plate, vehicle_model, vehicle_color, photo_url, company, auto_recognized, badge_number';
const DEVICE_COLUMNS = 'id, name, type, location, status, last_sync, ip_address, serial_number';
const REALTIME_EVENT_COLUMNS = 'id, type, description, timestamp, priority, related_id';

export const normalizeAccessEntryText = (entry: AccessEntry): AccessEntry => ({
  ...entry,
  visitorName: upperValue(entry.visitorName),
  visitorDocument: upperValue(entry.visitorDocument),
  residentName: upperValue(entry.residentName),
  apartment: upperValue(entry.apartment),
  purpose: upperValue(entry.purpose),
  vehiclePlate: upperValue(entry.vehiclePlate),
  vehicleModel: upperValue(entry.vehicleModel),
  vehicleColor: upperValue(entry.vehicleColor),
  company: upperValue(entry.company),
  badgeNumber: upperValue(entry.badgeNumber),
});

// ─────────────────────────────────────────────────────────────
export const supabaseStorage = {

  // ── Residents ──────────────────────────────────────────────

  async getResidents(includePhotos = false): Promise<Resident[] | null> {
    const cacheKey = 'residents_list';
    const cached = getCache<Resident[]>(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('residents')
      .select('id, name, cpf, apartment, phone, email, photo_url, vehicle_plate, vehicle_model, vehicle_color, vehicle_tag, created_at')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching residents:', error);
      return null;
    }

    const residents = (data || []).map(r => ({
      id: r.id,
      name: r.name,
      cpf: r.cpf || '',
      apartment: r.apartment,
      phone: r.phone || '',
      email: r.email || '',
      photo: '', // never bulk-load photos — use getResidentPhoto() per-item
      vehiclePlate: r.vehicle_plate || '',
      vehicleModel: r.vehicle_model || '',
      vehicleColor: r.vehicle_color || '',
      vehicleTag: r.vehicle_tag || '',
      createdAt: r.created_at,
    }));

    setCache(cacheKey, residents, 60_000); // cache for 60 s
    return residents;
  },

  async getResidentPhoto(id: string): Promise<string> {
    const cacheKey = `photo_${id}`;
    const cached = getCache<string>(cacheKey);
    if (cached !== null) return cached;

    // 1. Check Storage bucket
    const { data: storageFiles } = await supabase.storage
      .from('resident-photos')
      .list(id, { limit: 1 });

    if (storageFiles && storageFiles.length > 0) {
      const { data: signedUrl } = await supabase.storage
        .from('resident-photos')
        .createSignedUrl(`${id}/${storageFiles[0].name}`, 3600);
      const url = signedUrl?.signedUrl || '';
      setCache(cacheKey, url, 3500_000); // cache ~1 h (URL valid 1 h)
      return url;
    }

    // 2. Fallback: photo_url column (legacy base64)
    const { data } = await supabase
      .from('residents')
      .select('photo_url')
      .eq('id', id)
      .maybeSingle();

    if (!data?.photo_url) { setCache(cacheKey, '', 300_000); return ''; }

    if (data.photo_url.startsWith('data:')) {
      const migrated = await supabaseStorage.uploadResidentPhoto(id, data.photo_url);
      if (migrated) {
        await supabase.from('residents').update({ photo_url: null }).eq('id', id);
        setCache(cacheKey, migrated, 3500_000);
        return migrated;
      }
    }

    setCache(cacheKey, data.photo_url, 3500_000);
    return data.photo_url;
  },

  async uploadResidentPhoto(residentId: string, base64OrFile: string | File): Promise<string | null> {
    try {
      let file: File;
      if (typeof base64OrFile === 'string') {
        const res = await fetch(base64OrFile);
        const blob = await res.blob();
        file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
      } else {
        file = base64OrFile;
      }

      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${residentId}/photo.${ext}`;

      const { data: existingFiles } = await supabase.storage
        .from('resident-photos')
        .list(residentId);
      const { error } = await supabase.storage
        .from('resident-photos')
        .upload(path, file, { upsert: true });

      if (error) { console.error('Error uploading photo:', error); return null; }

      const staleFiles = (existingFiles || [])
        .map(existingFile => `${residentId}/${existingFile.name}`)
        .filter(existingPath => existingPath !== path);
      if (staleFiles.length > 0) {
        await supabase.storage.from('resident-photos').remove(staleFiles);
      }

      const { data: signedUrl } = await supabase.storage
        .from('resident-photos')
        .createSignedUrl(path, 3600);

      const url = signedUrl?.signedUrl || null;
      if (url) setCache(`photo_${residentId}`, url, 3500_000);
      return url;
    } catch (err) {
      console.error('Error in uploadResidentPhoto:', err);
      return null;
    }
  },

  async deleteResidentPhoto(residentId: string): Promise<void> {
    const { data: files } = await supabase.storage
      .from('resident-photos')
      .list(residentId);
    if (files && files.length > 0) {
      await supabase.storage
        .from('resident-photos')
        .remove(files.map(f => `${residentId}/${f.name}`));
    }
    invalidateCache(`photo_${residentId}`);
  },

  // Single consolidated duplicate check — one query instead of 3
  async checkResidentDuplicate(resident: Resident, excludeId?: string): Promise<string | null> {
    const normalizedName = resident.name.trim().toUpperCase();
    const normalizedCpf = resident.cpf ? resident.cpf.replace(/\D/g, '') : '';
    const normalizedEmail = resident.email ? resident.email.trim().toLowerCase() : '';

    // Build a single query to check all fields at once
    const { data } = await supabase
      .from('residents')
      .select('id, name, apartment, cpf, email')
      .or(
        [
          `name.ilike.${normalizedName}`,
          normalizedCpf ? `cpf.ilike.%${normalizedCpf}%` : null,
          normalizedEmail ? `email.ilike.${normalizedEmail}` : null,
        ]
          .filter(Boolean)
          .join(',')
      )
      .limit(20);

    if (!data || data.length === 0) return null;

    const others = excludeId ? data.filter(r => r.id !== excludeId) : data;
    if (others.length === 0) return null;

    // Check CPF match
    if (normalizedCpf) {
      const match = others.find(r => (r.cpf || '').replace(/\D/g, '') === normalizedCpf);
      if (match) return `Já existe um morador com este CPF: ${match.name} (${match.apartment})`;
    }

    // Check name match
    const nameMatch = others.find(r => r.name.trim().toUpperCase() === normalizedName);
    if (nameMatch) return `Já existe um morador com este nome: ${nameMatch.name} (${nameMatch.apartment})`;

    // Check email match
    if (normalizedEmail) {
      const emailMatch = others.find(r => (r.email || '').toLowerCase() === normalizedEmail);
      if (emailMatch) return `Já existe um morador com este e-mail: ${emailMatch.name} (${emailMatch.apartment})`;
    }

    return null;
  },

  async saveResident(resident: Resident): Promise<string | null> {
    const isNew = !resident.id || resident.id.startsWith('res_');
    const excludeId = isNew ? undefined : resident.id;

    const duplicateMsg = await supabaseStorage.checkResidentDuplicate(resident, excludeId);
    if (duplicateMsg) {
      const { toast } = await import('sonner');
      toast.error(duplicateMsg);
      return null;
    }

    const residentData: any = {
      name: up(resident.name) || resident.name,
      cpf: resident.cpf || null,
      apartment: up(resident.apartment) || resident.apartment,
      phone: resident.phone || null,
      email: resident.email?.toLowerCase() || null,
      vehicle_plate: up(resident.vehiclePlate) || null,
      vehicle_model: up(resident.vehicleModel) || null,
      vehicle_color: up(resident.vehicleColor) || null,
      vehicle_tag: up(resident.vehicleTag) || null,
    };

    let savedId: string;

    if (isNew) {
      const { data: insertedData, error } = await supabase
        .from('residents')
        .insert(residentData)
        .select('id')
        .single();
      if (error || !insertedData) {
        console.error('Error inserting resident:', error?.message);
        return null;
      }
      savedId = insertedData.id;
    } else {
      const { error } = await supabase
        .from('residents')
        .update(residentData)
        .eq('id', resident.id)
        .select();
      if (error) { console.error('Error updating resident:', error.message); return null; }
      savedId = resident.id;
    }

    // Handle photo
    if (resident.photo && resident.photo.startsWith('data:')) {
      const uploaded = await supabaseStorage.uploadResidentPhoto(savedId, resident.photo);
      if (!uploaded) {
        return null;
      }
      await supabase.from('residents').update({ photo_url: null }).eq('id', savedId);
    } else if (resident.photoRemoved) {
      await supabaseStorage.deleteResidentPhoto(savedId);
      await supabase.from('residents').update({ photo_url: null }).eq('id', savedId);
    }

    // Invalidate list cache so next read is fresh
    invalidateCache('residents_list', `photo_${savedId}`);
    return savedId;
  },

  async deleteResident(id: string): Promise<boolean> {
    await supabaseStorage.deleteResidentPhoto(id);
    const { error } = await supabase.from('residents').delete().eq('id', id);
    if (error) { console.error('Error deleting resident:', error); return false; }
    invalidateCache('residents_list', `photo_${id}`);
    return true;
  },

  // ── Mails ──────────────────────────────────────────────────

  async getMails(): Promise<Mail[]> {
    const cacheKey = 'mails_list';
    const cached = getCache<Mail[]>(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('mails')
      .select(MAIL_COLUMNS)
      .order('received_at', { ascending: false })
      .limit(300);

    if (error) { console.error('Error fetching mails:', error); return []; }

    const mails = (data || []).map(m => ({
      id: m.id,
      residentId: m.resident_id,
      sender: m.sender,
      packageType: m.package_type as any,
      notes: m.notes || '',
      trackingCode: (m as any).tracking_code || '',
      photoUrl: (m as any).photo_url || '',
      receivedAt: m.received_at,
      status: m.status as any,
      deliveredAt: m.delivered_at,
      withdrawnBy: m.withdrawn_by,
    }));

    setCache(cacheKey, mails, 60_000);
    return mails;
  },

  async saveMail(mail: Mail): Promise<boolean> {
    const isNew = mail.id.startsWith('mail_');
    const mailData: any = {
      resident_id: mail.residentId,
      sender: mail.sender,
      package_type: mail.packageType,
      notes: mail.notes || null,
      tracking_code: mail.trackingCode || null,
      photo_url: mail.photoUrl || null,
      status: mail.status,
      delivered_at: mail.deliveredAt,
      withdrawn_by: mail.withdrawnBy,
    };

    if (isNew) {
      const { data, error } = await supabase.from('mails').insert(mailData).select('id').single();
      if (error) { console.error('Error inserting mail:', error); return false; }
    } else {
      const { error } = await supabase.from('mails').update(mailData).eq('id', mail.id);
      if (error) { console.error('Error updating mail:', error); return false; }
    }
    invalidateCache('mails_list');
    return true;
  },

  async deleteMail(id: string): Promise<boolean> {
    const { error } = await supabase.from('mails').delete().eq('id', id);
    if (error) { console.error('Error deleting mail:', error); return false; }
    invalidateCache('mails_list');
    return true;
  },

  // ── Access Entries ──────────────────────────────────────────

  async getEntries(): Promise<AccessEntry[]> {
    const cacheKey = 'entries_list';
    const cached = getCache<AccessEntry[]>(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('access_entries')
      .select(ACCESS_ENTRY_COLUMNS)
      .order('entry_time', { ascending: false })
      .limit(200); // cap at 200 to avoid unbounded growth

    if (error) { console.error('Error fetching entries:', error); return []; }

    const entries = (data || []).map(e => normalizeAccessEntryText({
      id: e.id,
      visitorName: e.visitor_name,
      visitorDocument: e.visitor_document,
      visitorType: e.visitor_type as any,
      residentId: e.resident_id || '',
      residentName: e.resident_name || '',
      apartment: e.apartment,
      purpose: e.purpose || '',
      entryTime: e.entry_time,
      exitTime: e.exit_time,
      vehiclePlate: e.vehicle_plate || '',
      vehicleModel: e.vehicle_model || '',
      vehicleColor: e.vehicle_color || '',
      photo: e.photo_url || '',
      company: e.company || '',
      autoRecognized: e.auto_recognized || false,
      badgeNumber: (e as any).badge_number || '',
    }));

    setCache(cacheKey, entries, 30_000); // 30 s cache for entries
    return entries;
  },

  async checkEntryDuplicate(entry: AccessEntry, excludeId?: string): Promise<string | null> {
    if (!entry.visitorDocument && (!entry.badgeNumber || !entry.badgeNumber.trim())) return null;

    const conditions: string[] = [];
    if (entry.visitorDocument) conditions.push(`visitor_document.eq.${entry.visitorDocument}`);
    if (entry.badgeNumber?.trim()) conditions.push(`badge_number.eq.${entry.badgeNumber.trim().toUpperCase()}`);

    const query = supabase
      .from('access_entries')
      .select('id, visitor_name, apartment, badge_number')
      .or(conditions.join(','))
      .is('exit_time', null)
      .limit(5);
    if (excludeId) query.neq('id', excludeId);

    const { data } = await query;
    if (!data || data.length === 0) return null;

    const active = data.find(r => !(excludeId && r.id === excludeId));
    if (!active) return null;

    if (entry.visitorDocument && active.visitor_name) {
      return `Este visitante (${active.visitor_name}) já está com entrada ativa no ${active.apartment}. Registre a saída antes de uma nova entrada.`;
    }
    if (entry.badgeNumber && active.badge_number) {
      return `O crachá ${active.badge_number} já está em uso. Registre a saída antes de reutilizá-lo.`;
    }
    return null;
  },

  async saveEntry(entry: AccessEntry): Promise<string | null> {
    const isNew = entry.id.startsWith('entry_');
    const excludeId = isNew ? undefined : entry.id;

    if (isNew) {
      const duplicateMsg = await supabaseStorage.checkEntryDuplicate(entry, excludeId);
      if (duplicateMsg) {
        const { toast } = await import('sonner');
        toast.error(duplicateMsg);
        return null;
      }
    }

    const entryData: any = {
      visitor_name: up(entry.visitorName) || entry.visitorName,
      visitor_document: up(entry.visitorDocument) || entry.visitorDocument,
      visitor_type: entry.visitorType,
      resident_id: entry.residentId || null,
      resident_name: up(entry.residentName) || null,
      apartment: up(entry.apartment) || entry.apartment,
      purpose: up(entry.purpose) || null,
      exit_time: entry.exitTime,
      vehicle_plate: up(entry.vehiclePlate) || null,
      vehicle_model: up(entry.vehicleModel) || null,
      vehicle_color: up(entry.vehicleColor) || null,
      photo_url: entry.photo || null,
      company: up(entry.company) || null,
      auto_recognized: entry.autoRecognized || false,
      badge_number: up(entry.badgeNumber) || null,
    };

    if (isNew) {
      const { data, error } = await supabase
        .from('access_entries')
        .insert(entryData)
        .select('id')
        .single();
      if (error || !data) {
        console.error('Error inserting entry:', error);
        return null;
      }
      invalidateCache('entries_list');
      return data.id;
    } else {
      const { error } = await supabase.from('access_entries').update(entryData).eq('id', entry.id);
      if (error) { console.error('Error updating entry:', error); return null; }
    }
    invalidateCache('entries_list');
    return entry.id;
  },

  async registerEntryExit(entry: AccessEntry, exitTime: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('access_entries')
      .update({ exit_time: exitTime })
      .eq('id', entry.id)
      .is('exit_time', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error registering entry exit:', error);
      return false;
    }

    if (!data) {
      console.warn('Access entry exit not updated; entry may already be closed:', entry.id);
      invalidateCache('entries_list');
      return false;
    }
    invalidateCache('entries_list');
    return true;
  },

  async deleteEntry(id: string): Promise<boolean> {
    const { error } = await supabase.from('access_entries').delete().eq('id', id);
    if (error) { console.error('Error deleting entry:', error); return false; }
    invalidateCache('entries_list');
    return true;
  },

  // ── Devices ────────────────────────────────────────────────

  async getDevices(): Promise<Device[]> {
    const cacheKey = 'devices_list';
    const cached = getCache<Device[]>(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('devices')
      .select(DEVICE_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) { console.error('Error fetching devices:', error); return []; }

    const devices = (data || []).map(d => ({
      id: d.id,
      name: d.name,
      type: d.type as any,
      location: d.location,
      status: d.status as any,
      lastSync: d.last_sync,
      ipAddress: d.ip_address || '',
      serialNumber: d.serial_number || '',
    }));

    setCache(cacheKey, devices, 30_000); // 30 s — devices change less often
    return devices;
  },

  async getDeviceById(id: string): Promise<Device | null> {
    const { data, error } = await supabase
      .from('devices')
      .select(DEVICE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching device:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      name: data.name,
      type: data.type as any,
      location: data.location,
      status: data.status as any,
      lastSync: data.last_sync,
      ipAddress: data.ip_address || '',
      serialNumber: data.serial_number || '',
    };
  },

  async saveDevice(device: Device): Promise<boolean> {
    const isNew = device.id.startsWith('dev_');
    const deviceData = {
      name: device.name,
      type: device.type,
      location: device.location,
      status: device.status,
      ip_address: device.ipAddress || null,
      serial_number: device.serialNumber || null,
    };

    if (isNew) {
      const { data, error } = await supabase.from('devices').insert(deviceData).select('id').single();
      if (error) { console.error('Error inserting device:', error); return false; }
    } else {
      const { error } = await supabase.from('devices').update(deviceData).eq('id', device.id);
      if (error) { console.error('Error updating device:', error); return false; }
    }
    invalidateCache('devices_list');
    return true;
  },

  async deleteDevice(id: string): Promise<boolean> {
    const { error } = await supabase.from('devices').delete().eq('id', id);
    if (error) { console.error('Error deleting device:', error); return false; }
    invalidateCache('devices_list');
    return true;
  },

  // ── Realtime Events ────────────────────────────────────────

  async getEvents(): Promise<RealtimeEvent[]> {
    const cacheKey = 'events_list';
    const cached = getCache<RealtimeEvent[]>(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('realtime_events')
      .select(REALTIME_EVENT_COLUMNS)
      .order('timestamp', { ascending: false })
      .limit(30);

    if (error) { console.error('Error fetching events:', error); return []; }

    const events = (data || []).map(e => ({
      id: e.id,
      type: e.type as any,
      description: e.description,
      timestamp: e.timestamp,
      priority: e.priority as any,
      relatedId: e.related_id || undefined,
    }));

    setCache(cacheKey, events, 60_000);
    return events;
  },

  async addEvent(event: Omit<RealtimeEvent, 'id' | 'timestamp'>): Promise<boolean> {
    const { error } = await supabase.from('realtime_events').insert({
      type: event.type,
      description: event.description,
      priority: event.priority,
      related_id: event.relatedId || null,
    });
    if (error) { console.error('Error adding event:', error); return false; }
    invalidateCache('events_list');
    return true;
  },
};
