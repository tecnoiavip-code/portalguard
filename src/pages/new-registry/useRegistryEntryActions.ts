import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { syncBiometricToAllDevices } from '@/lib/device-capture';
import { AccessEntry, Device, Resident } from '@/types';

import { NewRegistryFormData } from './registry-form';

interface UseRegistryEntryActionsParams {
  allEntries: AccessEntry[];
  residents: Resident[];
  facialDevices: Device[];
  editingId: string;
  formData: NewRegistryFormData;
  showSuggestions: boolean;
  suggestions: AccessEntry[];
  isVisitorBlocked: (document: string) => boolean;
  saveEntry: (entry: AccessEntry) => Promise<boolean>;
}

export const useRegistryEntryActions = ({
  allEntries,
  residents,
  facialDevices,
  editingId,
  formData,
  showSuggestions,
  suggestions,
  isVisitorBlocked,
  saveEntry,
}: UseRegistryEntryActionsParams) => {
  const [badgeError, setBadgeError] = useState<string | null>(null);

  const registerEntry = useCallback(async () => {
    setBadgeError(null);

    if (isVisitorBlocked(formData.visitorDocument)) {
      toast.error('Este visitante está bloqueado e não pode entrar!');
      return false;
    }

    const resident = residents.find(item => item.id === formData.residentId);
    if (!resident) {
      toast.error('Selecione um morador válido');
      return false;
    }

    const isNew = !editingId;
    if (isNew && formData.visitorDocument.trim()) {
      const { data: activeData } = await supabase
        .from('access_entries')
        .select('id, visitor_name, apartment')
        .eq('visitor_document', formData.visitorDocument.trim().toUpperCase())
        .is('exit_time', null)
        .limit(1);

      if (activeData && activeData.length > 0) {
        toast.error(`${activeData[0].visitor_name} já possui uma entrada ativa (${activeData[0].apartment}). Registre a saída antes de cadastrar nova entrada.`);
        return false;
      }
    }

    if (isNew && formData.badgeNumber.trim()) {
      const { data: badgeData } = await supabase
        .from('access_entries')
        .select('id, visitor_name, apartment, badge_number')
        .eq('badge_number', formData.badgeNumber.trim().toUpperCase())
        .is('exit_time', null)
        .limit(1);

      if (badgeData && badgeData.length > 0) {
        setBadgeError(`O crachá ${badgeData[0].badge_number} já está em uso por ${badgeData[0].visitor_name} (${badgeData[0].apartment}). Registre a saída antes de reutilizá-lo.`);
        return false;
      }
    }

    const currentEntry = editingId ? allEntries.find(entry => entry.id === editingId) : null;
    if (editingId && !currentEntry) {
      toast.error('Cadastro original não encontrado');
      return false;
    }

    const entryData: AccessEntry = currentEntry
      ? {
          ...currentEntry,
          visitorName: formData.visitorName,
          visitorDocument: formData.visitorDocument,
          visitorType: formData.visitorType,
          residentId: formData.residentId,
          residentName: resident.name,
          apartment: resident.apartment,
          purpose: formData.purpose,
          vehiclePlate: formData.vehiclePlate,
          vehicleModel: formData.vehicleModel,
          vehicleColor: formData.vehicleColor,
          photo: formData.photo,
          company: formData.company,
          badgeNumber: formData.badgeNumber,
        }
      : {
          id: `entry_${Date.now()}`,
          visitorName: formData.visitorName,
          visitorDocument: formData.visitorDocument,
          visitorType: formData.visitorType,
          residentId: formData.residentId,
          residentName: resident.name,
          apartment: resident.apartment,
          purpose: formData.purpose,
          entryTime: new Date().toISOString(),
          exitTime: null,
          vehiclePlate: formData.vehiclePlate,
          vehicleModel: formData.vehicleModel,
          vehicleColor: formData.vehicleColor,
          photo: formData.photo,
          company: formData.company,
          badgeNumber: formData.badgeNumber,
          autoRecognized: showSuggestions && suggestions.length > 0,
        };

    const saved = await saveEntry(entryData);
    if (!saved) {
      return false;
    }

    if (formData.photo && formData.visitorDocument && facialDevices.length > 0) {
      const personInfo = {
        name: formData.visitorName,
        apartment: resident.apartment,
        document: formData.visitorDocument,
        identifier: `sp-${formData.visitorDocument}`,
        registration: formData.visitorDocument,
      };

      syncBiometricToAllDevices(facialDevices, personInfo, formData.photo, message => {
        console.log('[BiometricSync Visitor]', message);
      }).then(result => {
        if (result.synced > 0) {
          toast.success(`Biometria sincronizada em ${result.synced} dispositivo(s)`);
        }
        if (result.errors > 0) {
          toast.warning(`Falha em ${result.errors} dispositivo(s)`);
        }
      }).catch(error => {
        console.error('Biometric sync error:', error);
      });
    }

    if (isNew) {
      try {
        const { data: residentData } = await supabase
          .from('residents')
          .select('auth_user_id')
          .eq('id', formData.residentId)
          .maybeSingle();

        if (residentData?.auth_user_id) {
          await supabase.from('notifications').insert({
            user_id: residentData.auth_user_id,
            title: 'Visita registrada',
            body: `${formData.visitorName} chegou ao seu endereço`,
            type: 'entry',
          });
        }
      } catch (error) {
        console.error('Error notifying resident:', error);
      }
    }

    return true;
  }, [
    allEntries,
    editingId,
    facialDevices,
    formData,
    isVisitorBlocked,
    residents,
    saveEntry,
    showSuggestions,
    suggestions.length,
  ]);

  const exitEntry = useCallback(
    async (entryId: string) => {
      const entry = allEntries.find(item => item.id === entryId);
      if (!entry) return;

      const updatedEntry: AccessEntry = {
        ...entry,
        exitTime: new Date().toISOString(),
      };

      await saveEntry(updatedEntry);
    },
    [allEntries, saveEntry]
  );

  return {
    badgeError,
    setBadgeError,
    registerEntry,
    exitEntry,
  };
};
