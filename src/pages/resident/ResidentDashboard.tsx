import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Mail, Users, Shield, MessageSquare, ChevronRight } from 'lucide-react';

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
      const { data: res } = await (supabase
        .from('residents')
        .select('id, name, apartment') as any)
        .eq('auth_user_id', user.id)
        .maybeSingle();
      
      if (!res) return;
      setResident(res);

      const { count: mailCount } = await supabase
        .from('mails')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', res.id)
        .eq('status', 'pending');
      setPendingMails(mailCount || 0);

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { count: visitCount } = await supabase
        .from('access_entries')
        .select('*', { count: 'exact', head: true })
        .eq('apartment', res.apartment)
        .gte('entry_time', weekAgo.toISOString());
      setRecentVisitors(visitCount || 0);

      const { count: msgCount } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', res.id)
        .eq('sender_type', 'staff')
        .eq('read', false);
      setUnreadMessages(msgCount || 0);

      const { count: authCount } = await supabase
        .from('visitor_authorizations')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', res.id)
        .eq('status', 'pending');
      setPendingAuths(authCount || 0);
    };

    load();
  }, [user]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  const stats = [
    { label: 'Correspondências', sub: 'pendentes', value: pendingMails, icon: Mail, gradient: 'from-blue-500 to-cyan-400', bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400' },
    { label: 'Visitas', sub: 'últimos 7 dias', value: recentVisitors, icon: Users, gradient: 'from-violet-500 to-purple-400', bg: 'bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400' },
    { label: 'Mensagens', sub: 'não lidas', value: unreadMessages, icon: MessageSquare, gradient: 'from-rose-500 to-pink-400', bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400' },
    { label: 'Autorizações', sub: 'pendentes', value: pendingAuths, icon: Shield, gradient: 'from-emerald-500 to-teal-400', bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="rounded-2xl bg-primary p-5 text-primary-foreground relative overflow-hidden"
        style={{ boxShadow: 'var(--shadow-elegant)' }}
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-8 translate-x-8" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-6 -translate-x-6" />
        <div className="relative z-10">
          <p className="text-sm opacity-80">{greeting()}</p>
          <h2 className="text-xl font-bold mt-0.5">{resident?.name || 'Morador'}</h2>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded-full backdrop-blur-sm">
              Apto {resident?.apartment}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden group cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className={`p-2 rounded-xl ${s.bg}`}>
                  <s.icon className={`h-5 w-5 ${s.text}`} />
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              </div>
              <div className="mt-3">
                <p className="text-2xl font-bold tracking-tight">{s.value}</p>
                <p className="text-xs font-medium text-foreground/80 mt-0.5">{s.label}</p>
                <p className="text-[10px] text-muted-foreground">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ResidentDashboard;
