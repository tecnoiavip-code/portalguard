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
import { Package, CheckCircle, Search, Pencil, Trash2 } from 'lucide-react';
import { storage } from '@/lib/storage';
import { Mail, Resident } from '@/types';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";

export const MailManagement = () => {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [mails, setMails] = useState<Mail[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
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
  const [editingMail, setEditingMail] = useState<Mail | null>(null);
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

    if (editingMail) {
      const updatedMails = mails.map((m) =>
        m.id === editingMail.id
          ? {
              ...m,
              residentId: formData.residentId,
              sender: formData.sender || 'Não identificado',
              packageType: formData.packageType,
              notes: formData.notes,
            }
          : m
      );
      storage.saveMails(updatedMails);
      setMails(updatedMails);
      toast.success('Correspondência atualizada!');
      setEditingMail(null);
    } else {
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

      toast.success(
        `Correspondência registrada! ${resident.name} seria notificado.`,
        { description: `${mail.packageType} de ${mail.sender}` }
      );
    }

    setFormData({
      residentId: '',
      sender: '',
      packageType: 'Carta',
      notes: '',
    });
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
  const filteredPendingMails = pendingMails.filter((mail) => {
    const resident = residents.find((r) => r.id === mail.residentId);
    return (
      resident?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      resident?.apartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mail.sender.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });
  const totalPages = Math.ceil(filteredPendingMails.length / itemsPerPage);
  const paginatedMails = filteredPendingMails.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleEdit = (mail: Mail) => {
    setEditingMail(mail);
    setFormData({
      residentId: mail.residentId,
      sender: mail.sender,
      packageType: mail.packageType,
      notes: mail.notes,
    });
  };

  const handleDelete = (mailId: string) => {
    if (!confirm('Tem certeza que deseja excluir esta correspondência?')) return;
    const updatedMails = mails.filter((m) => m.id !== mailId);
    storage.saveMails(updatedMails);
    setMails(updatedMails);
    toast.success('Correspondência excluída!');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-2">Correspondências</h2>
        <p className="text-muted-foreground">Registre e gerencie as correspondências dos moradores</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-primary" />
              <span>{editingMail ? 'Editar Correspondência' : 'Registrar Nova'}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

              <Button type="submit" className="w-full">
                <Package className="h-4 w-4 mr-2" />
                {editingMail ? 'Atualizar' : 'Registrar e Notificar'}
              </Button>
              {editingMail && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingMail(null);
                    setFormData({
                      residentId: '',
                      sender: '',
                      packageType: 'Carta',
                      notes: '',
                    });
                  }}
                  className="w-full"
                >
                  Cancelar Edição
                </Button>
              )}
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
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar correspondência..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Morador</TableHead>
                    <TableHead>Remetente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Recebido</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedMails.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        {searchTerm ? 'Nenhuma correspondência encontrada' : 'Nenhuma pendência'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedMails.map((mail) => {
                      const resident = residents.find((r) => r.id === mail.residentId);
                      return (
                        <TableRow key={mail.id}>
                          <TableCell className="font-medium">
                            <div>
                              <p>{resident?.name || 'Morador Removido'}</p>
                              <p className="text-xs text-muted-foreground">{resident?.apartment}</p>
                            </div>
                          </TableCell>
                          <TableCell>{mail.sender}</TableCell>
                          <TableCell>{mail.packageType}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(mail.receivedAt).toLocaleDateString('pt-BR')}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleEdit(mail)}
                                className="h-8 w-8"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDeliverClick(mail.id)}
                                className="h-8 w-8 text-success"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDelete(mail.id)}
                                className="h-8 w-8 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="mt-4">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>

                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={() => setCurrentPage(page)}
                          isActive={currentPage === page}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    ))}

                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
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
