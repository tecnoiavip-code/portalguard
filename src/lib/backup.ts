import { supabase } from '@/integrations/supabase/client';
import { normalizeAccessEntryText } from '@/lib/supabase-storage';
import type { AccessEntry, Device, Mail, Resident } from '@/types';

export type BackupRange = '7' | '30' | '45' | '90' | 'all';
export type BackupFrequency = 'daily' | 'weekly' | 'monthly';
export type BackupEntryStatus = 'all' | 'active' | 'closed';

export interface BackupConfig {
  includeResidents: boolean;
  includeMails: boolean;
  includeEntries: boolean;
  includeDevices: boolean;
  mailRange: BackupRange;
  entryRange: BackupRange;
  entryStatus: BackupEntryStatus;
  maxRows: number;
  autoEnabled: boolean;
  autoFrequency: BackupFrequency;
  autoRetention: number;
}

export interface BackupPayload {
  version: 2;
  generatedAt: string;
  filters: BackupConfig;
  counts: {
    residents: number;
    mails: number;
    entries: number;
    devices: number;
  };
  data: {
    residents: Resident[];
    mails: Mail[];
    entries: AccessEntry[];
    devices: Device[];
  };
}

export interface StoredBackupSnapshot {
  id: string;
  generatedAt: string;
  counts: BackupPayload['counts'];
  size: number;
  payload: BackupPayload;
}

export const BACKUP_SETTINGS_KEY = 'portalguard-backup-settings-v1';
export const BACKUP_SNAPSHOTS_KEY = 'portalguard-backup-snapshots-v1';

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  includeResidents: true,
  includeMails: true,
  includeEntries: true,
  includeDevices: true,
  mailRange: '90',
  entryRange: '45',
  entryStatus: 'all',
  maxRows: 300,
  autoEnabled: false,
  autoFrequency: 'weekly',
  autoRetention: 3,
};

const RESIDENT_COLUMNS = 'id, name, cpf, apartment, phone, email, vehicle_plate, vehicle_model, vehicle_color, vehicle_tag, created_at';
const MAIL_COLUMNS = 'id, resident_id, sender, package_type, notes, tracking_code, photo_url, received_at, status, delivered_at, withdrawn_by';
const ACCESS_ENTRY_COLUMNS = 'id, visitor_name, visitor_document, visitor_type, resident_id, resident_name, apartment, purpose, entry_time, exit_time, vehicle_plate, vehicle_model, vehicle_color, photo_url, company, auto_recognized, badge_number';
const DEVICE_COLUMNS = 'id, name, type, location, status, last_sync, ip_address, serial_number';

const safeJsonParse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const getCutoffIso = (range: BackupRange): string | null => {
  if (range === 'all') return null;
  const date = new Date();
  date.setDate(date.getDate() - Number(range));
  return date.toISOString();
};

const normalizeConfig = (config: Partial<BackupConfig>): BackupConfig => ({
  ...DEFAULT_BACKUP_CONFIG,
  ...config,
  maxRows: Math.min(Math.max(Number(config.maxRows ?? DEFAULT_BACKUP_CONFIG.maxRows), 50), 1000),
  autoRetention: Math.min(Math.max(Number(config.autoRetention ?? DEFAULT_BACKUP_CONFIG.autoRetention), 1), 5),
});

export const loadBackupConfig = (): BackupConfig => {
  if (typeof window === 'undefined') return DEFAULT_BACKUP_CONFIG;
  return normalizeConfig(safeJsonParse<Partial<BackupConfig>>(localStorage.getItem(BACKUP_SETTINGS_KEY), DEFAULT_BACKUP_CONFIG));
};

export const saveBackupConfig = (config: BackupConfig) => {
  localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(normalizeConfig(config)));
};

export const loadBackupSnapshots = (): StoredBackupSnapshot[] => {
  if (typeof window === 'undefined') return [];
  return safeJsonParse<StoredBackupSnapshot[]>(localStorage.getItem(BACKUP_SNAPSHOTS_KEY), []);
};

export const persistBackupSnapshot = (payload: BackupPayload, retention: number): StoredBackupSnapshot[] => {
  const snapshots = loadBackupSnapshots();
  const snapshot: StoredBackupSnapshot = {
    id: `backup_${Date.now()}`,
    generatedAt: payload.generatedAt,
    counts: payload.counts,
    size: new Blob([JSON.stringify(payload)]).size,
    payload,
  };
  const next = [snapshot, ...snapshots].slice(0, Math.min(Math.max(retention, 1), 5));
  localStorage.setItem(BACKUP_SNAPSHOTS_KEY, JSON.stringify(next));
  return next;
};

export const shouldRunAutomaticBackup = (lastRun: string | undefined, frequency: BackupFrequency): boolean => {
  if (!lastRun) return true;
  const elapsed = Date.now() - new Date(lastRun).getTime();
  const intervals: Record<BackupFrequency, number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };
  return elapsed >= intervals[frequency];
};

