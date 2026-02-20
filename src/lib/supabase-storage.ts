import { supabase } from '@/integrations/supabase/client';
import { Resident, Mail, AccessEntry, Device, RealtimeEvent } from '@/types';

// Helper to uppercase string fields (except email and urls)
const up = (val: string | null | undefined): string | null => val ? val.toUpperCase() : val as null;

export const supabaseStorage = {
  // Residents
  async getResidents(): Promise<Resident[]> {
    const { data, error } = await supabase
      .from('residents')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching residents:', error);
      return [];
    }
    
    return (data || []).map(r => ({
      id: r.id,
      name: r.name,
      cpf: r.cpf || '',
      apartment: r.apartment,
      phone: r.phone || '',
      email: r.email || '',
      photo: r.photo_url || '',
      vehiclePlate: r.vehicle_plate || '',
      vehicleModel: r.vehicle_model || '',
      vehicleColor: r.vehicle_color || '',
      vehicleTag: r.vehicle_tag || '',
      createdAt: r.created_at,
    }));
  },

  async checkResidentDuplicate(resident: Resident, excludeId?: string): Promise<string | null> {
    // Check by CPF if provided
    if (resident.cpf) {
      const query = supabase
        .from('residents')
        .select('id, name, apartment')
        .eq('cpf', resident.cpf)
        .limit(1);
      if (excludeId) query.neq('id', excludeId);
      const { data } = await query;
      if (data && data.length > 0) {
        return `Já existe um morador com este CPF: ${data[0].name} (${data[0].apartment})`;
      }
    }

    // Check by name + apartment (same person same unit)
    const query2 = supabase
      .from('residents')
      .select('id, name, apartment')
      .ilike('name', resident.name.trim())
      .ilike('apartment', resident.apartment.trim())
      .limit(1);
    if (excludeId) query2.neq('id', excludeId);
    const { data: data2 } = await query2;
    if (data2 && data2.length > 0) {
      return `Já existe um morador com este nome neste apartamento: ${data2[0].name} (${data2[0].apartment})`;
    }

    // Check by email if provided
    if (resident.email) {
      const query3 = supabase
        .from('residents')
        .select('id, name, apartment')
        .ilike('email', resident.email.trim())
        .limit(1);
      if (excludeId) query3.neq('id', excludeId);
      const { data: data3 } = await query3;
      if (data3 && data3.length > 0) {
        return `Já existe um morador com este e-mail: ${data3[0].name} (${data3[0].apartment})`;
      }
    }

    return null;
  },

  async saveResident(resident: Resident): Promise<boolean> {
    const isNew = !resident.id || resident.id.startsWith('res_');
    const excludeId = isNew ? undefined : resident.id;

    // Check for duplicates
    const duplicateMsg = await supabaseStorage.checkResidentDuplicate(resident, excludeId);
    if (duplicateMsg) {
      const { toast } = await import('sonner');
      toast.error(duplicateMsg);
      return false;
    }

    const residentData = {
      name: up(resident.name) || resident.name,
      cpf: resident.cpf || null,
      apartment: up(resident.apartment) || resident.apartment,
      phone: resident.phone || null,
      email: resident.email || null,
      photo_url: resident.photo || null,
      vehicle_plate: up(resident.vehiclePlate) || null,
      vehicle_model: up(resident.vehicleModel) || null,
      vehicle_color: up(resident.vehicleColor) || null,
      vehicle_tag: up(resident.vehicleTag) || null,
    };

    if (isNew) {
      const { error } = await supabase
        .from('residents')
        .insert(residentData)
        .select();
      if (error) {
        console.error('Error inserting resident:', error.message);
        return false;
      }
    } else {
      const { error } = await supabase
        .from('residents')
        .update(residentData)
        .eq('id', resident.id)
        .select();
      if (error) {
        console.error('Error updating resident:', error.message);
        return false;
      }
    }
    
    return true;
  },

  async deleteResident(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('residents')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting resident:', error);
      return false;
    }
    
    return true;
  },

  // Mails
  async getMails(): Promise<Mail[]> {
    const { data, error } = await supabase
      .from('mails')
      .select('*')
      .order('received_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching mails:', error);
      return [];
    }
    
    return (data || []).map(m => ({
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
      const { error } = await supabase
        .from('mails')
        .insert(mailData);
      
      if (error) {
        console.error('Error inserting mail:', error);
        return false;
      }
    } else {
      const { error } = await supabase
        .from('mails')
        .update(mailData)
        .eq('id', mail.id);
      
      if (error) {
        console.error('Error updating mail:', error);
        return false;
      }
    }
    
    return true;
  },

  async deleteMail(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('mails')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting mail:', error);
      return false;
    }
    
    return true;
  },

  // Access Entries
  async getEntries(): Promise<AccessEntry[]> {
    const { data, error } = await supabase
      .from('access_entries')
      .select('*')
      .order('entry_time', { ascending: false });
    
    if (error) {
      console.error('Error fetching entries:', error);
      return [];
    }
    
    return (data || []).map(e => ({
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
  },

  async checkEntryDuplicate(entry: AccessEntry, excludeId?: string): Promise<string | null> {
    // Check if same visitor (by document) is currently active (no exit) in the building
    if (entry.visitorDocument) {
      const query = supabase
        .from('access_entries')
        .select('id, visitor_name, apartment')
        .eq('visitor_document', entry.visitorDocument)
        .is('exit_time', null)
        .limit(1);
      if (excludeId) query.neq('id', excludeId);
      const { data } = await query;
      if (data && data.length > 0) {
        return `Este visitante (${data[0].visitor_name}) já está com entrada ativa no ${data[0].apartment}. Registre a saída antes de uma nova entrada.`;
      }
    }
    return null;
  },

  async saveEntry(entry: AccessEntry): Promise<boolean> {
    const isNew = entry.id.startsWith('entry_');
    const excludeId = isNew ? undefined : entry.id;

    // Only check duplicates for new entries (not exits/updates)
    if (isNew) {
      const duplicateMsg = await supabaseStorage.checkEntryDuplicate(entry, excludeId);
      if (duplicateMsg) {
        const { toast } = await import('sonner');
        toast.error(duplicateMsg);
        return false;
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
      const { error } = await supabase
        .from('access_entries')
        .insert(entryData);
      
      if (error) {
        console.error('Error inserting entry:', error);
        return false;
      }
    } else {
      const { error } = await supabase
        .from('access_entries')
        .update(entryData)
        .eq('id', entry.id);
      
      if (error) {
        console.error('Error updating entry:', error);
        return false;
      }
    }
    
    return true;
  },

  async deleteEntry(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('access_entries')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting entry:', error);
      return false;
    }
    
    return true;
  },

  // Devices
  async getDevices(): Promise<Device[]> {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching devices:', error);
      return [];
    }
    
    return (data || []).map(d => ({
      id: d.id,
      name: d.name,
      type: d.type as any,
      location: d.location,
      status: d.status as any,
      lastSync: d.last_sync,
      serialNumber: d.serial_number || '',
    }));
  },

  async saveDevice(device: Device): Promise<boolean> {
    const isNew = device.id.startsWith('dev_');
    
    const deviceData = {
      name: device.name,
      type: device.type,
      location: device.location,
      status: device.status,
      serial_number: device.serialNumber || null,
    };

    if (isNew) {
      const { error } = await supabase
        .from('devices')
        .insert(deviceData);
      
      if (error) {
        console.error('Error inserting device:', error);
        return false;
      }
    } else {
      const { error } = await supabase
        .from('devices')
        .update(deviceData)
        .eq('id', device.id);
      
      if (error) {
        console.error('Error updating device:', error);
        return false;
      }
    }
    
    return true;
  },

  async deleteDevice(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('devices')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting device:', error);
      return false;
    }
    
    return true;
  },

  // Realtime Events
  async getEvents(): Promise<RealtimeEvent[]> {
    const { data, error } = await supabase
      .from('realtime_events')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(50);
    
    if (error) {
      console.error('Error fetching events:', error);
      return [];
    }
    
    return (data || []).map(e => ({
      id: e.id,
      type: e.type as any,
      description: e.description,
      timestamp: e.timestamp,
      priority: e.priority as any,
      relatedId: e.related_id || undefined,
    }));
  },

  async addEvent(event: Omit<RealtimeEvent, 'id' | 'timestamp'>): Promise<boolean> {
    const { error } = await supabase
      .from('realtime_events')
      .insert({
        type: event.type,
        description: event.description,
        priority: event.priority,
        related_id: event.relatedId || null,
      });
    
    if (error) {
      console.error('Error adding event:', error);
      return false;
    }
    
    return true;
  },
};
