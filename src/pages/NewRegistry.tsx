import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogIn, LogOut, Camera, Upload, X, Plus, Pencil, Trash2, Search, Download, ShieldBan, ShieldCheck, Ban } from 'lucide-react';
import { AccessEntry, Resident } from '@/types';
import { useAccessEntries } from '@/hooks/useAccessEntries';
import { useResidents } from '@/hooks/useResidents';
import { toast } from 'sonner';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface BlockedVisitor {
  id: string;
  visitor_name: string;
  visitor_document: string;
  reason: string | null;
  blocked_at: string;
  is_active: boolean;
}
export const NewRegistry = () => {
  const { residents } = useResidents();
  const { entries: allEntries, saveEntry, deleteEntry } = useAccessEntries();
  const entries = allEntries.filter(e => !e.exitTime);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [currentPageAll, setCurrentPageAll] = useState(1);
  const [visitedLocationSearch, setVisitedLocationSearch] = useState('');
  const [showResidentSuggestions, setShowResidentSuggestions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [blockedVisitors, setBlockedVisitors] = useState<BlockedVisitor[]>([]);
  const [showBlockedDialog, setShowBlockedDialog] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [blockingEntry, setBlockingEntry] = useState<AccessEntry | null>(null);
  const [showBlockReasonDialog, setShowBlockReasonDialog] = useState(false);
  const itemsPerPage = 12;
  const itemsPerPageTable = 10;
  const [formData, setFormData] = useState({
    visitorName: '',
    visitorDocument: '',
    visitorType: 'visitor' as 'visitor' | 'service_provider',
    residentId: '',
    purpose: '',
    company: '',
    vehiclePlate: '',
    vehicleModel: '',
    vehicleColor: '',
    photo: ''
  });
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [suggestions, setSuggestions] = useState<AccessEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    loadBlockedVisitors();
  }, []);

  const loadBlockedVisitors = async () => {
    const { data, error } = await supabase
      .from('blocked_visitors')
      .select('*')
      .eq('is_active', true)
      .order('blocked_at', { ascending: false });
    if (!error && data) setBlockedVisitors(data as BlockedVisitor[]);
  };

  const isVisitorBlocked = (document: string) => {
    return blockedVisitors.some(b => b.visitor_document === document && b.is_active);
  };

  const handleBlockVisitor = async (entry: AccessEntry) => {
    setBlockingEntry(entry);
    setBlockReason('');
    setShowBlockReasonDialog(true);
  };

  const confirmBlockVisitor = async () => {
    if (!blockingEntry) return;
    const { error } = await supabase.from('blocked_visitors').insert({
      visitor_name: blockingEntry.visitorName,
      visitor_document: blockingEntry.visitorDocument,
      reason: blockReason || null,
    });
    if (error) {
      toast.error('Erro ao bloquear visitante');
      return;
    }
    toast.success(`${blockingEntry.visitorName} foi bloqueado`);
    setShowBlockReasonDialog(false);
    setBlockingEntry(null);
    loadBlockedVisitors();
  };

  const handleUnblockVisitor = async (id: string) => {
    const { error } = await supabase
      .from('blocked_visitors')
      .update({ is_active: false })
      .eq('id', id);
    if (error) {
      toast.error('Erro ao desbloquear visitante');
      return;
    }
    toast.success('Visitante desbloqueado');
    loadBlockedVisitors();
  };

  const activeEntries = entries.filter(e => !e.exitTime).reverse();
  const filteredActiveEntries = activeEntries.filter(entry => entry.visitorName.toLowerCase().includes(searchTerm.toLowerCase()) || entry.apartment.toLowerCase().includes(searchTerm.toLowerCase()) || entry.visitorDocument.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalPages = Math.ceil(filteredActiveEntries.length / itemsPerPage);
  const paginatedEntries = filteredActiveEntries.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const filteredAllEntries = allEntries.filter(entry => entry.visitorName.toLowerCase().includes(searchTerm.toLowerCase()) || entry.apartment.toLowerCase().includes(searchTerm.toLowerCase()) || entry.visitorDocument.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalPagesAll = Math.ceil(filteredAllEntries.length / itemsPerPageTable);
  const paginatedAllEntries = filteredAllEntries.slice((currentPageAll - 1) * itemsPerPageTable, currentPageAll * itemsPerPageTable);
  const filteredResidents = residents.filter(r => r.name.toLowerCase().includes(visitedLocationSearch.toLowerCase()) || r.apartment.toLowerCase().includes(visitedLocationSearch.toLowerCase()));
  
  const handleVisitedLocationSelect = (residentId: string, residentName: string, apartment: string) => {
    setVisitedLocationSearch(`${residentName} - ${apartment}`);
    setFormData({
      ...formData,
      residentId
    });
    setShowResidentSuggestions(false);
  };
  
  const findSimilarEntries = (name: string, document: string) => {
    if (!name && !document) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const similar = allEntries.filter(entry => {
      const nameMatch = name && entry.visitorName.toLowerCase().includes(name.toLowerCase());
      const docMatch = document && entry.visitorDocument.includes(document);
      return nameMatch || docMatch;
    });
    if (similar.length > 0) {
      setSuggestions(similar.slice(0, 3));
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };
  
  const applySuggestion = (entry: AccessEntry) => {
    setFormData({
      ...formData,
      visitorName: entry.visitorName,
      visitorDocument: entry.visitorDocument,
      visitorType: entry.visitorType,
      company: entry.company || '',
      vehiclePlate: entry.vehiclePlate || '',
      vehicleModel: entry.vehicleModel || '',
      vehicleColor: entry.vehicleColor || '',
      photo: entry.photo || ''
    });
    setShowSuggestions(false);
    toast.success('Dados preenchidos automaticamente!');
  };
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true
      });
      setStream(mediaStream);
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch (error) {
      toast.error('Não foi possível acessar a câmera');
    }
  };
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setShowCamera(false);
  };
  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const photoData = canvasRef.current.toDataURL('image/jpeg');
        setFormData({
          ...formData,
          photo: photoData
        });
        stopCamera();
        toast.success('Foto capturada com sucesso!');
      }
    }
  };
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({
          ...formData,
          photo: reader.result as string
        });
        toast.success('Foto carregada com sucesso!');
      };
      reader.readAsDataURL(file);
    }
  };
  const handleEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isVisitorBlocked(formData.visitorDocument)) {
      toast.error('Este visitante está bloqueado e não pode entrar!');
      return;
    }
    const resident = residents.find(r => r.id === formData.residentId);
    if (!resident) {
      toast.error('Selecione um morador válido');
      return;
    }
    
    const entryData: AccessEntry = editingId
      ? {
          ...allEntries.find(e => e.id === editingId)!,
          visitorName: formData.visitorName,
          visitorDocument: formData.visitorDocument,
          visitorType: formData.visitorType,
          residentId: formData.residentId,
          residentName: resident.name,
          apartment: resident.apartment,
          purpose: formData.purpose,
          vehiclePlate: formData.vehiclePlate,
          vehicleModel: formData.vehicleModel,
          vehicleColor: formData.vehicleColor,
          photo: formData.photo,
          company: formData.company
        }
      : {
          id: `entry_${Date.now()}`,
          visitorName: formData.visitorName,
          visitorDocument: formData.visitorDocument,
          visitorType: formData.visitorType,
          residentId: formData.residentId,
          residentName: resident.name,
          apartment: resident.apartment,
          purpose: formData.purpose,
          entryTime: new Date().toISOString(),
          exitTime: null,
          vehiclePlate: formData.vehiclePlate,
          vehicleModel: formData.vehicleModel,
          vehicleColor: formData.vehicleColor,
          photo: formData.photo,
          company: formData.company,
          autoRecognized: showSuggestions && suggestions.length > 0
        };
    
    await saveEntry(entryData);
    resetForm();
  };
  const handleEdit = (entry: AccessEntry) => {
    setEditingId(entry.id);
    setFormData({
      visitorName: entry.visitorName,
      visitorDocument: entry.visitorDocument,
      visitorType: entry.visitorType,
      residentId: entry.residentId,
      purpose: entry.purpose || '',
      company: entry.company || '',
      vehiclePlate: entry.vehiclePlate || '',
      vehicleModel: entry.vehicleModel || '',
      vehicleColor: entry.vehicleColor || '',
      photo: entry.photo || ''
    });
    const resident = residents.find(r => r.id === entry.residentId);
    if (resident) {
      setVisitedLocationSearch(`${resident.name} - ${resident.apartment}`);
    }
    setIsDialogOpen(true);
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este cadastro?')) return;
    await deleteEntry(id);
  };
  const exportActiveEntriesToPDF = () => {
    const doc = new jsPDF();
    doc.text('Cadastros Ativos', 14, 15);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', {
      locale: ptBR
    })}`, 14, 22);
    const tableData = filteredActiveEntries.map(entry => {
      const resident = residents.find(r => r.id === entry.residentId);
      return [entry.visitorName, entry.visitorDocument, resident?.name || '-', resident?.apartment || '-', entry.visitorType === 'visitor' ? 'Visitante' : 'Prestador', format(new Date(entry.entryTime), 'dd/MM/yyyy HH:mm', {
        locale: ptBR
      })];
    });
    autoTable(doc, {
      head: [['Nome', 'Documento', 'Morador', 'Apt', 'Tipo', 'Entrada']],
      body: tableData,
      startY: 28
    });
    doc.save(`cadastros-ativos-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
    toast.success('PDF gerado com sucesso');
  };
  const exportAllEntriesToPDF = () => {
    const doc = new jsPDF();
    doc.text('Todos os Cadastros', 14, 15);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', {
      locale: ptBR
    })}`, 14, 22);
    const tableData = filteredAllEntries.map(entry => {
      const resident = residents.find(r => r.id === entry.residentId);
      return [entry.visitorName, entry.visitorDocument, resident?.name || '-', resident?.apartment || '-', format(new Date(entry.entryTime), 'dd/MM/yyyy HH:mm', {
        locale: ptBR
      }), entry.exitTime ? format(new Date(entry.exitTime), 'dd/MM/yyyy HH:mm', {
        locale: ptBR
      }) : 'Ativo'];
    });
    autoTable(doc, {
      head: [['Nome', 'Documento', 'Morador', 'Apt', 'Entrada', 'Saída']],
      body: tableData,
      startY: 28
    });
    doc.save(`todos-cadastros-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
    toast.success('PDF gerado com sucesso');
  };
  const resetForm = () => {
    setEditingId('');
    setFormData({
      visitorName: '',
      visitorDocument: '',
      visitorType: 'visitor',
      residentId: '',
      purpose: '',
      company: '',
      vehiclePlate: '',
      vehicleModel: '',
      vehicleColor: '',
      photo: ''
    });
    setVisitedLocationSearch('');
    setSuggestions([]);
    setShowSuggestions(false);
    setIsDialogOpen(false);
    stopCamera();
  };
  const handleExit = async (entryId: string) => {
    const entry = allEntries.find(e => e.id === entryId);
    if (!entry) return;
    
    const updatedEntry: AccessEntry = {
      ...entry,
      exitTime: new Date().toISOString()
    };
    
    await saveEntry(updatedEntry);
  };
  return <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Novo Cadastro</h2>
          <p className="text-muted-foreground">Registre entradas e saídas de visitantes e prestadores</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowBlockedDialog(true)} className="gap-2">
            <ShieldBan className="h-5 w-5" />
            Bloqueados
            {blockedVisitors.length > 0 && (
              <Badge variant="destructive" className="ml-1">{blockedVisitors.length}</Badge>
            )}
          </Button>
          <Button onClick={() => setIsDialogOpen(true)} size="lg" className="gap-2 text-primary-foreground">
            <Plus className="h-5 w-5" />
            Nova Entrada
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <LogOut className="h-5 w-5 text-warning" />
              <span>Ativos no Condomínio</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-normal text-muted-foreground">
                {activeEntries.length} {activeEntries.length === 1 ? 'pessoa' : 'pessoas'}
              </span>
              <Button variant="outline" size="sm" onClick={exportActiveEntriesToPDF}>
                <Download className="h-4 w-4 mr-2" />
                PDF
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome, documento ou apartamento..." value={searchTerm} onChange={e => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
              setCurrentPageAll(1);
            }} className="pl-10" />
            </div>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Foto</TableHead>
                  <TableHead>Visitante</TableHead>
                  <TableHead>Apartamento</TableHead>
                  <TableHead>Entrada</TableHead>
                  <TableHead>Veículo</TableHead>
                  <TableHead className="text-right w-[180px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedEntries.length === 0 ? <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {searchTerm ? 'Nenhum registro encontrado' : 'Nenhuma pessoa no momento'}
                    </TableCell>
                  </TableRow> : paginatedEntries.map(entry => <TableRow key={entry.id} className={entry.visitorType === 'service_provider' ? 'bg-warning/5' : 'bg-success/5'}>
                      <TableCell>
                        {entry.photo ? <img src={entry.photo} alt={entry.visitorName} className="w-12 h-12 rounded-full object-cover border-2 border-primary/20" /> : <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-xl">
                            {entry.visitorType === 'service_provider' ? '🔧' : '👤'}
                          </div>}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-semibold">{entry.visitorName}</p>
                          <p className="text-xs text-muted-foreground">{entry.visitorDocument}</p>
                          {entry.company && <p className="text-xs text-muted-foreground">🏢 {entry.company}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{entry.apartment}</p>
                          <p className="text-xs text-muted-foreground">{entry.residentName}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(entry.entryTime).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.vehiclePlate ? <div>
                            <p>🚗 {entry.vehiclePlate}</p>
                            {entry.vehicleModel && <p className="text-xs">{entry.vehicleModel}</p>}
                          </div> : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => handleEdit(entry)} className="h-8 w-8" title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleBlockVisitor(entry)} className="h-8 w-8 text-destructive hover:text-destructive" title="Bloquear">
                            <Ban className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDelete(entry.id)} className="h-8 w-8 text-destructive hover:text-destructive" title="Excluir">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Button size="sm" onClick={() => handleExit(entry.id)} className="h-8">
                            <LogOut className="h-4 w-4 mr-1" />
                            Saída
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>)}
              </TableBody>
            </Table>
          </div>
          
          {totalPages > 1 && <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                  </PaginationItem>
                  
                  {Array.from({
                length: totalPages
              }, (_, i) => i + 1).map(page => <PaginationItem key={page}>
                      <PaginationLink onClick={() => setCurrentPage(page)} isActive={currentPage === page} className="cursor-pointer">
                        {page}
                      </PaginationLink>
                    </PaginationItem>)}
                  
                  <PaginationItem>
                    <PaginationNext onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>}
        </CardContent>
      </Card>

      

      <Dialog open={isDialogOpen} onOpenChange={open => {
      if (!open) resetForm();
      setIsDialogOpen(open);
    }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Cadastro' : 'Registrar Nova Entrada'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEntry} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="visitorType">Tipo *</Label>
                  <Select value={formData.visitorType} onValueChange={(value: 'visitor' | 'service_provider') => setFormData({
                ...formData,
                visitorType: value
              })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visitor">👥 Visitante</SelectItem>
                      <SelectItem value="service_provider">🔧 Prestador de Serviço</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="visitorName">Nome Completo *</Label>
                  <Input id="visitorName" value={formData.visitorName} onChange={e => {
                setFormData({
                  ...formData,
                  visitorName: e.target.value
                });
                findSimilarEntries(e.target.value, formData.visitorDocument);
              }} placeholder="Nome completo" required />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="visitorDocument">RG/CPF *</Label>
                  <Input id="visitorDocument" value={formData.visitorDocument} onChange={e => {
                setFormData({
                  ...formData,
                  visitorDocument: e.target.value
                });
                findSimilarEntries(formData.visitorName, e.target.value);
              }} placeholder="Número do documento" required />
                </div>

                {showSuggestions && suggestions.length > 0 && <div className="md:col-span-2 p-3 bg-primary/10 border border-primary rounded-lg">
                    <p className="text-sm font-semibold text-primary mb-2">✨ Cadastros encontrados:</p>
                    <div className="space-y-2">
                      {suggestions.map(suggestion => <button key={suggestion.id} type="button" onClick={() => applySuggestion(suggestion)} className="w-full text-left p-2 bg-background rounded hover:bg-muted transition-colors text-sm">
                          <p className="font-medium">{suggestion.visitorName}</p>
                          <p className="text-xs text-muted-foreground">
                            Doc: {suggestion.visitorDocument} • Última visita: {new Date(suggestion.entryTime).toLocaleDateString('pt-BR')}
                          </p>
                        </button>)}
                    </div>
                  </div>}

                {formData.visitorType === 'service_provider' && <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="company">Empresa</Label>
                    <Input id="company" value={formData.company} onChange={e => setFormData({
                ...formData,
                company: e.target.value
              })} placeholder="Nome da empresa" />
                  </div>}

                <div className="space-y-2 md:col-span-2 relative">
                  <Label htmlFor="residentId">Visitando *</Label>
                  <Input id="visitedLocation" value={visitedLocationSearch} onChange={e => {
                setVisitedLocationSearch(e.target.value);
                setShowResidentSuggestions(e.target.value.length > 0);
              }} onFocus={() => setShowResidentSuggestions(visitedLocationSearch.length > 0)} placeholder="Digite o nome ou apartamento do morador" required />
                  {showResidentSuggestions && filteredResidents.length > 0 && <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredResidents.slice(0, 5).map(resident => <button key={resident.id} type="button" className="w-full text-left px-4 py-2 hover:bg-accent transition-colors" onClick={() => handleVisitedLocationSelect(resident.id, resident.name, resident.apartment)}>
                          <div className="font-medium">{resident.name}</div>
                          <div className="text-sm text-muted-foreground">{resident.apartment}</div>
                        </button>)}
                    </div>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vehiclePlate">Placa do Veículo</Label>
                  <Input id="vehiclePlate" value={formData.vehiclePlate} onChange={e => setFormData({
                ...formData,
                vehiclePlate: e.target.value
              })} placeholder="ABC-1234" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vehicleModel">Modelo</Label>
                  <Input id="vehicleModel" value={formData.vehicleModel} onChange={e => setFormData({
                ...formData,
                vehicleModel: e.target.value
              })} placeholder="Ex: Honda Civic" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vehicleColor">Cor do Veículo</Label>
                  <Input id="vehicleColor" value={formData.vehicleColor} onChange={e => setFormData({
                ...formData,
                vehicleColor: e.target.value
              })} placeholder="Ex: Preto" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purpose">Motivo da Visita</Label>
                  <Textarea id="purpose" value={formData.purpose} onChange={e => setFormData({
                ...formData,
                purpose: e.target.value
              })} placeholder="Ex: Visita social, manutenção..." rows={2} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Foto</Label>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={startCamera} className="flex-1">
                      <Camera className="h-4 w-4 mr-2" />
                      Webcam
                    </Button>
                    <Button type="button" variant="outline" className="flex-1" onClick={() => document.getElementById('photoUpload')?.click()}>
                      <Upload className="h-4 w-4 mr-2" />
                      Carregar
                    </Button>
                    <input id="photoUpload" type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                  </div>
                  {formData.photo && <div className="relative inline-block">
                      <img src={formData.photo} alt="Foto" className="w-24 h-24 object-cover rounded-lg border" />
                      <button type="button" onClick={() => setFormData({
                  ...formData,
                  photo: ''
                })} className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1">
                        <X className="h-3 w-3" />
                      </button>
                    </div>}
                </div>
              </div>

              {showCamera && <div className="space-y-2">
                  <video ref={videoRef} autoPlay className="w-full rounded-lg border" />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="flex gap-2">
                    <Button type="button" onClick={capturePhoto} className="flex-1">
                      Capturar Foto
                    </Button>
                    <Button type="button" variant="secondary" onClick={stopCamera}>
                      Cancelar
                    </Button>
                  </div>
                </div>}

              <Button type="submit" className="w-full">
                <LogIn className="h-4 w-4 mr-2" />
                Registrar Entrada
              </Button>
            </form>
        </DialogContent>
      </Dialog>

      {/* Blocked Visitors Dialog */}
      <Dialog open={showBlockedDialog} onOpenChange={setShowBlockedDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldBan className="h-5 w-5 text-destructive" />
              Visitantes/Prestadores Bloqueados
            </DialogTitle>
          </DialogHeader>
          {blockedVisitors.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Nenhum visitante bloqueado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blockedVisitors.map(bv => (
                  <TableRow key={bv.id}>
                    <TableCell className="font-medium">{bv.visitor_name}</TableCell>
                    <TableCell>{bv.visitor_document}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{bv.reason || '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(bv.blocked_at), 'dd/MM/yyyy', { locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => handleUnblockVisitor(bv.id)} className="gap-1">
                        <ShieldCheck className="h-4 w-4" />
                        Desbloquear
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      {/* Block Reason Dialog */}
      <Dialog open={showBlockReasonDialog} onOpenChange={setShowBlockReasonDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              Bloquear {blockingEntry?.visitorName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Motivo do bloqueio (opcional)</Label>
              <Textarea
                value={blockReason}
                onChange={e => setBlockReason(e.target.value)}
                placeholder="Informe o motivo do bloqueio..."
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowBlockReasonDialog(false)}>Cancelar</Button>
              <Button variant="destructive" onClick={confirmBlockVisitor}>
                <Ban className="h-4 w-4 mr-2" />
                Confirmar Bloqueio
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>;
};