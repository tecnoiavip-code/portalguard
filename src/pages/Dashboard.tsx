import { useEffect, useState, useMemo, useCallback } from 'react';
import { Users, Mail, UserCheck, Clock, Activity, Radio } from 'lucide-react';
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
    const interval = setInterval(loadStats, 5000);
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

    setResidents(residentsData);

    const today = new Date().toDateString();
    const todayEntries = entriesData.filter(
      (e) => new Date(e.entryTime).toDateString() === today
    );
    const activeVisitors = entriesData.filter((e) => !e.exitTime).length;
    const pendingMails = mailsData.filter((m) => m.status === 'pending').length;

    setStats({
      totalResidents: residentsData.length,
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center space-x-2 text-base">
              <Clock className="h-4 w-4 text-primary" />
              <span>Últimos Acessos</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
              {recentEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhum acesso registrado ainda
                </p>
              ) : (
                recentEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded-md hover:bg-muted transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{entry.visitorName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {entry.apartment} • {new Date(entry.entryTime).toLocaleString('pt-BR', { 
                          day: '2-digit', 
                          month: '2-digit', 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </p>
                    </div>
                    <Badge 
                      variant={entry.exitTime ? "secondary" : "default"}
                      className="flex-shrink-0 ml-2 text-xs"
                    >
                      {entry.exitTime ? 'Saiu' : 'Ativo'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

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
          <CardContent className="pt-4">
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {controlidLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Aguardando dados dos dispositivos...
                </p>
              ) : (
                controlidLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-2.5 p-3 rounded-lg border-l-[3px] shadow-sm hover:shadow transition-all bg-muted/50 border-primary/40 hover:bg-muted"
                  >
                    <div className="flex-shrink-0 mt-0.5 text-base">
                      {log.event_type === 'dao' && '🚪'}
                      {log.event_type === 'device_is_alive' && '💚'}
                      {log.event_type === 'access_photo' && '📸'}
                      {log.event_type === 'door' && '🔓'}
                      {log.event_type === 'catra_event' && '🔄'}
                      {log.event_type === 'operation_mode' && '⚙️'}
                      {log.event_type === 'unknown' && '❓'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground leading-tight">
                        {log.event_type === 'dao' ? 'Acesso registrado' :
                         log.event_type === 'device_is_alive' ? 'Dispositivo online' :
                         log.event_type === 'access_photo' ? 'Foto de acesso' :
                         log.event_type === 'door' ? 'Evento de porta' :
                         log.event_type === 'catra_event' ? 'Evento de catraca' :
                         log.event_type === 'operation_mode' ? 'Modo de operação' :
                         'Evento desconhecido'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Dispositivo: {log.device_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.received_at).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </p>
                    </div>
                    <Badge variant="secondary" className="flex-shrink-0 text-xs">
                      {log.event_type}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};