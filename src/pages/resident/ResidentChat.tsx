import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Clock, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { sendPushToStaff } from '@/lib/push-subscription';

interface ChatMsg {
  id: string;
  sender_type: string;
  message: string;
  created_at: string;
  read: boolean;
}

const ResidentChat = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [residentId, setResidentId] = useState<string | null>(null);
  const [newMsg, setNewMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  const loadMessages = async (rid: string) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('id, sender_type, message, created_at, read')
      .eq('resident_id', rid)
      .order('created_at', { ascending: true });
    setMessages((data as any) || []);
    
    await supabase
      .from('chat_messages')
      .update({ read: true })
      .eq('resident_id', rid)
      .eq('sender_type', 'staff')
      .eq('read', false);
  };

  useEffect(() => {
    if (!user) return;
    const init = async () => {
      const { data: res } = await (supabase
        .from('residents')
        .select('id') as any)
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (!res) { setLoading(false); return; }
      setResidentId(res.id);
      await loadMessages(res.id);
      setLoading(false);
    };
    init();
  }, [user]);

  useEffect(() => {
    if (!residentId) return;
    const channel = supabase
      .channel(`chat-${residentId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `resident_id=eq.${residentId}`,
      }, (payload) => {
        setMessages((prev) => [...prev, payload.new as ChatMsg]);
        if ((payload.new as ChatMsg).sender_type === 'staff') {
          supabase.from('chat_messages').update({ read: true }).eq('id', (payload.new as ChatMsg).id);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [residentId]);

  useEffect(() => { scrollToBottom(); }, [messages]);

  const sendMessage = async () => {
    if (!newMsg.trim() || !residentId || !user) return;
    const msg = newMsg.trim();
    setNewMsg('');
    await supabase.from('chat_messages').insert({
      resident_id: residentId,
      sender_id: user.id,
      sender_type: 'resident',
      message: msg,
    } as any);

    // Push notification to staff (DB trigger handles in-app notifications)
    sendPushToStaff('Nova mensagem de morador', msg.substring(0, 100), `chat-${residentId}`);
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <Clock className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] animate-in fade-in duration-500">
      <div className="mb-3">
        <h2 className="text-xl font-bold text-foreground">Chat</h2>
        <p className="text-sm text-muted-foreground">Fale diretamente com a portaria</p>
      </div>
      
      <div className="flex-1 overflow-hidden bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl">
        <div ref={scrollRef} className="h-full overflow-y-auto p-4 space-y-3 flex flex-col justify-end">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageCircle className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">Envie uma mensagem para a portaria</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn('flex', m.sender_type === 'resident' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm',
                m.sender_type === 'resident'
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-muted/80 backdrop-blur-sm rounded-bl-md'
              )}>
                <p className="text-sm leading-relaxed">{m.message}</p>
                <p className={cn(
                  'text-[10px] mt-1 text-right',
                  m.sender_type === 'resident' ? 'text-primary-foreground/60' : 'text-muted-foreground'
                )}>
                  {format(new Date(m.created_at), 'HH:mm', { locale: ptBR })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <Input
          value={newMsg}
          onChange={(e) => setNewMsg(e.target.value)}
          placeholder="Digite sua mensagem..."
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          className="rounded-xl"
        />
        <Button size="icon" onClick={sendMessage} disabled={!newMsg.trim()} className="rounded-xl shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default ResidentChat;
