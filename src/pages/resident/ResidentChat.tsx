import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Send, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
    
    // Mark staff messages as read
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

  // Realtime subscription
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
        // Auto-mark as read if from staff
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

    // Notify staff
    const { data: staffRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .in('role', ['admin', 'receptionist', 'security_guard'] as any);
    if (staffRoles) {
      const notifications = staffRoles.map((r: any) => ({
        user_id: r.user_id,
        title: 'Nova mensagem de morador',
        body: msg.substring(0, 100),
        type: 'chat',
        related_id: residentId,
      }));
      await supabase.from('notifications').insert(notifications);
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Clock className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      <h2 className="text-xl font-bold mb-4">Chat com Portaria</h2>
      
      <Card className="flex-1 overflow-hidden">
        <div ref={scrollRef} className="h-full overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Envie uma mensagem para a portaria</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn('flex', m.sender_type === 'resident' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2',
                m.sender_type === 'resident'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted rounded-bl-sm'
              )}>
                <p className="text-sm">{m.message}</p>
                <p className={cn('text-[10px] mt-1', m.sender_type === 'resident' ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
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

export default ResidentChat;
