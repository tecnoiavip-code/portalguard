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
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});

  const loadControlidLogs = useCallback(async () => {
    const { data } = await supabase
      .from('controlid_logs')
      .select('*')
      .in('event_type', ['dao', 'access_photo', 'identification_event'])
      .order('received_at', { ascending: false })
      .limit(50);
    if (data) setControlidLogs(data as ControlidLog[]);
  }, []);

  useEffect(() => {
    loadStats();
    loadControlidLogs();
    // Load device names from controlid_config AND devices table
    Promise.all([
      supabase.from('controlid_config').select('device_id, device_name, device_ip'),
      supabase.from('devices').select('id, name, serial_number, ip_address'),
    ]).then(([configRes, devicesRes]) => {
      const map: Record<string, string> = {};
      // Map from devices table first (registered devices)
      if (devicesRes.data) {
        devicesRes.data.forEach(d => {
          if (d.serial_number) map[d.serial_number] = d.name;
          if (d.ip_address) map[d.ip_address] = d.name;
          map[d.id] = d.name;
          map[d.name.toLowerCase()] = d.name;
        });
      }
      // Map from controlid_config (overrides if exists)
      if (configRes.data) {
        configRes.data.forEach(d => {
          if (d.device_id) map[d.device_id] = d.device_name;
          if (d.device_ip) map[d.device_ip] = d.device_name;
          map[d.device_name.toLowerCase()] = d.device_name;
        });
      }
      setDeviceNames(map);
    });
    const interval = setInterval(loadStats, 30000);
    const channel = supabase
      .channel('controlid-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'controlid_logs',
      }, (payload) => {
        const newLog = payload.new as ControlidLog;
        if (newLog.event_type === 'dao' || newLog.event_type === 'access_photo' || newLog.event_type === 'identification_event') {
          setControlidLogs(prev => [newLog, ...prev].slice(0, 50));
        }
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
                  const photoUrl = changes.photo_url || p.photo_url || p.photo || '';
                  
                  // Try to find resident by name to get apartment
                  let apartment = changes.apartment || changes.user_id || p.apartment || p.house || '';
                  let matchedResident: Resident | undefined;
                  if (userName && residents.length > 0) {
                    matchedResident = residents.find(r => 
                      r.name.toLowerCase().trim() === userName.toLowerCase().trim()
                    );
                    if (matchedResident) {
                      if (!apartment) apartment = matchedResident.apartment;
                    }
                  }
                  // Resolve device name from controlid_config
                  const rawLocation = changes.portal_name || p.portal_name || p.location || '';
                  const location = rawLocation || deviceNames[log.device_id] || deviceNames[log.device_id?.toLowerCase()] || log.device_id || 'Dispositivo desconhecido';
                  
                  const eventTime = new Date(log.received_at);
                  const timeStr = eventTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  const fullTimeStr = eventTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const dateStr = eventTime.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                  
                  const isAccess = log.event_type === 'dao' || log.event_type === 'access_photo' || log.event_type === 'identification_event';
                  const isRecognized = isAccess && !!userName;
                  const isUnidentified = isAccess && !userName;
                  const isSystemEvent = !isAccess;

                  const displayName = userName || (log.event_type === 'device_is_alive' ? 'Dispositivo online' : log.event_type === 'door' ? 'Evento de porta' : 'Acesso pela interface web');
                  const displayLabel = apartment && userName ? `${apartment} - ${userName.toUpperCase()}` : displayName.toUpperCase();

                  // Visual config based on recognition status
                  const borderColor = isRecognized ? 'border-success' : isUnidentified ? 'border-warning' : 'border-muted';
                  const bgHover = isRecognized ? 'hover:bg-success/5' : isUnidentified ? 'hover:bg-warning/5' : 'hover:bg-muted/40';
                  const avatarBg = isRecognized ? 'bg-success/10 text-success' : isUnidentified ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground';
                  const nameColor = isRecognized ? 'text-foreground' : isUnidentified ? 'text-warning' : 'text-muted-foreground';
                  const timeColor = isRecognized ? 'text-success' : isUnidentified ? 'text-warning' : 'text-muted-foreground';

                  return (
                    <div
                      key={log.id}
                      className={`flex items-start gap-3 py-3 px-2 relative z-10 group rounded-lg transition-colors ${bgHover}`}
                    >
                      {/* Date & Time */}
                      <div className="flex-shrink-0 w-[40px] text-right pt-2">
                        <p className="text-[10px] text-muted-foreground leading-none">{dateStr}</p>
                        <p className={`text-lg font-bold leading-tight ${timeColor}`}>
                          {timeStr}
                        </p>
                      </div>

                      {/* Avatar */}
                      <div className="flex-shrink-0 z-10 relative">
                        <Avatar className={`h-16 w-16 border-2 ${borderColor}`}>
                          {photoUrl ? (
                            <AvatarImage src={photoUrl} alt={displayName} className="object-cover" />
                          ) : null}
                          <AvatarFallback className={`text-base font-bold ${avatarBg}`}>
                            {userName ? userName.substring(0, 2).toUpperCase() : <User className="h-5 w-5" />}
                          </AvatarFallback>
                        </Avatar>
                        {/* Recognition badge */}
                        {isAccess && (
                          <div className={`absolute -bottom-1 -right-1 rounded-full p-0.5 ${isRecognized ? 'bg-success text-success-foreground' : 'bg-warning text-warning-foreground'}`}>
                            {isRecognized ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-bold truncate leading-tight ${nameColor}`}>
                            {displayLabel}
                          </p>
                          {isAccess && (
                            <Badge variant={isRecognized ? 'default' : 'secondary'} className={`text-[9px] px-1.5 py-0 shrink-0 ${isRecognized ? 'bg-success/15 text-success border-success/30 hover:bg-success/20' : 'bg-warning/15 text-warning border-warning/30 hover:bg-warning/20'}`}>
                              {isRecognized ? 'Identificado' : 'Não identificado'}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          {isRecognized ? (
                            <CheckCheck className="h-3 w-3 text-success flex-shrink-0" />
                          ) : isUnidentified ? (
                            <ShieldAlert className="h-3 w-3 text-warning flex-shrink-0" />
                          ) : (
                            <Radio className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          )}
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