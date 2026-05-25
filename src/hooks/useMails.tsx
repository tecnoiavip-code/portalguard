import { useState, useEffect, useCallback } from 'react';
import { supabaseStorage } from '@/lib/supabase-storage';
import { Mail } from '@/types';
import { toast } from 'sonner';

export const useMails = () => {
  const [mails, setMails] = useState<Mail[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMails = useCallback(async () => {
    setLoading(true);
    const data = await supabaseStorage.getMails();
    setMails(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMails();
  }, [loadMails]);

  const saveMail = useCallback(async (mail: Mail) => {
    const success = await supabaseStorage.saveMail(mail);
    if (success) {
      // Otimização: atualizar estado local com dados que temos, sem getMailById() extra
      setMails(prev => {
        const index = prev.findIndex(m => m.id === mail.id);
        if (index > -1) {
          // Update existing
          const newMails = [...prev];
          newMails[index] = mail;
          return newMails;
        }
        // Add new mail at the beginning
        return [mail, ...prev];
      });
      return true;
    }
    toast.error('Erro ao salvar correspondência');
    return false;
  }, []);

  const deleteMail = useCallback(async (id: string) => {
    const success = await supabaseStorage.deleteMail(id);
    if (success) {
      // Update local state
      setMails(prev => prev.filter(m => m.id !== id));
      return true;
    }
    toast.error('Erro ao excluir correspondência');
    return false;
  }, []);

  return {
    mails,
    loading,
    saveMail,
    deleteMail,
    refresh: loadMails,
  };
};
