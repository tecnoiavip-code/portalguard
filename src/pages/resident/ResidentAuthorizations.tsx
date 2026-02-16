import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Shield, Plus, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Authorization {
  id: string;
  visitor_name: string;
  visitor_document: string | null;
  authorized_date: string;
  authorized_until: string | null;
  purpose: string | null;
  vehicle_plate: string | null;
  status: string | null;
  staff_notes: string | null;
}

const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  expired: 'Expirada',
};

const statusVariant = (s: string | null): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (s === 'approved') return 'default';
  if (s === 'rejected') return 'destructive';
  if (s === 'expired') return 'secondary';
  return 'outline';
};

const ResidentAuthorizations = () => {
  const { user } = useAuth();
  const [auths, setAuths] = useState<Authorization[]>([]);
  const [residentId, setResidentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ visitor_name: '', visitor_document: '', authorized_date: '', authorized_until: '', purpose: '', vehicle_plate: '' });

  const loadAuths = async (rid: string) => {
    const { data } = await supabase
      .from('visitor_authorizations')
      .select('*')
      .eq('resident_id', rid)
      .order('created_at', { ascending: false });
    setAuths((data as any) || []);
  };

  useEffect(() => {
    if (!user) return;
    const init = async () => {
      const { data: res } = await (supabase
        .from('residents')
        .select('id') as any)
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (!res) { setLoading(false); return; }
      setResidentId(res.id);
      await loadAuths(res.id);
      setLoading(false);
    };
    init();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!residentId) return;

    // Check for duplicate pending authorization
    const { data: existing } = await supabase
      .from('visitor_authorizations')
      .select('id')
      .eq('resident_id', residentId)
      .ilike('visitor_name', form.visitor_name.trim())
      .eq('authorized_date', form.authorized_date)
      .in('status', ['pending', 'approved'] as any)
      .limit(1);
    
    if (existing && existing.length > 0) {
      toast.error(`Já existe uma autorização ativa para ${form.visitor_name} nesta data.`);
      return;
    }

    const { error } = await supabase.from('visitor_authorizations').insert({
      resident_id: residentId,
      visitor_name: form.visitor_name,
      visitor_document: form.visitor_document || null,
      authorized_date: form.authorized_date,
      authorized_until: form.authorized_until || null,
      purpose: form.purpose || null,
      vehicle_plate: form.vehicle_plate || null,
    } as any);
    if (error) {
      toast.error('Erro ao enviar autorização');
      return;
    }
    toast.success('Autorização enviada à portaria!');
    setOpen(false);
    setForm({ visitor_name: '', visitor_document: '', authorized_date: '', authorized_until: '', purpose: '', vehicle_plate: '' });
    await loadAuths(residentId);

    // Notify staff
    // Get all staff user IDs
    const { data: staffRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .in('role', ['admin', 'receptionist', 'security_guard'] as any);
    if (staffRoles) {
      const notifications = staffRoles.map((r: any) => ({
        user_id: r.user_id,
        title: 'Nova autorização de visitante',
        body: `Morador autorizou a entrada de ${form.visitor_name}`,
        type: 'authorization',
      }));
      await supabase.from('notifications').insert(notifications);
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Clock className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Autorizações</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />Nova</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Autorizar Visitante</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome do visitante *</Label>
                <Input value={form.visitor_name} onChange={(e) => setForm({ ...form, visitor_name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Documento</Label>
                <Input value={form.visitor_document} onChange={(e) => setForm({ ...form, visitor_document: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Data autorizada *</Label>
                  <Input type="date" value={form.authorized_date} onChange={(e) => setForm({ ...form, authorized_date: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Válido até</Label>
                  <Input type="date" value={form.authorized_until} onChange={(e) => setForm({ ...form, authorized_until: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Textarea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Placa do veículo</Label>
                <Input value={form.vehicle_plate} onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value })} />
              </div>
              <Button type="submit" className="w-full">Enviar à Portaria</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {auths.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhuma autorização registrada</CardContent></Card>
      ) : (
        auths.map((a) => (
          <Card key={a.id}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Shield className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{a.visitor_name}</p>
                  <Badge variant={statusVariant(a.status)}>{statusLabels[a.status || 'pending']}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(a.authorized_date), 'dd/MM/yyyy', { locale: ptBR })}
                  {a.authorized_until && ` até ${format(new Date(a.authorized_until), 'dd/MM/yyyy', { locale: ptBR })}`}
                </p>
                {a.purpose && <p className="text-xs text-muted-foreground mt-1">{a.purpose}</p>}
                {a.staff_notes && <p className="text-xs text-warning mt-1">Portaria: {a.staff_notes}</p>}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export default ResidentAuthorizations;
