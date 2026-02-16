import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { sendPushToUser } from '@/lib/push-subscription';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Shield, Check, X, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Authorization {
  id: string;
  resident_id: string;
  visitor_name: string;
  visitor_document: string | null;
  authorized_date: string;
  authorized_until: string | null;
  purpose: string | null;
  vehicle_plate: string | null;
  status: string | null;
  staff_notes: string | null;
  created_at: string;
}

interface ResidentInfo {
  name: string;
  apartment: string;
}

const StaffAuthorizations = () => {
  const { user } = useAuth();
  const [auths, setAuths] = useState<(Authorization & { resident?: ResidentInfo })[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [staffNotes, setStaffNotes] = useState('');

  const loadAuths = async () => {
    const { data } = await supabase
      .from('visitor_authorizations')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (!data) { setLoading(false); return; }

    // Enrich with resident info
    const enriched = await Promise.all(
      (data as any[]).map(async (a: Authorization) => {
        const { data: res } = await supabase
          .from('residents')
          .select('name, apartment')
          .eq('id', a.resident_id)
          .maybeSingle();
        return { ...a, resident: res || undefined };
      })
    );

    setAuths(enriched);
    setLoading(false);
  };

  useEffect(() => { loadAuths(); }, []);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    const auth = auths.find(a => a.id === id);
    await supabase
      .from('visitor_authorizations')
      .update({ status, staff_notes: staffNotes || null, reviewed_by: user?.id } as any)
      .eq('id', id);

    // Notify resident about authorization review
    if (auth) {
      const { data: res } = await (supabase.from('residents').select('auth_user_id') as any)
        .eq('id', auth.resident_id)
        .maybeSingle();
      if (res?.auth_user_id) {
        const title = status === 'approved' ? '✅ Autorização aprovada' : '❌ Autorização rejeitada';
        const body = `Visitante: ${auth.visitor_name}${staffNotes ? ` — ${staffNotes}` : ''}`;
        await supabase.from('notifications').insert({
          user_id: res.auth_user_id,
          title,
          body,
          type: 'authorization',
          related_id: id,
        });
        sendPushToUser(res.auth_user_id, title, body, 'authorization');
      }
    }

    toast.success(status === 'approved' ? 'Autorização aprovada!' : 'Autorização rejeitada');
    setReviewId(null);
    setStaffNotes('');
    loadAuths();
  };

  if (loading) return <div className="flex justify-center p-8"><Clock className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const statusLabels: Record<string, string> = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Rejeitada', expired: 'Expirada' };
  const statusVariant = (s: string | null): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (s === 'approved') return 'default';
    if (s === 'rejected') return 'destructive';
    if (s === 'expired') return 'secondary';
    return 'outline';
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Autorizações de Visitantes</h2>
      {auths.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhuma autorização pendente</CardContent></Card>
      ) : (
        auths.map((a) => (
          <Card key={a.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Shield className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <p className="font-medium">{a.visitor_name}</p>
                    <p className="text-sm text-muted-foreground">
                      Morador: {a.resident?.name} - Apto {a.resident?.apartment}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Data: {format(new Date(a.authorized_date), 'dd/MM/yyyy', { locale: ptBR })}
                      {a.authorized_until && ` até ${format(new Date(a.authorized_until), 'dd/MM/yyyy', { locale: ptBR })}`}
                    </p>
                    {a.purpose && <p className="text-xs text-muted-foreground">{a.purpose}</p>}
                    {a.vehicle_plate && <p className="text-xs text-muted-foreground">Placa: {a.vehicle_plate}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(a.status)}>{statusLabels[a.status || 'pending']}</Badge>
                  {a.status === 'pending' && (
                    <Dialog open={reviewId === a.id} onOpenChange={(o) => { if (!o) setReviewId(null); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => setReviewId(a.id)}>Revisar</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Revisar Autorização</DialogTitle></DialogHeader>
                        <div className="space-y-4">
                          <p><strong>Visitante:</strong> {a.visitor_name}</p>
                          <p><strong>Morador:</strong> {a.resident?.name} - Apto {a.resident?.apartment}</p>
                          <Textarea
                            placeholder="Observações (opcional)"
                            value={staffNotes}
                            onChange={(e) => setStaffNotes(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button className="flex-1" onClick={() => handleReview(a.id, 'approved')}>
                              <Check className="h-4 w-4 mr-1" /> Aprovar
                            </Button>
                            <Button variant="destructive" className="flex-1" onClick={() => handleReview(a.id, 'rejected')}>
                              <X className="h-4 w-4 mr-1" /> Rejeitar
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export default StaffAuthorizations;
