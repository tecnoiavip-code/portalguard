import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { sendPushToUser } from '@/lib/push-subscription';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Shield, Check, X, Clock, Users, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
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

interface GuestListGroup {
  key: string;
  title: string;
  authorized_date: string;
  resident?: ResidentInfo;
  resident_id: string;
  vehicle_plate: string | null;
  items: (Authorization & { resident?: ResidentInfo })[];
}

const StaffAuthorizations = () => {
  const { user } = useAuth();
  const [auths, setAuths] = useState<(Authorization & { resident?: ResidentInfo })[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [staffNotes, setStaffNotes] = useState('');
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const loadAuths = async () => {
    const { data } = await supabase
      .from('visitor_authorizations')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (!data) { setLoading(false); return; }

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

  // Set up realtime subscription to auto-refresh when authorizations change
  useEffect(() => {
    const channel = supabase
      .channel('staff-auth-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visitor_authorizations' }, () => {
        loadAuths();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    const auth = auths.find(a => a.id === id);
    await supabase
      .from('visitor_authorizations')
      .update({ status, staff_notes: staffNotes || null, reviewed_by: user?.id } as any)
      .eq('id', id);

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

  const handleBulkReview = async (items: (Authorization & { resident?: ResidentInfo })[], status: 'approved' | 'rejected') => {
    const pendingItems = items.filter(a => a.status === 'pending');
    if (pendingItems.length === 0) return;

    for (const item of pendingItems) {
      await supabase
        .from('visitor_authorizations')
        .update({ status, staff_notes: staffNotes || null, reviewed_by: user?.id } as any)
        .eq('id', item.id);
    }

    // Notify resident
    const first = pendingItems[0];
    const { data: res } = await (supabase.from('residents').select('auth_user_id') as any)
      .eq('id', first.resident_id)
      .maybeSingle();
    if (res?.auth_user_id) {
      const title = status === 'approved' ? '✅ Lista de convidados aprovada' : '❌ Lista de convidados rejeitada';
      const body = `${pendingItems.length} convidado(s)${staffNotes ? ` — ${staffNotes}` : ''}`;
      await supabase.from('notifications').insert({
        user_id: res.auth_user_id,
        title,
        body,
        type: 'authorization',
      });
      sendPushToUser(res.auth_user_id, title, body, 'authorization');
    }

    toast.success(status === 'approved' ? 'Lista aprovada!' : 'Lista rejeitada');
    setStaffNotes('');
    loadAuths();
  };

  const toggleList = (key: string) => {
    setExpandedLists(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (loading) return <div className="flex justify-center p-8"><Clock className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  // Separate guest lists (multiple entries with same purpose+date+resident) from individual auths
  const grouped = new Map<string, (Authorization & { resident?: ResidentInfo })[]>();
  const singles: (Authorization & { resident?: ResidentInfo })[] = [];

  // Group by purpose+date+resident_id where purpose exists
  auths.forEach(a => {
    if (a.purpose) {
      const key = `${a.resident_id}|${a.authorized_date}|${a.purpose}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(a);
    } else {
      singles.push(a);
    }
  });

  // Separate actual guest lists (2+ items) from singles that happen to have purpose
  const guestLists: GuestListGroup[] = [];
  grouped.forEach((items, key) => {
    if (items.length >= 2) {
      guestLists.push({
        key,
        title: items[0].purpose!,
        authorized_date: items[0].authorized_date,
        resident: items[0].resident,
        resident_id: items[0].resident_id,
        vehicle_plate: items[0].vehicle_plate,
        items,
      });
    } else {
      singles.push(...items);
    }
  });

  // Sort singles by created_at desc
  singles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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

      {/* Guest Lists */}
      {guestLists.map((list) => {
        const isExpanded = expandedLists.has(list.key);
        const approvedCount = list.items.filter(i => i.status === 'approved').length;
        const pendingCount = list.items.filter(i => i.status === 'pending').length;
        const totalCount = list.items.length;

        return (
          <Card key={list.key} className="overflow-hidden">
            <CardContent className="p-0">
              <div
                className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => toggleList(list.key)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{list.title}</p>
                      <p className="text-sm text-muted-foreground">
                        Morador: {list.resident?.name} - Apto {list.resident?.apartment}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Data: {format(new Date(list.authorized_date), 'dd/MM/yyyy', { locale: ptBR })}
                      </p>
                      <div className="flex gap-2 mt-1.5">
                        <Badge variant="outline" className="text-xs">
                          {totalCount} convidado(s)
                        </Badge>
                        {approvedCount > 0 && (
                          <Badge variant="default" className="text-xs">
                            {approvedCount} validado(s)
                          </Badge>
                        )}
                        {pendingCount > 0 && (
                          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                            {pendingCount} pendente(s)
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {pendingCount > 0 && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="default" onClick={(e) => { e.stopPropagation(); handleBulkReview(list.items, 'approved'); }}>
                          <Check className="h-4 w-4 mr-1" /> Aprovar Todos
                        </Button>
                        <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); handleBulkReview(list.items, 'rejected'); }}>
                          <X className="h-4 w-4 mr-1" /> Rejeitar
                        </Button>
                      </div>
                    )}
                    {isExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t divide-y">
                  {list.items.map((a) => (
                    <div key={a.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${a.status === 'approved' ? 'bg-emerald-500' : a.status === 'rejected' ? 'bg-destructive' : 'bg-amber-500'}`} />
                        <div>
                          <p className="text-sm font-medium">{a.visitor_name}</p>
                          {a.visitor_document && <p className="text-xs text-muted-foreground">Doc: {a.visitor_document}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant(a.status)} className="text-xs">
                          {statusLabels[a.status || 'pending']}
                        </Badge>
                        {a.status === 'pending' && (
                          <Dialog open={reviewId === a.id} onOpenChange={(o) => { if (!o) setReviewId(null); }}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setReviewId(a.id); }}>Revisar</Button>
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
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Individual Authorizations */}
      {singles.length === 0 && guestLists.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhuma autorização pendente</CardContent></Card>
      ) : (
        singles.map((a) => (
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
