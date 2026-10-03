import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ShieldAlert, Phone, CheckCircle2, Siren } from 'lucide-react';
import { startPanicSiren, stopPanicSiren } from '@/lib/panic-siren';
import { toast } from 'sonner';

interface PanicAlert {
  id: string;
  apartment: string | null;
  resident_name: string | null;
  resident_phone: string | null;
  location_context: string;
  status: string;
  acknowledged_at: string | null;
  created_at: string;
}

const locationLabel: Record<string, string> = {
  apartment: 'Na unidade',
  garage: 'Garagem / Portão',
  entrance: 'Chegando / Entrada',
  other: 'Não informado',
};

const db = supabase as any;

export const PanicAlertMonitor = () => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<PanicAlert[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await db
      .from('panic_alerts')
      .select('id, apartment, resident_name, resident_phone, location_context, status, acknowledged_at, created_at')
      .in('status', ['active', 'acknowledged'])
      .order('created_at', { ascending: false })
      .limit(10);
    setAlerts((data as PanicAlert[]) || []);
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    const channel = supabase
      .channel('staff-panic-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'panic_alerts' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  const hasActive = alerts.some(a => a.status === 'active');
  useEffect(() => {
    if (hasActive) startPanicSiren(); else stopPanicSiren();
    return () => stopPanicSiren();
  }, [hasActive]);

  const acknowledge = async (id: string) => {
    setBusy(id);
    stopPanicSiren();
    await db.from('panic_alerts').update({
      status: 'acknowledged', acknowledged_by: user?.id, acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', id);
    setBusy(null);
    load();
  };

  const resolve = async (a: PanicAlert) => {
    setBusy(a.id);
    const note = (notes[a.id] || '').trim();
    const { error } = await db.from('panic_alerts').update({
      status: 'resolved', resolved_by: user?.id, resolved_at: new Date().toISOString(),
      resolution_notes: note || null, updated_at: new Date().toISOString(),
    }).eq('id', a.id);
    if (!error) {
      await supabase.from('incidents').insert({
        title: `ALERTA DE COAÇÃO - APT ${a.apartment || '?'}`,
        description: `Morador: ${a.resident_name || '-'} | Local: ${locationLabel[a.location_context] || '-'} | Disparo: ${new Date(a.created_at).toLocaleString('pt-BR')}${note ? ` | Atendimento: ${note}` : ''}`,
        severity: 'critical',
        status: 'resolved',
        reported_by: user?.id,
        resolved_by: user?.id,
        resolved_at: new Date().toISOString(),
      } as any);
      toast.success('Alerta finalizado e registrado no livro de ocorrências');
    } else {
      toast.error('Não foi possível finalizar o alerta');
    }
    setBusy(null);
    load();
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-destructive/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-xl space-y-4 mt-8">
        {alerts.map(a => (
          <div key={a.id} className={`rounded-2xl border-4 border-destructive bg-card shadow-2xl p-5 space-y-4 ${a.status === 'active' ? 'animate-pulse' : ''}`}>
            <div className="flex items-center gap-3 text-destructive">
              <ShieldAlert className="h-10 w-10" />
              <div>
                <p className="text-2xl font-black tracking-tight">ALERTA DE COAÇÃO</p>
                <p className="text-sm font-semibold">
                  {a.status === 'active' ? 'Aguardando atendimento' : `Em atendimento desde ${new Date(a.acknowledged_at!).toLocaleTimeString('pt-BR')}`}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-muted-foreground">Apartamento</p><p className="text-xl font-bold">{a.apartment || '-'}</p></div>
              <div><p className="text-muted-foreground">Morador</p><p className="font-bold">{a.resident_name || '-'}</p></div>
              <div><p className="text-muted-foreground">Local indicado</p><p className="font-semibold">{locationLabel[a.location_context]}</p></div>
              <div><p className="text-muted-foreground">Disparo</p><p className="font-semibold">{new Date(a.created_at).toLocaleTimeString('pt-BR')}</p></div>
              <div className="col-span-2"><p className="text-muted-foreground">Telefone</p><p className="font-semibold">{a.resident_phone || 'Não cadastrado'}</p></div>
            </div>
            <p className="text-xs text-muted-foreground">Não ligue para o morador sem protocolo: ele pode estar sob coação. Siga o procedimento de segurança do condomínio.</p>

            {a.status === 'active' ? (
              <Button className="w-full h-14 text-lg font-bold" variant="destructive" disabled={busy === a.id} onClick={() => acknowledge(a.id)}>
                <Siren className="h-5 w-5 mr-2" /> CIENTE / ATENDER
              </Button>
            ) : (
              <div className="space-y-3">
                <Textarea
                  placeholder="Descreva o atendimento realizado..."
                  value={notes[a.id] || ''}
                  onChange={e => setNotes(prev => ({ ...prev, [a.id]: e.target.value }))}
                  autoComplete="off"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Button asChild variant="destructive" className="h-12 font-bold">
                    <a href="tel:190"><Phone className="h-4 w-4 mr-2" /> Ligar 190</a>
                  </Button>
                  <Button className="h-12 font-bold" disabled={busy === a.id} onClick={() => resolve(a)}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Finalizar e registrar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
