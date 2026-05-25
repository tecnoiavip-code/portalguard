import { useState, useEffect, useCallback } from 'react';
import { supabaseStorage } from '@/lib/supabase-storage';
import { Resident } from '@/types';
import { toast } from 'sonner';

export const useResidents = () => {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);

  const loadResidents = useCallback(async () => {
    setLoading(true);
    const data = await supabaseStorage.getResidents();
    if (data !== null) {
      setResidents(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadResidents();
  }, [loadResidents]);

  const saveResident = useCallback(async (resident: Resident) => {
    const savedId = await supabaseStorage.saveResident(resident);
    if (savedId) {
      // Otimização: atualizar estado local com dados que temos (resident), sem getResidentById() extra
      const updatedResident = {
        ...resident,
        id: savedId,
      };
      setResidents(prev => {
        const index = prev.findIndex(r => r.id === savedId);
        if (index > -1) {
          // Update existing
          const newResidents = [...prev];
          newResidents[index] = updatedResident;
          return newResidents;
        }
        // Add new resident at the beginning
        return [updatedResident, ...prev];
      });
      return savedId;
    }
    toast.error('Erro ao salvar morador');
    return null;
  }, []);

  const deleteResident = useCallback(async (id: string) => {
    const success = await supabaseStorage.deleteResident(id);
    if (success) {
      // Update local state
      setResidents(prev => prev.filter(r => r.id !== id));
      return true;
    }
    toast.error('Erro ao excluir morador');
    return false;
  }, []);

  return {
    residents,
    loading,
    saveResident,
    deleteResident,
    refresh: loadResidents,
  };
};
