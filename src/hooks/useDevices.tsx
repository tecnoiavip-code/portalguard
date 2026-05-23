import { useState, useEffect, useCallback } from 'react';
import { supabaseStorage } from '@/lib/supabase-storage';
import { supabase } from '@/integrations/supabase/client';
import { Device } from '@/types';
import { toast } from 'sonner';

const CONTROL_ID_INTEGRATION_ENABLED = import.meta.env.VITE_CONTROLID_INTEGRATION_ENABLED === 'true';

export const useDevices = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDevices = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const data = await supabaseStorage.getDevices();
    setDevices(data);
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => {
    loadDevices(true);

    if (!CONTROL_ID_INTEGRATION_ENABLED) {
      return;
    }

    // Realtime subscription for device status updates
    // Fetch only the changed device instead of reloading everything
    const channel = supabase
      .channel('devices-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, async (payload) => {
        // Only update the specific device that changed
        const changedId = payload.new?.id || payload.old?.id;
        if (changedId) {
          const updatedDevice = await supabaseStorage.getDeviceById(changedId);
          if (updatedDevice) {
            setDevices(prev => {
              const index = prev.findIndex(d => d.id === changedId);
              if (index > -1) {
                // Update existing device
                const newDevices = [...prev];
                newDevices[index] = updatedDevice;
                return newDevices;
              }
              // Add new device
              return [...prev, updatedDevice];
            });
          } else {
            // Device was deleted
            setDevices(prev => prev.filter(d => d.id !== changedId));
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadDevices]);

  const saveDevice = useCallback(async (device: Device) => {
    const success = await supabaseStorage.saveDevice(device);
    if (success) {
      // Update local state instead of full reload
      const updatedDevice = await supabaseStorage.getDeviceById(device.id);
      if (updatedDevice) {
        setDevices(prev => {
          const index = prev.findIndex(d => d.id === device.id);
          if (index > -1) {
            // Update existing
            const newDevices = [...prev];
            newDevices[index] = updatedDevice;
            return newDevices;
          }
          // Add new device at the beginning
          return [updatedDevice, ...prev];
        });
      }
      return true;
    }
    toast.error('Erro ao salvar dispositivo');
    return false;
  }, []);

  const deleteDevice = useCallback(async (id: string) => {
    const success = await supabaseStorage.deleteDevice(id);
    if (success) {
      // Update local state
      setDevices(prev => prev.filter(d => d.id !== id));
      return true;
    }
    toast.error('Erro ao excluir dispositivo');
    return false;
  }, []);

  return {
    devices,
    loading,
    saveDevice,
    deleteDevice,
    refresh: loadDevices,
  };
};
