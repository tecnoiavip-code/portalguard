import { useEffect, useState, useMemo, useCallback } from 'react';
import { Users, Mail, UserCheck, Clock, Activity, Radio, CheckCheck, User, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { StatsCard } from '@/components/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabaseStorage } from '@/lib/supabase-storage';
import { supabase } from '@/integrations/supabase/client';
import { DashboardStats, AccessEntry, Mail as MailType, RealtimeEvent, Resident } from '@/types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ControlidLog {
  id: string;
  device_id: string;
  event_type: string;
  payload: any;
  processed: boolean;
  received_at: string;
}

export const Dashboard = () => {
  const [stats, setStats] = useState<DashboardStats>({
    totalResidents: 0,
    pendingMails: 0,
    activeVisitors: 0,
    todayEntries: 0,
  });
  
  const [recentEntries, setRecentEntries] = useState<AccessEntry[]>([]);
  const [allEntries, setAllEntries] = useState<AccessEntry[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [controlidLogs, setControlidLogs] = useState<ControlidLog[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);

  const loadControlidLogs = useCallback(async () => {
    const { data } = await supabase
      .from('controlid_logs')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(50);
    if (data) setControlidLogs(data as ControlidLog[]);
  }, []);

  useEffect(() => {
    loadStats();
    loadControlidLogs();
    const interval = setInterval(loadStats, 30000);
    const channel = supabase
      .channel('controlid-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'controlid_logs',
      }, (payload) => {
        setControlidLogs(prev => [payload.new as ControlidLog, ...prev].slice(0, 50));
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [loadControlidLogs]);

  const loadStats = async () => {
    const [residentsData, mailsData, entriesData, eventsData] = await Promise.all([
      supabaseStorage.getResidents(),
      supabaseStorage.getMails(),
      supabaseStorage.getEntries(),
      supabaseStorage.getEvents(),
    ]);

    setResidents(residentsData || []);

    const today = new Date().toDateString();
    const todayEntries = entriesData.filter(
      (e) => new Date(e.entryTime).toDateString() === today
    );
    const activeVisitors = entriesData.filter((e) => !e.exitTime).length;
    const pendingMails = mailsData.filter((m) => m.status === 'pending').length;

    setStats({
      totalResidents: (residentsData || []).length,
      pendingMails,
      activeVisitors,
      todayEntries: todayEntries.length,
    });

    setRecentEntries(entriesData.slice(0, 5));
    setAllEntries(entriesData);
    setRealtimeEvents(eventsData.slice(0, 5));
  };

  const chartData = useMemo(() => {
    const now = new Date();
    const hours: { hour: string; entradas: number; saidas: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now);
      h.setHours(now.getHours() - i, 0, 0, 0);
      const hEnd = new Date(h);
      hEnd.setHours(h.getHours() + 1);
      const label = h.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const entradas = allEntries.filter(e => {
        const t = new Date(e.entryTime);
        return t >= h && t < hEnd;
      }).length;
      const saidas = allEntries.filter(e => {
        if (!e.exitTime) return false;
        const t = new Date(e.exitTime);
        return t >= h && t < hEnd;
      }).length;
      hours.push({ hour: label, entradas, saidas });
    }
    return hours;
  }, [allEntries]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-2">Dashboard</h2>
        <p className="text-muted-foreground">Visão geral do sistema de controle de acesso</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Total de Moradores"
          value={stats.totalResidents}
          icon={Users}
          colorClass="bg-primary"
        />
        <StatsCard
          title="Correspondências Pendentes"
          value={stats.pendingMails}
          icon={Mail}
          colorClass="bg-warning"
        />
        <StatsCard
          title="Visitantes Ativos"
          value={stats.activeVisitors}
          icon={UserCheck}
          colorClass="bg-success"
        />
        <StatsCard
          title="Entradas Hoje"
          value={stats.todayEntries}
          icon={Clock}
          colorClass="bg-accent"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center space-x-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              <span>Monitoramento de Acessos</span>
              <Badge variant="default" className="ml-auto text-xs animate-pulse">
                Live
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorEntradas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorSaidas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                  tickCount={6}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="entradas"
                  name="Entradas"
                  stroke="hsl(var(--primary))"
                  fillOpacity={1}
                  fill="url(#colorEntradas)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="saidas"
                  name="Saídas"
                  stroke="hsl(var(--destructive))"
                  fillOpacity={1}
                  fill="url(#colorSaidas)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 border-2 border-primary/20 shadow-lg">
          <CardHeader className="pb-3 bg-gradient-to-br from-primary/5 to-primary/10">
            <CardTitle className="flex items-center space-x-2 text-base">
              <Radio className="h-5 w-5 text-primary animate-pulse" />
              <span className="text-primary">Acessos</span>
              <Badge variant="default" className="ml-auto text-xs animate-pulse">
                Live
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 px-2">
            <div className="space-y-0 max-h-[400px] overflow-y-auto relative">
              {/* Timeline vertical line */}
              <div className="absolute left-[52px] top-0 bottom-0 w-0.5 bg-border z-0" />
              
              {controlidLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Aguardando dados dos dispositivos...
                </p>
              ) : (
                controlidLogs.map((log) => {
                  const p = log.payload || {};
                  const changes = p.object_changes?.[0]?.values || {};
                  
                  const userName = changes.user_name || p.user_name || p.name || '';
                  const apartment = changes.apartment || changes.user_id || p.apartment || p.house || '';
                  const photoUrl = changes.photo_url || p.photo_url || p.photo || '';
                  const location = changes.portal_name || p.portal_name || p.location || 'area interna condomínio';
                  
                  const eventTime = new Date(log.received_at);
                  const timeStr = eventTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  const fullTimeStr = eventTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const dateStr = eventTime.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                  
                  const displayName = userName || (log.event_type === 'device_is_alive' ? 'Dispositivo online' : log.event_type === 'door' ? 'Evento de porta' : 'Acesso pela interface web');
                  const displayLabel = apartment && userName ? `${apartment} - ${userName.toUpperCase()}` : displayName.toUpperCase();
                  const isAccess = log.event_type === 'dao' || log.event_type === 'access_photo';

                  return (
                    <div
                      key={log.id}
                      className="flex items-start gap-3 py-3 px-2 relative z-10 group hover:bg-muted/40 rounded-lg transition-colors"
                    >
                      {/* Date & Time */}
                      <div className="flex-shrink-0 w-[40px] text-right pt-2">
                        <p className="text-[10px] text-muted-foreground leading-none">{dateStr}</p>
                        <p className={`text-lg font-bold leading-tight ${isAccess ? 'text-primary' : 'text-muted-foreground'}`}>
                          {timeStr}
                        </p>
                      </div>

                      {/* Avatar */}
                      <div className="flex-shrink-0 z-10">
                        <Avatar className={`h-16 w-16 border-2 ${isAccess ? 'border-primary' : 'border-muted'}`}>
                          {photoUrl ? (
                            <AvatarImage src={photoUrl} alt={displayName} className="object-cover" />
                          ) : null}
                          <AvatarFallback className={`text-base font-bold ${isAccess ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            {userName ? userName.substring(0, 2).toUpperCase() : <User className="h-5 w-5" />}
                          </AvatarFallback>
                        </Avatar>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 pt-1">
                        <p className={`text-sm font-bold truncate leading-tight ${isAccess ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {displayLabel}
                        </p>
                        <div className="flex items-center gap-1 mt-1">
                          <CheckCheck className="h-3 w-3 text-success flex-shrink-0" />
                          <p className="text-[11px] text-muted-foreground truncate">
                            {location}
                          </p>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{fullTimeStr}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};