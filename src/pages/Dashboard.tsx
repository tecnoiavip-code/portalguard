import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Car, Clock, Mail, UserCheck, UserRound, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatsCard } from '@/components/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { supabaseStorage } from '@/lib/supabase-storage';
import { AccessEntry, DashboardStats, Device, Resident } from '@/types';

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
  saved_photo_path?: string;
  user_has_image?: boolean | string | number;
  device_type?: Device['type'];
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

type DeviceDashboardInfo = Pick<Device, 'name' | 'type'>;

const buildDeviceInfoMap = (devices: Device[]) => {
  const map: Record<string, DeviceDashboardInfo> = {};

  devices.forEach((device) => {
    const keys = [device.id, device.serialNumber, device.ipAddress].filter(Boolean) as string[];
    keys.forEach((key) => {
      map[key] = { name: device.name, type: device.type };
    });
  });

  return map;
};

const normalizeControlIdPersonName = (value: string) => (
  value
    .replace(/^\s*\d+[a-z]?\s*[-]\s*/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
);

const readControlIdApartmentPrefix = (value: string) => {
  const match = value.match(/^\s*(\d+[a-z]?)\s*[-]\s*/i);
  return match?.[1]?.trim().toLowerCase() || '';
};

const isTruthyPayloadValue = (value: unknown) => (
  value === true || value === 1 || value === '1' || value === 'true'
);

export const Dashboard = () => {
  const [stats, setStats] = useState<DashboardStats>({
    totalResidents: 0,
    pendingMails: 0,
    activeVisitors: 0,
    todayEntries: 0,
  });
  const [allEntries, setAllEntries] = useState<AccessEntry[]>([]);
  const [controlIdEvents, setControlIdEvents] = useState<ControlIdDashboardEvent[]>(loadStoredControlIdEvents);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [deviceInfoMap, setDeviceInfoMap] = useState<Record<string, DeviceDashboardInfo>>({});
  const [eventPhotoUrls, setEventPhotoUrls] = useState<Record<string, string>>({});
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
    let mounted = true;

    Promise.all([
      supabaseStorage.getDevices(),
      supabaseStorage.getResidents(),
    ]).then(([devices, residentsData]) => {
      if (!mounted) return;
      setDeviceInfoMap(buildDeviceInfoMap(devices));
      setResidents(residentsData || []);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const getEventDeviceType = (event: ControlIdDashboardEvent): Device['type'] | '' => {
      const payloadType = readPayloadValue(event.payload, 'device_type');
      if (payloadType === 'facial_recognition' || payloadType === 'vehicle_tag' || payloadType === 'card_reader') {
        return payloadType;
      }
      return deviceInfoMap[event.device_id]?.type || '';
    };

    const isFacialEvent = (event: ControlIdDashboardEvent) => {
      const deviceType = getEventDeviceType(event);
      if (deviceType === 'facial_recognition') return true;
      if (deviceType === 'vehicle_tag' || deviceType === 'card_reader') return false;
      return isTruthyPayloadValue(event.payload?.user_has_image);
    };

    const findLocalPhoto = async (event: ControlIdDashboardEvent) => {
      const title = getControlIdEventTitle(event);
      const normalizedTitle = normalizeControlIdPersonName(title);
      if (!normalizedTitle) return '';

      const entryPhoto = allEntries.find((entry) => {
        const names = [entry.visitorName, entry.residentName].filter(Boolean);
        return names.some((name) => {
          const normalized = normalizeControlIdPersonName(name);
          return normalized && (normalized.includes(normalizedTitle) || normalizedTitle.includes(normalized));
        });
      })?.photo;
      if (entryPhoto) return entryPhoto;

      const apartmentPrefix = readControlIdApartmentPrefix(title);
      const resident = residents.find((item) => {
        const normalizedResidentName = normalizeControlIdPersonName(item.name);
        const apartmentMatches = !apartmentPrefix || item.apartment.trim().toLowerCase() === apartmentPrefix;
        const nameMatches = normalizedResidentName
          && (normalizedResidentName.includes(normalizedTitle) || normalizedTitle.includes(normalizedResidentName));
        return apartmentMatches && nameMatches;
      });

      return resident ? supabaseStorage.getResidentPhoto(resident.id) : '';
    };

    const missingPhotoEvents = controlIdEvents.filter((event) => {
      const path = readPayloadValue(event.payload, 'saved_photo_path');
      return (path || isFacialEvent(event)) && !eventPhotoUrls[event.id];
    });

    if (missingPhotoEvents.length === 0) return;

    let mounted = true;

    Promise.all(
      missingPhotoEvents.map(async (event) => {
        const path = readPayloadValue(event.payload, 'saved_photo_path');
        if (path) {
          const { data, error } = await supabase.storage
            .from('access-photos')
            .createSignedUrl(path, 3600);

          if (!error && data?.signedUrl) return [event.id, data.signedUrl] as const;
        }

        const localPhoto = await findLocalPhoto(event);
        return localPhoto ? [event.id, localPhoto] as const : null;
      })
    ).then((items) => {
      if (!mounted) return;

      const nextUrls = Object.fromEntries(items.filter(Boolean) as Array<readonly [string, string]>);
      if (Object.keys(nextUrls).length > 0) {
        setEventPhotoUrls((current) => ({ ...current, ...nextUrls }));
      }
    });

    return () => {
      mounted = false;
    };
  }, [allEntries, controlIdEvents, deviceInfoMap, eventPhotoUrls, residents]);

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

  const getControlIdDeviceName = (event: ControlIdDashboardEvent) => {
    return deviceInfoMap[event.device_id]?.name || event.device_id || 'Dispositivo Control iD';
  };

  const getControlIdDeviceType = (event: ControlIdDashboardEvent): Device['type'] | '' => {
    const payloadType = readPayloadValue(event.payload, 'device_type');
    if (payloadType === 'facial_recognition' || payloadType === 'vehicle_tag' || payloadType === 'card_reader') {
      return payloadType;
    }
    return deviceInfoMap[event.device_id]?.type || '';
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

  const isControlIdTagEvent = (event: ControlIdDashboardEvent) => {
    const deviceType = getControlIdDeviceType(event);
    if (deviceType === 'facial_recognition') return false;
    if (deviceType === 'vehicle_tag' || deviceType === 'card_reader') return true;

    return Boolean(
      readPayloadValue(event.payload, 'uhf_tag')
      || readPayloadValue(event.payload, 'qrcode_value')
      || (readPayloadValue(event.payload, 'card_value') && !isTruthyPayloadValue(event.payload?.user_has_image))
    );
  };

  const getControlIdEventTypeLabel = (event: ControlIdDashboardEvent) => {
    if (isControlIdTagEvent(event)) return 'TAG identificada';
    return isControlIdEventGranted(event) ? 'Identificacao facial' : 'Nao identificado';
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
                  const isTagEvent = isControlIdTagEvent(event);
                  const photoUrl = eventPhotoUrls[event.id];
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
                      className={`relative grid grid-cols-[62px_88px_minmax(0,1fr)] items-center gap-3 rounded-lg border px-3 py-3.5 ${rowClass}`}
                    >
                      {index < controlIdEvents.length - 1 && (
                        <span className="absolute bottom-[-10px] left-[118px] top-[76px] w-px bg-border" />
                      )}

                      <div className="text-right leading-none">
                        <p className="text-xs font-medium text-muted-foreground">
                          {formatControlIdDate(event.received_at)}
                        </p>
                        <p className={`mt-1 text-xl font-bold ${accentClass}`}>
                          {formatControlIdTime(event.received_at).slice(0, 5)}
                        </p>
                      </div>

                      <div className={`relative z-10 flex h-20 w-20 items-center justify-center rounded-full border-2 ${iconClass}`}>
                        {!isTagEvent && photoUrl ? (
                          <img
                            src={photoUrl}
                            alt={getControlIdEventTitle(event)}
                            className="h-full w-full rounded-full object-cover"
                          />
                        ) : isTagEvent ? (
                          <Car className="h-8 w-8" />
                        ) : (
                          <UserRound className="h-8 w-8" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-base font-semibold leading-tight text-foreground">
                            {getControlIdEventTitle(event)}
                          </p>
                          <Badge variant="outline" className={`shrink-0 px-2 py-0.5 text-[11px] ${badgeClass}`}>
                            {getControlIdStatusLabel(event)}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {getControlIdEventTypeLabel(event)} - {getControlIdDeviceName(event)}
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
