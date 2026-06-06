import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Car, Clock, Mail, UserCheck, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatsCard } from '@/components/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { supabaseStorage } from '@/lib/supabase-storage';
import { AccessEntry, DashboardStats } from '@/types';

const CONTROLID_EVENT_LIMIT = 10;
const CONTROLID_EVENT_STORAGE_KEY = 'portalguard-controlid-last-events-v1';

type ControlIdPayload = {
  [key: string]: unknown;
  event?: string | number;
  name?: string;
  portal_id?: string | number;
  user_id?: string | number;
  user_name?: string;
  access_granted?: boolean | string;
};

type ControlIdDashboardEvent = {
  id: string;
  device_id: string;
  event_type: string;
  payload: ControlIdPayload | null;
  processed: boolean | null;
  received_at: string | null;
};

const normalizeControlIdEvent = (row: unknown): ControlIdDashboardEvent | null => {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as ControlIdPayload
    : null;

  return {
    id: String(record.id || ''),
    device_id: String(record.device_id || ''),
    event_type: String(record.event_type || ''),
    payload,
    processed: typeof record.processed === 'boolean' ? record.processed : null,
    received_at: typeof record.received_at === 'string' ? record.received_at : null,
  };
};

const mergeControlIdEvents = (
  current: ControlIdDashboardEvent[],
  nextEvent: ControlIdDashboardEvent
) => {
  const deduped = current.filter((event) => event.id !== nextEvent.id);
  return [nextEvent, ...deduped].slice(0, CONTROLID_EVENT_LIMIT);
};

const loadStoredControlIdEvents = (): ControlIdDashboardEvent[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(CONTROLID_EVENT_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeControlIdEvent)
      .filter((event): event is ControlIdDashboardEvent => Boolean(event?.id))
      .slice(0, CONTROLID_EVENT_LIMIT);
  } catch (error) {
    console.error('Error loading stored Control iD events:', error);
    return [];
  }
};

const persistControlIdEvents = (events: ControlIdDashboardEvent[]) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      CONTROLID_EVENT_STORAGE_KEY,
      JSON.stringify(events.slice(0, CONTROLID_EVENT_LIMIT))
    );
  } catch (error) {
    console.error('Error storing Control iD events:', error);
  }
};

const readPayloadValue = (payload: ControlIdPayload | null, key: keyof ControlIdPayload) => {
  const value = payload?.[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};

const formatControlIdTime = (receivedAt: string | null) => {
  if (!receivedAt) return '--:--';
  return new Date(receivedAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatControlIdDate = (receivedAt: string | null) => {
  if (!receivedAt) return '--/--';
  return new Date(receivedAt).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
};

export const Dashboard = () => {
  const [stats, setStats] = useState<DashboardStats>({
    totalResidents: 0,
    pendingMails: 0,
    activeVisitors: 0,
    todayEntries: 0,
  });
  const [allEntries, setAllEntries] = useState<AccessEntry[]>([]);
  const [controlIdEvents, setControlIdEvents] = useState<ControlIdDashboardEvent[]>(loadStoredControlIdEvents);
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

  useEffect(() => {
    const channel = supabase
      .channel('controlid-dashboard', {
        config: {
          broadcast: { self: false },
        },
      })
      .on(
        'broadcast',
        { event: 'controlid-event' },
        (message) => {
          const nextEvent = normalizeControlIdEvent(message.payload);
          if (!nextEvent?.id) return;

          setControlIdEvents((current) => {
            const nextEvents = mergeControlIdEvents(current, nextEvent);
            persistControlIdEvents(nextEvents);
            return nextEvents;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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

  const getControlIdEventTitle = (event: ControlIdDashboardEvent) => {
    return readPayloadValue(event.payload, 'user_name')
      || readPayloadValue(event.payload, 'name')
      || 'Identificacao recebida';
  };

  const getControlIdEventDetails = (event: ControlIdDashboardEvent) => {
    const portal = readPayloadValue(event.payload, 'portal_id') || '1';
    const incomingEvent = readPayloadValue(event.payload, 'event');

    return `Porta ${portal}${incomingEvent ? ` - Evento ${incomingEvent}` : ''}`;
  };

  const isControlIdEventGranted = (event: ControlIdDashboardEvent) => {
    const incomingEvent = Number.parseInt(readPayloadValue(event.payload, 'event') || '0', 10);
    const accessGranted = event.payload?.access_granted;
    const title = getControlIdEventTitle(event).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (accessGranted === false || accessGranted === 'false') return false;
    if (accessGranted === true || accessGranted === 'true') return true;
    if (event.processed === false || incomingEvent === 3 || incomingEvent === 6) return false;
    if (title.includes('desconhecido') || title.includes('unknown') || title.includes('negado')) return false;

    return event.processed === true || incomingEvent === 7 || incomingEvent === 8;
  };

  const getControlIdStatusLabel = (event: ControlIdDashboardEvent) => (
    isControlIdEventGranted(event) ? 'Liberado' : 'Negado'
  );

  const getControlIdEventTypeLabel = (event: ControlIdDashboardEvent) => {
    const hasTag = Boolean(
      readPayloadValue(event.payload, 'uhf_tag')
      || readPayloadValue(event.payload, 'card_value')
      || readPayloadValue(event.payload, 'qrcode_value')
    );

    if (hasTag) return 'TAG Identificada';
    return isControlIdEventGranted(event) ? 'Identificacao positiva' : 'Nao identificado';
  };

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
            <CardTitle className="flex items-center space-x-2 text-base">
              <Activity className="h-5 w-5 text-primary" />
              <span className="text-primary">Dispositivos</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {controlIdEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                Aguardando novos eventos dos dispositivos
              </div>
            ) : (
              <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
                {controlIdEvents.map((event, index) => {
                  const granted = isControlIdEventGranted(event);
                  const accentClass = granted ? 'text-success' : 'text-destructive';
                  const rowClass = granted
                    ? 'border-success/10 bg-success/5'
                    : 'border-destructive/10 bg-destructive/5';
                  const iconClass = granted
                    ? 'border-success bg-success/10 text-success'
                    : 'border-destructive bg-destructive/10 text-destructive';
                  const badgeClass = granted
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-destructive/30 bg-destructive/10 text-destructive';

                  return (
                    <div
                      key={event.id}
                      className={`relative grid grid-cols-[54px_52px_minmax(0,1fr)] items-center gap-2 rounded-lg border px-2 py-3 ${rowClass}`}
                    >
                      {index < controlIdEvents.length - 1 && (
                        <span className="absolute bottom-[-10px] left-[81px] top-[50px] w-px bg-border" />
                      )}

                      <div className="text-right leading-none">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {formatControlIdDate(event.received_at)}
                        </p>
                        <p className={`mt-1 text-lg font-bold ${accentClass}`}>
                          {formatControlIdTime(event.received_at).slice(0, 5)}
                        </p>
                      </div>

                      <div className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 ${iconClass}`}>
                        <Car className="h-5 w-5" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {getControlIdEventTitle(event)}
                          </p>
                          <Badge variant="outline" className={`shrink-0 text-[10px] ${badgeClass}`}>
                            {getControlIdStatusLabel(event)}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {getControlIdEventTypeLabel(event)} - {getControlIdEventDetails(event)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatControlIdTime(event.received_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
};
