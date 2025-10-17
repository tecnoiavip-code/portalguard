import { useEffect, useState } from 'react';
import { Users, Mail, UserCheck, Clock, Activity } from 'lucide-react';
import { StatsCard } from '@/components/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { storage } from '@/lib/storage';
import { DashboardStats, AccessEntry, Mail as MailType, RealtimeEvent } from '@/types';

export const Dashboard = () => {
  const [stats, setStats] = useState<DashboardStats>({
    totalResidents: 0,
    pendingMails: 0,
    activeVisitors: 0,
    todayEntries: 0,
  });
  
  const [recentEntries, setRecentEntries] = useState<AccessEntry[]>([]);
  const [recentMails, setRecentMails] = useState<MailType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = () => {
    const residents = storage.getResidents();
    const mails = storage.getMails();
    const entries = storage.getEntries();

    const today = new Date().toDateString();
    const todayEntries = entries.filter(
      (e) => new Date(e.entryTime).toDateString() === today
    );
    const activeVisitors = entries.filter((e) => !e.exitTime).length;
    const pendingMails = mails.filter((m) => m.status === 'pending').length;

    setStats({
      totalResidents: residents.length,
      pendingMails,
      activeVisitors,
      todayEntries: todayEntries.length,
    });

    setRecentEntries(entries.slice(-5).reverse());
    setRecentMails(mails.slice(-5).reverse());
    setRealtimeEvents(storage.getEvents().slice(0, 10));
  };

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
          colorClass="bg-gradient-primary"
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
            <div className="space-y-2 max-h-[380px] overflow-y-auto">
              {recentEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum acesso registrado ainda
                </p>
              ) : (
                recentEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-2.5 bg-muted rounded-lg"
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
                    <div
                      className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ml-2 ${
                        entry.exitTime
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-success/20 text-success'
                      }`}
                    >
                      {entry.exitTime ? 'Saiu' : 'Ativo'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center space-x-2 text-base">
              <Mail className="h-4 w-4 text-primary" />
              <span>Correspondências</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[380px] overflow-y-auto">
              {recentMails.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma correspondência registrada
                </p>
              ) : (
                recentMails.map((mail) => {
                  const resident = storage.getResidents().find((r) => r.id === mail.residentId);
                  return (
                    <div
                      key={mail.id}
                      className="flex items-center justify-between p-2.5 bg-muted rounded-lg"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{resident?.name || 'Desconhecido'}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {mail.packageType} • {mail.sender}
                        </p>
                      </div>
                      <div
                        className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ml-2 ${
                          mail.status === 'delivered'
                            ? 'bg-success/20 text-success'
                            : 'bg-warning/20 text-warning'
                        }`}
                      >
                        {mail.status === 'delivered' ? 'Entregue' : 'Pendente'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center space-x-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              <span>Eventos em Tempo Real</span>
              <Badge variant="outline" className="ml-auto text-xs">
                5s
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[380px] overflow-y-auto">
              {realtimeEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum evento registrado
                </p>
              ) : (
                realtimeEvents.map((event) => (
                  <div
                    key={event.id}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border-l-4 ${
                      event.priority === 'high'
                        ? 'bg-destructive/10 border-destructive'
                        : event.priority === 'medium'
                        ? 'bg-warning/10 border-warning'
                        : 'bg-muted border-muted-foreground'
                    }`}
                  >
                    <div className="flex-shrink-0 mt-0.5 text-sm">
                      {event.type === 'entry' && '🚪'}
                      {event.type === 'exit' && '👋'}
                      {event.type === 'mail' && '📬'}
                      {event.type === 'alert' && '⚠️'}
                      {event.type === 'device' && '🔧'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        {event.description}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(event.timestamp).toLocaleString('pt-BR', { 
                          day: '2-digit', 
                          month: '2-digit', 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </p>
                    </div>
                    <Badge
                      variant={
                        event.priority === 'high'
                          ? 'destructive'
                          : event.priority === 'medium'
                          ? 'default'
                          : 'secondary'
                      }
                      className="flex-shrink-0 text-xs"
                    >
                      {event.priority === 'high' ? 'Alta' : event.priority === 'medium' ? 'Média' : 'Baixa'}
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