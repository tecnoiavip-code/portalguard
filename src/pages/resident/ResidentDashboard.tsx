import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mail, Users, Shield, MessageSquare } from 'lucide-react';

interface ResidentInfo {
  id: string;
  name: string;
  apartment: string;
}

const ResidentDashboard = () => {
  const { user } = useAuth();
  const [resident, setResident] = useState<ResidentInfo | null>(null);
  const [pendingMails, setPendingMails] = useState(0);
  const [recentVisitors, setRecentVisitors] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingAuths, setPendingAuths] = useState(0);

  useEffect(() => {
    if (!user) return;
    
    const load = async () => {
      // Get resident info
      const { data: res } = await (supabase
        .from('residents')
        .select('id, name, apartment') as any)
        .eq('auth_user_id', user.id)
        .maybeSingle();
      
      if (!res) return;
      setResident(res);

      // Count pending mails
      const { count: mailCount } = await supabase
        .from('mails')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', res.id)
        .eq('status', 'pending');
      setPendingMails(mailCount || 0);

      // Count recent visitors (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { count: visitCount } = await supabase
        .from('access_entries')
        .select('*', { count: 'exact', head: true })
        .eq('apartment', res.apartment)
        .gte('entry_time', weekAgo.toISOString());
      setRecentVisitors(visitCount || 0);

      // Count unread chat messages
      const { count: msgCount } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', res.id)
        .eq('sender_type', 'staff')
        .eq('read', false);
      setUnreadMessages(msgCount || 0);

      // Count pending authorizations
      const { count: authCount } = await supabase
        .from('visitor_authorizations')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', res.id)
        .eq('status', 'pending');
      setPendingAuths(authCount || 0);
    };

    load();
  }, [user]);

  const stats = [
    { label: 'Correspondências Pendentes', value: pendingMails, icon: Mail, color: 'text-warning' },
    { label: 'Visitas (7 dias)', value: recentVisitors, icon: Users, color: 'text-accent' },
    { label: 'Mensagens não lidas', value: unreadMessages, icon: MessageSquare, color: 'text-destructive' },
    { label: 'Autorizações pendentes', value: pendingAuths, icon: Shield, color: 'text-success' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Olá, {resident?.name || 'Morador'}!</h2>
        <p className="text-muted-foreground">Apartamento {resident?.apartment}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-muted ${s.color}`}>
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ResidentDashboard;
