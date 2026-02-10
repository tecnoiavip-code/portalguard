import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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

  if (loading) return <div className="flex justify-center p-8"><Clock className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Visitas Registradas</h2>
      {entries.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhuma visita registrada</CardContent></Card>
      ) : (
        entries.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Users className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{e.visitor_name}</p>
                  <Badge variant={e.exit_time ? 'secondary' : 'default'}>
                    {e.exit_time ? 'Saiu' : 'No local'}
                  </Badge>
                </div>
                {e.company && <p className="text-sm text-muted-foreground">{e.company}</p>}
                {e.purpose && <p className="text-sm text-muted-foreground">{e.purpose}</p>}
                {e.entry_time && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Entrada: {format(new Date(e.entry_time), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export default ResidentVisitors;
