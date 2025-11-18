import { supabase } from '@/integrations/supabase/client';
import { Resident, Mail, AccessEntry, Device, RealtimeEvent } from '@/types';

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
      cpf: r.cpf,
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

  async saveResident(resident: Resident): Promise<boolean> {
    const isNew = !resident.id || resident.id.startsWith('res_');
    
    const residentData = {
      name: resident.name,
      cpf: resident.cpf || null,
      apartment: resident.apartment,
      phone: resident.phone || null,
      email: resident.email || null,
      photo_url: resident.photo || null,
      vehicle_plate: resident.vehiclePlate || null,
      vehicle_model: resident.vehicleModel || null,
      vehicle_color: resident.vehicleColor || null,
      vehicle_tag: resident.vehicleTag || null,
    };

    if (isNew) {
      const { error } = await supabase
        .from('residents')
        .insert(residentData);
      
      if (error) {
        console.error('Error inserting resident:', error);
        return false;
      }
    } else {
      const { error } = await supabase
        .from('residents')
        .update(residentData)
        .eq('id', resident.id);
      
      if (error) {
        console.error('Error updating resident:', error);
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
      receivedAt: m.received_at,
      status: m.status as any,
      deliveredAt: m.delivered_at,
      withdrawnBy: m.withdrawn_by,
    }));
  },

  async saveMail(mail: Mail): Promise<boolean> {
    const isNew = mail.id.startsWith('mail_');
    
    const mailData = {
      resident_id: mail.residentId,
      sender: mail.sender,
      package_type: mail.packageType,
      notes: mail.notes || null,
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
    }));
  },

  async saveEntry(entry: AccessEntry): Promise<boolean> {
    const isNew = entry.id.startsWith('entry_');
    
    const entryData = {
      visitor_name: entry.visitorName,
      visitor_document: entry.visitorDocument,
      visitor_type: entry.visitorType,
      resident_id: entry.residentId || null,
      resident_name: entry.residentName || null,
      apartment: entry.apartment,
      purpose: entry.purpose || null,
      exit_time: entry.exitTime,
      vehicle_plate: entry.vehiclePlate || null,
      vehicle_model: entry.vehicleModel || null,
      vehicle_color: entry.vehicleColor || null,
      photo_url: entry.photo || null,
      company: entry.company || null,
      auto_recognized: entry.autoRecognized || false,
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
