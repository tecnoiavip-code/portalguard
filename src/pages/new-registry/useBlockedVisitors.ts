import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AccessEntry } from '@/types';
import { supabase } from '@/integrations/supabase/client';

import { BlockedVisitor } from './registry-form';

export const useBlockedVisitors = () => {
  const [blockedVisitors, setBlockedVisitors] = useState<BlockedVisitor[]>([]);
  const [blockingEntry, setBlockingEntry] = useState<AccessEntry | null>(null);
  const [blockReason, setBlockReason] = useState('');

  const loadBlockedVisitors = useCallback(async () => {
    const { data, error } = await supabase
      .from('blocked_visitors')
      .select('id, visitor_name, visitor_document, reason, blocked_at, is_active')
      .eq('is_active', true)
      .order('blocked_at', { ascending: false })
      .limit(200);

    if (!error && data) {
      setBlockedVisitors(data as BlockedVisitor[]);
    }
  }, []);

  useEffect(() => {
    loadBlockedVisitors();
  }, [loadBlockedVisitors]);

  const isVisitorBlocked = useCallback(
    (document: string) =>
      blockedVisitors.some(blocked => blocked.visitor_document === document && blocked.is_active),
    [blockedVisitors]
  );

  const getBlockedReason = useCallback(
    (document: string) =>
      blockedVisitors.find(blocked => blocked.visitor_document === document)?.reason || null,
    [blockedVisitors]
  );

  const beginBlockVisitor = useCallback((entry: AccessEntry) => {
    setBlockingEntry(entry);
    setBlockReason('');
  }, []);

  const confirmBlockVisitor = useCallback(async () => {
    if (!blockingEntry) {
      return false;
    }

    const { error } = await supabase.from('blocked_visitors').insert({
      visitor_name: blockingEntry.visitorName,
      visitor_document: blockingEntry.visitorDocument,
      reason: blockReason || null,
    });

    if (error) {
      toast.error('Erro ao bloquear visitante');
      return false;
    }

    toast.success(`${blockingEntry.visitorName} foi bloqueado`);
    setBlockingEntry(null);
    setBlockReason('');
    await loadBlockedVisitors();
    return true;
  }, [blockReason, blockingEntry, loadBlockedVisitors]);

  const unblockVisitor = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('blocked_visitors')
        .update({ is_active: false })
        .eq('id', id);

      if (error) {
        toast.error('Erro ao desbloquear visitante');
        return false;
      }

      toast.success('Visitante desbloqueado');
      await loadBlockedVisitors();
      return true;
    },
    [loadBlockedVisitors]
  );

  return {
    blockedVisitors,
    blockingEntry,
    blockReason,
    setBlockReason,
    isVisitorBlocked,
    getBlockedReason,
    beginBlockVisitor,
    confirmBlockVisitor,
    unblockVisitor,
  };
};
