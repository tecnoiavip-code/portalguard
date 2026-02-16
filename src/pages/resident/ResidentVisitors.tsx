import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Users, Clock, MapPin, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface VisitorEntry {
  id: string;
  visitor_name: string;
  visitor_type: string | null;
  purpose: string | null;
  entry_time: string | null;
  exit_time: string | null;
  company: string | null;
}

const ResidentVisitors = () => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<VisitorEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: res } = await (supabase
        .from('residents')
        .select('apartment') as any)
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (!res) { setLoading(false); return; }

      const { data } = await supabase
        .from('access_entries')
        .select('id, visitor_name, visitor_type, purpose, entry_time, exit_time, company')
        .eq('apartment', res.apartment)
        .order('entry_time', { ascending: false })
        .limit(50);
      setEntries(data || []);
      setLoading(false);
    };
    load();
  }, [user]);

  if (loading) return (
    <div className="flex justify-center py-12">
      <Clock className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  const activeVisitors = entries.filter(e => !e.exit_time);
  const pastVisitors = entries.filter(e => e.exit_time);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div>
        <h2 className="text-xl font-bold text-foreground">Visitas</h2>
        <p className="text-sm text-muted-foreground">Registro de visitantes do seu apartamento</p>
      </div>

      {entries.length === 0 ? (
        <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-8 text-center">
          <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">Nenhuma visita registrada</p>
        </div>
      ) : (
        <>
          {activeVisitors.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-semibold text-foreground">No local agora</span>
              </div>
              {activeVisitors.map((e) => (
                <VisitorCard key={e.id} entry={e} active />
              ))}
            </div>
          )}

          {pastVisitors.length > 0 && (
            <div className="space-y-3">
              {activeVisitors.length > 0 && (
                <span className="text-sm font-semibold text-muted-foreground">Anteriores</span>
              )}
              {pastVisitors.map((e) => (
                <VisitorCard key={e.id} entry={e} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const VisitorCard = ({ entry: e, active }: { entry: VisitorEntry; active?: boolean }) => (
  <div className={cn(
    "bg-card/80 backdrop-blur-sm border rounded-2xl p-4 transition-all",
    active ? "border-emerald-500/30 shadow-[0_0_15px_-5px] shadow-emerald-500/20" : "border-border/50"
  )}>
    <div className="flex items-start gap-3">
      <div className={cn(
        "p-2.5 rounded-xl flex-shrink-0",
        active ? "bg-emerald-500/10" : "bg-muted/80"
      )}>
        <Users className={cn("h-5 w-5", active ? "text-emerald-500" : "text-muted-foreground")} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-foreground truncate">{e.visitor_name}</p>
          <Badge
            variant={active ? 'default' : 'secondary'}
            className={cn(
              "text-xs shrink-0",
              active && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15"
            )}
          >
            {active ? 'No local' : 'Saiu'}
          </Badge>
        </div>
        {e.company && (
          <p className="text-sm text-muted-foreground mt-0.5">{e.company}</p>
        )}
        {e.purpose && (
          <p className="text-sm text-muted-foreground">{e.purpose}</p>
        )}
        {e.entry_time && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
            <ArrowRight className="h-3 w-3" />
            <span>Entrada: {format(new Date(e.entry_time), "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
            {e.exit_time && (
              <>
                <span className="mx-1">•</span>
                <span>Saída: {format(new Date(e.exit_time), "HH:mm", { locale: ptBR })}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
);

export default ResidentVisitors;
