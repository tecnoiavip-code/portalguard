import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { Package, CheckCircle } from 'lucide-react';
import { storage } from '@/lib/storage';
import { Mail, Resident } from '@/types';
import { toast } from 'sonner';

export const MailManagement = () => {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [mails, setMails] = useState<Mail[]>([]);
  const [formData, setFormData] = useState({
    residentId: '',
    sender: '',
    packageType: 'Carta' as Mail['packageType'],
    notes: '',
  });
  const [deliveryDialog, setDeliveryDialog] = useState<{
    open: boolean;
    mailId: string | null;
  }>({ open: false, mailId: null });
  const [withdrawnBy, setWithdrawnBy] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setResidents(storage.getResidents());
    setMails(storage.getMails());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const resident = residents.find((r) => r.id === formData.residentId);
    if (!resident) {
      toast.error('Selecione um morador válido');
      return;
    }

    const mail: Mail = {
      id: `mail_${Date.now()}`,
      residentId: formData.residentId,
      sender: formData.sender || 'Não identificado',
      packageType: formData.packageType,
      notes: formData.notes,
      receivedAt: new Date().toISOString(),
      status: 'pending',
      deliveredAt: null,
      withdrawnBy: null,
    };

    const updatedMails = [...mails, mail];
    storage.saveMails(updatedMails);
    setMails(updatedMails);

    setFormData({
      residentId: '',
      sender: '',
      packageType: 'Carta',
      notes: '',
    });

    toast.success(
      `Correspondência registrada! ${resident.name} seria notificado.`,
      { description: `${mail.packageType} de ${mail.sender}` }
    );
  };

  const handleDeliverClick = (mailId: string) => {
    setDeliveryDialog({ open: true, mailId });
    setWithdrawnBy('');
  };

  const handleDeliver = () => {
    if (!withdrawnBy.trim()) {
      toast.error('Por favor, informe quem retirou a correspondência');
      return;
    }

    if (!deliveryDialog.mailId) return;

    const updatedMails = mails.map((mail) =>
      mail.id === deliveryDialog.mailId
        ? {
            ...mail,
            status: 'delivered' as const,
            deliveredAt: new Date().toISOString(),
            withdrawnBy: withdrawnBy.trim(),
          }
        : mail
    );
    storage.saveMails(updatedMails);
    setMails(updatedMails);
    setDeliveryDialog({ open: false, mailId: null });
    setWithdrawnBy('');
    toast.success('Correspondência marcada como entregue!');
  };

  const pendingMails = mails.filter((m) => m.status === 'pending');
  const today = new Date().toDateString();
  const deliveredToday = mails.filter(
    (m) => m.status === 'delivered' && new Date(m.deliveredAt!).toDateString() === today
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-2">Correspondências</h2>
        <p className="text-muted-foreground">Registre e gerencie as correspondências dos moradores</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-primary" />
              <span>Registrar Nova</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="residentId">Morador *</Label>
                <Combobox
                  options={residents.map((resident) => ({
                    value: resident.id,
                    label: `${resident.name} - ${resident.apartment}`,
                  }))}
                  value={formData.residentId}
                  onValueChange={(value) => setFormData({ ...formData, residentId: value })}
                  placeholder="Selecione o morador"
                  searchPlaceholder="Buscar morador..."
                  emptyText="Nenhum morador encontrado."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sender">Remetente</Label>
                <Input
                  id="sender"
                  value={formData.sender}
                  onChange={(e) => setFormData({ ...formData, sender: e.target.value })}
                  placeholder="Ex: Amazon, Correios"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="packageType">Tipo de Pacote *</Label>
                <Select value={formData.packageType} onValueChange={(value: Mail['packageType']) => setFormData({ ...formData, packageType: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Carta">✉️ Carta</SelectItem>
                    <SelectItem value="Pacote Pequeno">🛍️ Pacote Pequeno</SelectItem>
                    <SelectItem value="Pacote Médio">📦 Pacote Médio</SelectItem>
                    <SelectItem value="Pacote Grande">🗳️ Pacote Grande</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Observações</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Ex: Caixa avariada, frágil..."
                  rows={3}
                />
              </div>

              <Button type="submit" className="w-full bg-success hover:bg-success/90">
                <Package className="h-4 w-4 mr-2" />
                Registrar e Notificar
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="text-warning">Pendentes de Retirada</span>
              <span className="text-sm font-normal">{pendingMails.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {pendingMails.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhuma pendência
                </p>
              ) : (
                pendingMails.map((mail) => {
                  const resident = residents.find((r) => r.id === mail.residentId);
                  return (
                    <div
                      key={mail.id}
                      className="p-3 bg-warning/10 rounded-lg border-l-4 border-warning"
                    >
                      <p className="font-semibold text-sm mb-1">
                        {resident?.name || 'Morador Removido'}
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        <span className="font-medium">De:</span> {mail.sender} ({mail.packageType})
                      </p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Recebido: {new Date(mail.receivedAt).toLocaleString('pt-BR')}
                      </p>
                      {mail.notes && (
                        <p className="text-xs text-muted-foreground mb-3 italic">
                          {mail.notes}
                        </p>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleDeliverClick(mail.id)}
                        className="w-full bg-warning hover:bg-warning/90"
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1" />
                        Marcar como Entregue
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="text-success">Entregues Hoje</span>
              <span className="text-sm font-normal">{deliveredToday.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {deliveredToday.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhuma entrega hoje
                </p>
              ) : (
                deliveredToday.map((mail) => {
                  const resident = residents.find((r) => r.id === mail.residentId);
                  return (
                    <div
                      key={mail.id}
                      className="p-3 bg-success/10 rounded-lg border-l-4 border-success"
                    >
                      <p className="font-semibold text-sm mb-1">
                        {resident?.name || 'Morador Removido'}
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        <span className="font-medium">De:</span> {mail.sender} ({mail.packageType})
                      </p>
                      <p className="text-xs text-muted-foreground mb-1">
                        Entregue: {new Date(mail.deliveredAt!).toLocaleTimeString('pt-BR')}
                      </p>
                      {mail.withdrawnBy && (
                        <p className="text-xs text-muted-foreground font-medium">
                          Retirado por: {mail.withdrawnBy}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={deliveryDialog.open} onOpenChange={(open) => setDeliveryDialog({ open, mailId: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Entrega</DialogTitle>
            <DialogDescription>
              Por favor, informe quem retirou a correspondência.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="withdrawnBy">Retirado por *</Label>
              <Input
                id="withdrawnBy"
                value={withdrawnBy}
                onChange={(e) => setWithdrawnBy(e.target.value)}
                placeholder="Nome de quem retirou"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeliveryDialog({ open: false, mailId: null })}
            >
              Cancelar
            </Button>
            <Button onClick={handleDeliver} className="bg-success hover:bg-success/90">
              Confirmar Entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
