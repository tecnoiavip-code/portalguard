import { useState, useEffect } from 'react';
import { supabaseStorage } from '@/lib/supabase-storage';
import { AccessEntry } from '@/types';
import { toast } from 'sonner';

export const useAccessEntries = () => {
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEntries = async () => {
    setLoading(true);
    const data = await supabaseStorage.getEntries();
    setEntries(data);
    setLoading(false);
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const saveEntry = async (entry: AccessEntry) => {
    const success = await supabaseStorage.saveEntry(entry);
    if (success) {
      await loadEntries();
      return true;
    }
    toast.error('Erro ao salvar cadastro');
    return false;
  };

  const deleteEntry = async (id: string) => {
    const success = await supabaseStorage.deleteEntry(id);
    if (success) {
      await loadEntries();
      return true;
    }
    toast.error('Erro ao excluir cadastro');
    return false;
  };

  return {
    entries,
    loading,
    saveEntry,
    deleteEntry,
    refresh: loadEntries,
  };
};
