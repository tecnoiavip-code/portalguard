import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Clock, Mail, UserCheck, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatsCard } from '@/components/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { supabaseStorage } from '@/lib/supabase-storage';
import { AccessEntry, DashboardStats } from '@/types';
import { useDevices } from '@/hooks/useDevices';

export const Dashboard = () => {
  const { devices } = useDevices();
  const [stats, setStats] = useState<DashboardStats>({
    totalResidents: 0,
    pendingMails: 0,
    activeVisitors: 0,
    todayEntries: 0,
  });
  const [allEntries, setAllEntries] = useState<AccessEntry[]>([]);
  const statsLoadInFlight = useRef(false);

  const loadStats = async () => {
    if (statsLoadInFlight.current) return;
    statsLoadInFlight.current = true;

    try {
      const [residentsCountRes, pendingMailsRes, entriesData] = await Promise.all([
        supabase.from('residents').select('id', { count: 'exact', head: true }),
        supabase.from('mails').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabaseStorage.getEntries(),
      ]);

      const today = new Date().toDateString();
      const todayEntries = entriesData.filter(
        (entry) => new Date(entry.entryTime).toDateString() === today
      );

      setStats({
        totalResidents: residentsCountRes.count || 0,
        pendingMails: pendingMailsRes.count || 0,
        activeVisitors: entriesData.filter((entry) => !entry.exitTime).length,
        todayEntries: todayEntries.length,
      });
      setAllEntries(entriesData);
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      statsLoadInFlight.current = false;
    }
  };

  useEffect(() => {
    loadStats();

    const loadIfVisible = () => {
      if (document.visibilityState === 'visible') loadStats();
    };
    window.addEventListener('focus', loadIfVisible);
    document.addEventListener('visibilitychange', loadIfVisible);

    const interval = window.setInterval(loadIfVisible, 300000);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', loadIfVisible);
      document.removeEventListener('visibilitychange', loadIfVisible);
    };
  }, []);

  const chartData = useMemo(() => {
    const now = new Date();
    const hours: { hour: string; entradas: number; saidas: number }[] = [];

    for (let i = 23; i >= 0; i--) {
      const start = new Date(now);
      start.setHours(now.getHours() - i, 0, 0, 0);
      const end = new Date(start);
      end.setHours(start.getHours() + 1);

      hours.push({
        hour: start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        entradas: allEntries.filter((entry) => {
          const entryTime = new Date(entry.entryTime);
          return entryTime >= start && entryTime < end;
        }).length,
        saidas: allEntries.filter((entry) => {
          if (!entry.exitTime) return false;
          const exitTime = new Date(entry.exitTime);
          return exitTime >= start && exitTime < end;
        }).length,
      });
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
        <StatsCard title="Total de Moradores" value={stats.totalResidents} icon={Users} colorClass="bg-primary" />
        <StatsCard title="Correspondências Pendentes" value={stats.pendingMails} icon={Mail} colorClass="bg-warning" />
        <StatsCard title="Visitantes Ativos" value={stats.activeVisitors} icon={UserCheck} colorClass="bg-success" />
        <StatsCard title="Entradas Hoje" value={stats.todayEntries} icon={Clock} colorClass="bg-accent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center space-x-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              <span>Monitoramento de Acessos</span>
              <Badge variant="default" className="ml-auto text-xs">
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
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" tickCount={6} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area type="monotone" dataKey="entradas" name="Entradas" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorEntradas)" strokeWidth={2} />
                <Area type="monotone" dataKey="saidas" name="Saídas" stroke="hsl(var(--destructive))" fillOpacity={1} fill="url(#colorSaidas)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 border-2 border-primary/20 shadow-lg">
          <CardHeader className="pb-3 bg-gradient-to-br from-primary/5 to-primary/10">
            <CardTitle className="flex items-center justify-between text-base">
              <div className="flex items-center space-x-2">
                <Activity className="h-5 w-5 text-primary" />
                <span className="text-primary">Dispositivos</span>
              </div>
              <Badge variant="secondary" className="text-xs bg-success/20 text-success hover:bg-success/30">
                Otimizado (Event-only)
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center space-y-2 py-4">
              <span className="text-4xl font-bold text-primary">
                {devices.filter(d => d.status === 'online').length} <span className="text-xl text-muted-foreground font-normal">/ {devices.length}</span>
              </span>
              <p className="text-sm text-muted-foreground text-center">
                Equipamentos ativos reportando eventos em tempo real
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
