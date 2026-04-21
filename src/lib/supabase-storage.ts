import { supabase } from '@/integrations/supabase/client';
import { Resident, Mail, AccessEntry, Device, RealtimeEvent } from '@/types';

// Helper to uppercase string fields (except email and urls)
const up = (val: string | null | undefined): string | null => val ? val.toUpperCase() : val as null;

export const supabaseStorage = {
  // Residents
  async getResidents(includePhotos = false): Promise<Resident[] | null> {
    const { data, error } = await supabase
      .from('residents')
      .select('id, name, cpf, apartment, phone, email, photo_url, vehicle_plate, vehicle_model, vehicle_color, vehicle_tag, created_at')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching residents:', error);
      return null; // Return null on error so callers can preserve existing data
    }

    const residents = (data || []).map(r => ({
      id: r.id,
      name: r.name,
      cpf: r.cpf || '',
      apartment: r.apartment,
      phone: r.phone || '',
      email: r.email || '',
      photo: includePhotos ? (r.photo_url || '') : '',
      vehiclePlate: r.vehicle_plate || '',
      vehicleModel: r.vehicle_model || '',
      vehicleColor: r.vehicle_color || '',
      vehicleTag: r.vehicle_tag || '',
      createdAt: r.created_at,
    }));

    if (!includePhotos || residents.length === 0) {
      return residents;
    }

    const residentsWithPhotos = await Promise.all(
      residents.map(async (resident) => ({
        ...resident,
        photo: await supabaseStorage.getResidentPhoto(resident.id),
      }))
    );

    return residentsWithPhotos;
  },

  async getResidentPhoto(id: string): Promise<string> {
    // First check if there's a photo in Storage
    const { data: storageFiles } = await supabase.storage
      .from('resident-photos')
      .list(id, { limit: 1 });

    if (storageFiles && storageFiles.length > 0) {
      const { data: signedUrl } = await supabase.storage
        .from('resident-photos')
        .createSignedUrl(`${id}/${storageFiles[0].name}`, 3600);
      return signedUrl?.signedUrl || '';
    }

    // Fallback: check legacy base64 in photo_url column
    const { data, error } = await supabase
      .from('residents')
      .select('photo_url')
      .eq('id', id)
      .maybeSingle();

    if (error || !data?.photo_url) return '';

    // If it's base64, migrate it to Storage automatically
    if (data.photo_url.startsWith('data:')) {
      const migrated = await supabaseStorage.uploadResidentPhoto(id, data.photo_url);
      if (migrated) {
        // Clear the base64 from the DB column
        await supabase.from('residents').update({ photo_url: null }).eq('id', id);
        return migrated;
      }
    }

    return data.photo_url;
  },

  async uploadResidentPhoto(residentId: string, base64OrFile: string | File): Promise<string | null> {
    try {
      let file: File;
      if (typeof base64OrFile === 'string') {
        // Convert base64 to File
        const res = await fetch(base64OrFile);
        const blob = await res.blob();
        file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
      } else {
        file = base64OrFile;
      }

      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${residentId}/photo.${ext}`;

      // Remove old photo if exists
      await supabase.storage.from('resident-photos').remove([path]);

      const { error } = await supabase.storage
        .from('resident-photos')
        .upload(path, file, { upsert: true });

      if (error) {
        console.error('Error uploading photo:', error);
        return null;
      }

      const { data: signedUrl } = await supabase.storage
        .from('resident-photos')
        .createSignedUrl(path, 3600);

      return signedUrl?.signedUrl || null;
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
  },

  async checkResidentDuplicate(resident: Resident, excludeId?: string): Promise<string | null> {
    const normalizedName = resident.name.trim().toUpperCase();
    const normalizedApt = resident.apartment.trim().toUpperCase();
    const normalizedCpf = resident.cpf ? resident.cpf.replace(/\D/g, '') : '';
    const normalizedEmail = resident.email ? resident.email.trim().toLowerCase() : '';

    // Check by CPF if provided (strip non-digits for comparison)
    if (normalizedCpf) {
      const { data } = await supabase
        .from('residents')
        .select('id, name, apartment, cpf');
      if (data) {
        const match = data.find(r => {
          if (excludeId && r.id === excludeId) return false;
          const rCpf = (r.cpf || '').replace(/\D/g, '');
          return rCpf === normalizedCpf;
        });
        if (match) {
          return `Já existe um morador com este CPF: ${match.name} (${match.apartment})`;
        }
      }
    }

    // Check by name (any apartment - same person cannot be registered twice)
    const { data: nameData } = await supabase
      .from('residents')
      .select('id, name, apartment')
      .ilike('name', normalizedName);
    if (nameData) {
      const match = nameData.find(r => {
        if (excludeId && r.id === excludeId) return false;
        return r.name.trim().toUpperCase() === normalizedName;
      });
      if (match) {
        return `Já existe um morador com este nome: ${match.name} (${match.apartment})`;
      }
    }

    // Check by email if provided
    if (normalizedEmail) {
      const { data: emailData } = await supabase
        .from('residents')
        .select('id, name, apartment')
        .ilike('email', normalizedEmail)
        .limit(1);
      if (emailData) {
        const match = emailData.find(r => !(excludeId && r.id === excludeId));
        if (match) {
          return `Já existe um morador com este e-mail: ${match.name} (${match.apartment})`;
        }
      }
    }

    return null;
  },

  async saveResident(resident: Resident): Promise<string | null> {
    const isNew = !resident.id || resident.id.startsWith('res_');
    const excludeId = isNew ? undefined : resident.id;

    // Check for duplicates
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

    // Determine resident ID for photo upload
    const residentId = isNew ? undefined : resident.id;

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
      if (error) {
        console.error('Error updating resident:', error.message);
        return null;
      }
      savedId = resident.id;
    }

    // Upload photo to Storage if provided
    if (resident.photo && resident.photo.startsWith('data:')) {
      await supabaseStorage.uploadResidentPhoto(savedId, resident.photo);
      // Clear base64 from DB column
      await supabase.from('residents').update({ photo_url: null }).eq('id', savedId);
    } else if (!resident.photo) {
      // Photo was removed
      await supabaseStorage.deleteResidentPhoto(savedId);
      await supabase.from('residents').update({ photo_url: null }).eq('id', savedId);
    }
    
    return savedId;
  },

  async deleteResident(id: string): Promise<boolean> {
    // Delete photo from Storage first
    await supabaseStorage.deleteResidentPhoto(id);

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
        return null;
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

    // Check if badge number is already in use by an active entry (no exit)
    if (entry.badgeNumber && entry.badgeNumber.trim()) {
      const badgeQuery = supabase
        .from('access_entries')
        .select('id, visitor_name, apartment, badge_number')
        .eq('badge_number', entry.badgeNumber.trim().toUpperCase())
        .is('exit_time', null)
        .limit(1);
      if (excludeId) badgeQuery.neq('id', excludeId);
      const { data: badgeData } = await badgeQuery;
      if (badgeData && badgeData.length > 0) {
        return `O crachá ${badgeData[0].badge_number} já está em uso por ${badgeData[0].visitor_name} (${badgeData[0].apartment}). Registre a saída antes de reutilizá-lo.`;
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
      ipAddress: d.ip_address || '',
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
      ip_address: device.ipAddress || null,
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
