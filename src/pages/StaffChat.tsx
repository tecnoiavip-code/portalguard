import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Send, MessageSquare, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ChatThread {
  resident_id: string;
  resident_name: string;
  apartment: string;
  unread_count: number;
  last_message: string;
  last_time: string;
}

interface ChatMsg {
  id: string;
  sender_type: string;
  message: string;
  created_at: string;
  read: boolean;
}

const StaffChat = () => {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = async () => {
    // Get all residents who have chat messages
    const { data: chatResidents } = await supabase
      .from('chat_messages')
      .select('resident_id')
      .order('created_at', { ascending: false });

    if (!chatResidents) return;

    const uniqueIds = [...new Set(chatResidents.map(c => c.resident_id))];
    if (uniqueIds.length === 0) return;

    const threadList: ChatThread[] = [];
    for (const rid of uniqueIds) {
      // Get resident info
      const { data: res } = await supabase
        .from('residents')
        .select('name, apartment')
        .eq('id', rid)
        .maybeSingle();
      if (!res) continue;

      // Get unread count
      const { count } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', rid)
        .eq('sender_type', 'resident')
        .eq('read', false);

      // Get last message
      const { data: lastMsg } = await supabase
        .from('chat_messages')
        .select('message, created_at')
        .eq('resident_id', rid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      threadList.push({
        resident_id: rid,
        resident_name: res.name,
        apartment: res.apartment,
        unread_count: count || 0,
        last_message: lastMsg?.message || '',
        last_time: lastMsg?.created_at || '',
      });
    }

    setThreads(threadList);
  };

  const loadMessages = async (rid: string) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('id, sender_type, message, created_at, read')
      .eq('resident_id', rid)
      .order('created_at', { ascending: true });
    setMessages((data as any) || []);

    // Mark resident messages as read
    await supabase
      .from('chat_messages')
      .update({ read: true })
      .eq('resident_id', rid)
      .eq('sender_type', 'resident')
      .eq('read', false);
  };

  useEffect(() => { loadThreads(); }, []);

  useEffect(() => {
    if (!selectedThread) return;
    loadMessages(selectedThread.resident_id);

    const channel = supabase
      .channel(`staff-chat-${selectedThread.resident_id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `resident_id=eq.${selectedThread.resident_id}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as ChatMsg]);
        if ((payload.new as ChatMsg).sender_type === 'resident') {
          supabase.from('chat_messages').update({ read: true }).eq('id', (payload.new as ChatMsg).id);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedThread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current?.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!newMsg.trim() || !selectedThread || !user) return;
    const msg = newMsg.trim();
    setNewMsg('');
    await supabase.from('chat_messages').insert({
      resident_id: selectedThread.resident_id,
      sender_id: user.id,
      sender_type: 'staff',
      message: msg,
    } as any);

    // Notify resident
    const { data: res } = await (supabase.from('residents').select('auth_user_id') as any)
      .eq('id', selectedThread.resident_id)
      .maybeSingle();
    if (res?.auth_user_id) {
      await supabase.from('notifications').insert({
        user_id: res.auth_user_id,
        title: 'Nova mensagem da portaria',
        body: msg.substring(0, 100),
        type: 'chat',
        related_id: selectedThread.resident_id,
      });
    }
  };

  if (!selectedThread) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Chat com Moradores</h2>
        {threads.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhuma conversa iniciada</CardContent></Card>
        ) : (
          threads.map((t) => (
            <Card key={t.resident_id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedThread(t)}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <MessageSquare className="h-5 w-5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{t.resident_name} - Apto {t.apartment}</p>
                    {t.unread_count > 0 && (
                      <Badge variant="destructive">{t.unread_count}</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{t.last_message}</p>
                  {t.last_time && (
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(t.last_time), "dd/MM 'às' HH:mm", { locale: ptBR })}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" onClick={() => { setSelectedThread(null); loadThreads(); }}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-lg font-bold">{selectedThread.resident_name}</h2>
          <p className="text-sm text-muted-foreground">Apto {selectedThread.apartment}</p>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden">
        <div ref={scrollRef} className="h-full overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={cn('flex', m.sender_type === 'staff' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2',
                m.sender_type === 'staff'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted rounded-bl-sm'
              )}>
                <p className="text-sm">{m.message}</p>
                <p className={cn('text-[10px] mt-1', m.sender_type === 'staff' ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                  {format(new Date(m.created_at), 'HH:mm', { locale: ptBR })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex gap-2 mt-3">
        <Input
          value={newMsg}
          onChange={(e) => setNewMsg(e.target.value)}
          placeholder="Digite sua mensagem..."
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <Button size="icon" onClick={sendMessage} disabled={!newMsg.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default StaffChat;