export const runDueAutomaticBackup = async (): Promise<StoredBackupSnapshot[] | null> => {
  const config = loadBackupConfig();
  if (!config.autoEnabled) return null;

  const snapshots = loadBackupSnapshots();
  const lastBackup = snapshots[0]?.generatedAt;
  if (!shouldRunAutomaticBackup(lastBackup, config.autoFrequency)) return null;

  const payload = await createBackupPayload(config);
  return persistBackupSnapshot(payload, config.autoRetention);
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const backupRangeLabel = (range: BackupRange): string => {
  if (range === 'all') return 'Todo o histórico';
  return `Últimos ${range} dias`;
};

export const backupFrequencyLabel = (frequency: BackupFrequency): string => {
  const labels: Record<BackupFrequency, string> = {
    daily: 'Diário',
    weekly: 'Semanal',
    monthly: 'Mensal',
  };
  return labels[frequency];
};

export const createBackupPayload = async (configInput: BackupConfig): Promise<BackupPayload> => {
  const config = normalizeConfig(configInput);
  const data: BackupPayload['data'] = {
    residents: [],
    mails: [],
    entries: [],
    devices: [],
  };

  if (config.includeResidents) {
    const { data: rows, error } = await supabase
      .from('residents')
      .select(RESIDENT_COLUMNS)
      .order('name', { ascending: true })
      .limit(1000);

    if (error) throw new Error(`Falha ao carregar moradores: ${error.message}`);

    data.residents = (rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      cpf: row.cpf || '',
      apartment: row.apartment,
      phone: row.phone || '',
      email: row.email || '',
      photo: '',
      vehiclePlate: row.vehicle_plate || '',
      vehicleModel: row.vehicle_model || '',
      vehicleColor: row.vehicle_color || '',
      vehicleTag: row.vehicle_tag || '',
      createdAt: row.created_at,
    }));
  }

  if (config.includeMails) {
    let query = supabase
      .from('mails')
      .select(MAIL_COLUMNS)
      .order('received_at', { ascending: false })
      .limit(config.maxRows);

    const cutoff = getCutoffIso(config.mailRange);
    if (cutoff) query = query.gte('received_at', cutoff);

    const { data: rows, error } = await query;
    if (error) throw new Error(`Falha ao carregar correspondências: ${error.message}`);

    data.mails = (rows || []).map((row) => ({
      id: row.id,
      residentId: row.resident_id,
      sender: row.sender,
      packageType: row.package_type as Mail['packageType'],
      notes: row.notes || '',
      trackingCode: row.tracking_code || '',
      photoUrl: row.photo_url || '',
      receivedAt: row.received_at,
      status: row.status as Mail['status'],
      deliveredAt: row.delivered_at,
      withdrawnBy: row.withdrawn_by,
    }));
  }

  if (config.includeEntries) {
    let query = supabase
      .from('access_entries')
      .select(ACCESS_ENTRY_COLUMNS)
      .order('entry_time', { ascending: false })
      .limit(config.maxRows);

    const cutoff = getCutoffIso(config.entryRange);
    if (cutoff) query = query.gte('entry_time', cutoff);
    if (config.entryStatus === 'active') query = query.is('exit_time', null);
    if (config.entryStatus === 'closed') query = query.not('exit_time', 'is', null);

    const { data: rows, error } = await query;
    if (error) throw new Error(`Falha ao carregar acessos: ${error.message}`);

    data.entries = (rows || []).map((row) => normalizeAccessEntryText({
      id: row.id,
      visitorName: row.visitor_name,
      visitorDocument: row.visitor_document || '',
      visitorType: row.visitor_type as AccessEntry['visitorType'],
      residentId: row.resident_id || '',
      residentName: row.resident_name || '',
      apartment: row.apartment,
      purpose: row.purpose || '',
      entryTime: row.entry_time,
      exitTime: row.exit_time,
      vehiclePlate: row.vehicle_plate || '',
      vehicleModel: row.vehicle_model || '',
      vehicleColor: row.vehicle_color || '',
      photo: row.photo_url || '',
      company: row.company || '',
      autoRecognized: row.auto_recognized || false,
      badgeNumber: row.badge_number || '',
    }));
  }

  if (config.includeDevices) {
    const { data: rows, error } = await supabase
      .from('devices')
      .select(DEVICE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw new Error(`Falha ao carregar dispositivos: ${error.message}`);

    data.devices = (rows || []).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as Device['type'],
      location: row.location,
      status: row.status as Device['status'],
      lastSync: row.last_sync,
      ipAddress: row.ip_address || '',
      serialNumber: row.serial_number || '',
    }));
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    filters: config,
    counts: {
      residents: data.residents.length,
      mails: data.mails.length,
      entries: data.entries.length,
      devices: data.devices.length,
    },
    data,
  };
};
