import { useState, useEffect, useCallback } from 'react';
import { normalizeAccessEntryText, supabaseStorage } from '@/lib/supabase-storage';
import { AccessEntry } from '@/types';
import { toast } from 'sonner';

export const useAccessEntries = () => {
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    const data = await supabaseStorage.getEntries();
    setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const saveEntry = useCallback(async (entry: AccessEntry) => {
    const savedId = await supabaseStorage.saveEntry(entry);
    if (savedId) {
      const savedEntry = normalizeAccessEntryText({ ...entry, id: savedId });
      // Otimização: atualizar estado local com dados que temos, sem getEntryById() extra
      setEntries(prev => {
        const index = prev.findIndex(e => e.id === entry.id || e.id === savedId);
        if (index > -1) {
          // Update existing (for exit time changes)
          const newEntries = [...prev];
          newEntries[index] = savedEntry;
          return newEntries;
        }
        // Add new entry at the beginning
        return [savedEntry, ...prev];
      });
      return true;
    }
    toast.error('Erro ao salvar cadastro');
    return false;
  }, []);

  const deleteEntry = useCallback(async (id: string) => {
    const success = await supabaseStorage.deleteEntry(id);
    if (success) {
      // Update local state
      setEntries(prev => prev.filter(e => e.id !== id));
      return true;
    }
    toast.error('Erro ao excluir cadastro');
    return false;
  }, []);

  return {
    entries,
    loading,
    saveEntry,
    deleteEntry,
    refresh: loadEntries,
  };
};
