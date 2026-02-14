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
import { Package, CheckCircle, Search, Pencil, Trash2, Download, Camera, X } from 'lucide-react';
import { Mail, Resident } from '@/types';
import { useMails } from '@/hooks/useMails';
import { useResidents } from '@/hooks/useResidents';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const MailManagement = () => {
  const { mails, saveMail, deleteMail } = useMails();
  const { residents } = useResidents();
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [formData, setFormData] = useState({
    residentId: '',
    sender: '',
    packageType: 'Carta' as Mail['packageType'],
    notes: '',
    trackingCode: '',
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deliveryDialog, setDeliveryDialog] = useState<{
    open: boolean;
    mailId: string | null;
  }>({ open: false, mailId: null });
  const [editingMail, setEditingMail] = useState<Mail | null>(null);
  const [withdrawnBy, setWithdrawnBy] = useState('');

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const uploadPhoto = async (): Promise<string | null> => {
    if (!photoFile) return null;
    const ext = photoFile.name.split('.').pop();
    const path = `${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('mail-photos').upload(path, photoFile);
    if (error) { console.error('Upload error:', error); return null; }
    const { data } = supabase.storage.from('mail-photos').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const resident = residents.find((r) => r.id === formData.residentId);
    if (!resident) {
      toast.error('Selecione um morador válido');
      return;
    }

    setUploading(true);
    let photoUrl: string | undefined;
    if (photoFile) {
      const url = await uploadPhoto();
      if (url) photoUrl = url;
    }

    const mailData: Mail = editingMail 
      ? {
          ...editingMail,
          residentId: formData.residentId,
          sender: formData.sender || 'Não identificado',
          packageType: formData.packageType,
          notes: formData.notes,
          trackingCode: formData.trackingCode || undefined,
          photoUrl: photoUrl || editingMail.photoUrl,
        }
      : {
          id: `mail_${Date.now()}`,
          residentId: formData.residentId,
          sender: formData.sender || 'Não identificado',
          packageType: formData.packageType,
          notes: formData.notes,
          trackingCode: formData.trackingCode || undefined,
          photoUrl: photoUrl,
          receivedAt: new Date().toISOString(),
          status: 'pending',
          deliveredAt: null,
          withdrawnBy: null,
        };

    const success = await saveMail(mailData);
    if (success) {
      // Notificar morador no app (in-app notification)
      if (!editingMail && resident) {
        try {
          // Get resident auth_user_id for notification
          const { data: resData } = await (supabase
            .from('residents')
            .select('auth_user_id') as any)
            .eq('id', resident.id)
            .maybeSingle();

          if (resData?.auth_user_id) {
            await supabase.from('notifications').insert({
              user_id: resData.auth_user_id,
              title: '📦 Nova correspondência!',
              body: `Você recebeu ${mailData.packageType.toLowerCase()} de ${mailData.sender}${mailData.trackingCode ? ` (Rastreio: ${mailData.trackingCode})` : ''}`,
              type: 'mail',
            });
          }
        } catch (err) {
          console.error('Error creating notification:', err);
        }
      }

      if (!editingMail && resident.email) {
        try {
          await supabase.functions.invoke('notify-mail-received', {
            body: {
              residentId: resident.id,
              sender: mailData.sender,
              packageType: mailData.packageType,
              receivedAt: mailData.receivedAt,
              trackingCode: mailData.trackingCode,
            }
          });
          toast.success(`Correspondência registrada! ${resident.name} foi notificado.`);
        } catch (error) {
          console.error('Error sending notification:', error);
          toast.success(`Correspondência registrada! (Notificação por email falhou)`);
        }
      } else if (!editingMail) {
        toast.success(`Correspondência registrada para ${resident.name}`);
      }
      
      setFormData({
        residentId: '',
        sender: '',
        packageType: 'Carta',
        notes: '',
        trackingCode: '',
      });
      setPhotoFile(null);
      setPhotoPreview(null);
      setEditingMail(null);
    }
    setUploading(false);
  };

  const handleDeliverClick = (mailId: string) => {
    setDeliveryDialog({ open: true, mailId });
    setWithdrawnBy('');
  };

  const handleDeliver = async () => {
    if (!withdrawnBy.trim()) {
      toast.error('Por favor, informe quem retirou a correspondência');
      return;
    }

    if (!deliveryDialog.mailId) return;

    const mail = mails.find(m => m.id === deliveryDialog.mailId);
    if (!mail) return;

    const updatedMail: Mail = {
      ...mail,
      status: 'delivered',
      deliveredAt: new Date().toISOString(),
      withdrawnBy: withdrawnBy.trim(),
    };
    
    const success = await saveMail(updatedMail);
    if (success) {
      setDeliveryDialog({ open: false, mailId: null });
      setWithdrawnBy('');
    }
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
      trackingCode: mail.trackingCode || '',
    });
  };

  const handleDelete = async (mailId: string) => {
    if (!confirm('Tem certeza que deseja excluir esta correspondência?')) return;
    await deleteMail(mailId);
  };

  const exportMailsToPDF = () => {
    const doc = new jsPDF();
    doc.text('Correspondências Pendentes', 14, 15);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}`, 14, 22);

    const tableData = filteredPendingMails.map(mail => {
      const resident = residents.find(r => r.id === mail.residentId);
      return [
        resident?.name || 'Desconhecido',
        resident?.apartment || '-',
        mail.sender,
        mail.packageType,
        format(new Date(mail.receivedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR }),
        mail.notes || '-'
      ];
    });

    autoTable(doc, {
      head: [['Morador', 'Apartamento', 'Remetente', 'Tipo', 'Recebida em', 'Observações']],
      body: tableData,
      startY: 28,
    });

    doc.save(`correspondencias-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
    toast.success('PDF gerado com sucesso');
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
                <Label htmlFor="trackingCode">Código de Rastreio</Label>
                <Input
                  id="trackingCode"
                  value={formData.trackingCode}
                  onChange={(e) => setFormData({ ...formData, trackingCode: e.target.value })}
                  placeholder="Ex: BR123456789XX"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Observações</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Ex: Caixa avariada, frágil..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Foto (opcional)</Label>
                {photoPreview ? (
                  <div className="relative w-20 h-20">
                    <img src={photoPreview} alt="Preview" className="w-20 h-20 object-cover rounded-lg border" />
                    <button
                      type="button"
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer border border-dashed rounded-lg p-3 hover:bg-muted transition-colors">
                    <Camera className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Tirar foto / Anexar</span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoChange} />
                  </label>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={uploading}>
                <Package className="h-4 w-4 mr-2" />
                {uploading ? 'Enviando...' : editingMail ? 'Atualizar' : 'Registrar e Notificar'}
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
                      trackingCode: '',
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
              <div className="flex items-center gap-2">
                <span className="text-warning">Pendentes de Retirada</span>
                <span className="text-sm font-normal">{pendingMails.length}</span>
              </div>
              <Button variant="outline" size="sm" onClick={exportMailsToPDF}>
                <Download className="h-4 w-4 mr-2" />
                Exportar PDF
              </Button>
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
