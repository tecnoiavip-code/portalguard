import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mail, Package, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface MailItem {
  id: string;
  sender: string;
  package_type: string | null;
  status: string | null;
  received_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  tracking_code: string | null;
  photo_url: string | null;
}

const ResidentMails = () => {
  const { user } = useAuth();
  const [mails, setMails] = useState<MailItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: res } = await (supabase
        .from('residents')
        .select('id') as any)
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (!res) { setLoading(false); return; }

      const { data } = await supabase
        .from('mails')
        .select('id, sender, package_type, status, received_at, delivered_at, notes, tracking_code, photo_url')
        .eq('resident_id', res.id)
        .order('received_at', { ascending: false })
        .limit(50);
      setMails(data || []);
      setLoading(false);
    };
    load();
  }, [user]);

  if (loading) return <div className="flex justify-center p-8"><Clock className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Correspondências</h2>
      {mails.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhuma correspondência registrada</CardContent></Card>
      ) : (
        mails.map((m) => (
          <Card key={m.id}>
            <CardContent className="p-4 flex items-start gap-3">
              {m.photo_url ? (
                <img src={m.photo_url} alt="Foto" className="w-14 h-14 rounded-lg object-cover border flex-shrink-0" />
              ) : (
                <div className="p-2 rounded-lg bg-muted flex-shrink-0">
                  {m.package_type?.includes('Pacote') ? <Package className="h-5 w-5 text-accent" /> : <Mail className="h-5 w-5 text-accent" />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{m.sender}</p>
                  <Badge variant={m.status === 'pending' ? 'destructive' : 'default'}>
                    {m.status === 'pending' ? 'Pendente' : 'Entregue'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{m.package_type || 'Carta'}</p>
                {m.tracking_code && (
                  <p className="text-xs font-mono bg-muted px-2 py-0.5 rounded mt-1 inline-block">
                    🔍 {m.tracking_code}
                  </p>
                )}
                {m.received_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Recebido: {format(new Date(m.received_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                )}
                {m.notes && <p className="text-xs text-muted-foreground mt-1">{m.notes}</p>}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export default ResidentMails;
