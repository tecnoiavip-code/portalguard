import { useState, useEffect } from 'react';
import { exportToCSV } from '@/lib/export-csv';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ClipboardList, Users, AlertTriangle, Activity, Plus, Wrench, Download, Search, X, FileSpreadsheet } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
interface Shift {
  id: string;
  team_members: string[];
  shift_start: string;
  shift_end: string | null;
  notes: string | null;
  created_at: string;
}
interface Incident {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  created_at: string;
  resolved_at: string | null;
}
interface ShiftEquipment {
  id: string;
  name: string;
  status: 'functional' | 'defective' | 'maintenance';
}
interface Device {
  id: string;
  name: string;
  type: string;
  location: string;
  status: 'online' | 'offline';
  last_sync: string;
}
export const Reports = () => {
  const [activeTab, setActiveTab] = useState<'shifts' | 'incidents' | 'devices'>('shifts');

  // Shifts state
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [teamMembers, setTeamMembers] = useState<string>('');
  const [shiftNotes, setShiftNotes] = useState<string>('');
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [shiftSearch, setShiftSearch] = useState('');
  const [shiftPage, setShiftPage] = useState(1);
  const [equipmentItems, setEquipmentItems] = useState<ShiftEquipment[]>([{
    id: crypto.randomUUID(),
    name: '',
    status: 'functional'
  }]);

  // Incidents state
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('low');
  const [incidentPage, setIncidentPage] = useState(1);

  // Devices state
  const [devices, setDevices] = useState<Device[]>([]);
  const [isDeviceDialogOpen, setIsDeviceDialogOpen] = useState(false);
  const [deviceFormData, setDeviceFormData] = useState({
    name: '',
    type: 'facial_recognition' as 'facial_recognition' | 'vehicle_tag' | 'card_reader',
    location: ''
  });
  const [devicePage, setDevicePage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  useEffect(() => {
    loadShifts();
    loadIncidents();
    loadDevices();
    checkCurrentShift();
  }, []);
  const loadShifts = async () => {
    const {
      data,
      error
    } = await supabase.from('shifts').select('*').order('shift_start', {
      ascending: false
    }).limit(10);
    if (error) {
      console.error('Error loading shifts:', error);
    } else {
      setShifts(data || []);
    }
  };
  const loadIncidents = async () => {
    const {
      data,
      error
    } = await supabase.from('incidents').select('*').order('created_at', {
      ascending: false
    });
    if (error) {
      console.error('Error loading incidents:', error);
    } else {
      setIncidents(data as Incident[] || []);
    }
  };
  const loadDevices = async () => {
    const {
      data,
      error
    } = await supabase.from('devices').select('*').order('name');
    if (error) {
      console.error('Error loading devices:', error);
    } else {
      setDevices(data as Device[] || []);
    }
  };
  const checkCurrentShift = async () => {
    const {
      data
    } = await supabase.from('shifts').select('*').is('shift_end', null).order('shift_start', {
      ascending: false
    }).limit(1).maybeSingle();
    if (data) {
      setCurrentShift(data);
    }
  };
  const handleStartShift = async () => {
    if (!teamMembers.trim()) {
      toast.error('Informe os membros da equipe');
      return;
    }
    const validEquipment = equipmentItems.filter(item => item.name.trim());
    if (validEquipment.length === 0) {
      toast.error('Informe pelo menos um equipamento');
      return;
    }
    const members = teamMembers.split(',').map(m => m.trim()).filter(m => m);
    const {
      error
    } = await supabase.from('shifts').insert({
      team_members: members,
      shift_start: new Date().toISOString(),
      notes: `${shiftNotes ? shiftNotes + '\n\n' : ''}Equipamentos: ${validEquipment.map(e => `${e.name} (${e.status === 'functional' ? 'Funcionando' : e.status === 'defective' ? 'Defeituoso' : 'Manutenção'})`).join(', ')}`
    });
    if (error) {
      toast.error('Erro ao iniciar plantão');
    } else {
      toast.success('Plantão iniciado com sucesso');
      setTeamMembers('');
      setShiftNotes('');
      setEquipmentItems([{
        id: crypto.randomUUID(),
        name: '',
        status: 'functional'
      }]);
      loadShifts();
      checkCurrentShift();
    }
  };
  const handleEndShift = async () => {
    if (!currentShift) return;
    const {
      error
    } = await supabase.from('shifts').update({
      shift_end: new Date().toISOString()
    }).eq('id', currentShift.id);
    if (error) {
      toast.error('Erro ao encerrar plantão');
    } else {
      toast.success('Plantão encerrado com sucesso');
      setCurrentShift(null);
      loadShifts();
    }
  };
  const handleCreateIncident = async () => {
    if (!incidentTitle.trim() || !incidentDescription.trim()) {
      toast.error('Preencha título e descrição');
      return;
    }
    const {
      error
    } = await supabase.from('incidents').insert({
      title: incidentTitle,
      description: incidentDescription,
      severity: incidentSeverity,
      status: 'open'
    });
    if (error) {
      toast.error('Erro ao registrar ocorrência');
    } else {
      toast.success('Ocorrência registrada');
      setIncidentTitle('');
      setIncidentDescription('');
      setIncidentSeverity('low');
      loadIncidents();
    }
  };
  const handleUpdateIncidentStatus = async (id: string, newStatus: string) => {
    const updates: any = {
      status: newStatus
    };
    if (newStatus === 'resolved' || newStatus === 'closed') {
      updates.resolved_at = new Date().toISOString();
    }
    const {
      error
    } = await supabase.from('incidents').update(updates).eq('id', id);
    if (error) {
      toast.error('Erro ao atualizar ocorrência');
    } else {
      toast.success('Ocorrência atualizada');
      loadIncidents();
    }
  };
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'destructive';
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'secondary';
      default:
        return 'default';
    }
  };
  const getSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'Crítica';
      case 'high':
        return 'Alta';
      case 'medium':
        return 'Média';
      case 'low':
        return 'Baixa';
      default:
        return severity;
    }
  };
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open':
        return 'Aberta';
      case 'in_progress':
        return 'Em Andamento';
      case 'resolved':
        return 'Resolvida';
      case 'closed':
        return 'Fechada';
      default:
        return status;
    }
  };
  const handleCreateDevice = async () => {
    if (!deviceFormData.name.trim() || !deviceFormData.location.trim()) {
      toast.error('Preencha nome e localização do equipamento');
      return;
    }
    const {
      error
    } = await supabase.from('devices').insert({
      name: deviceFormData.name,
      type: deviceFormData.type,
      location: deviceFormData.location,
      status: 'online',
      last_sync: new Date().toISOString()
    });
    if (error) {
      toast.error('Erro ao cadastrar equipamento');
    } else {
      toast.success('Equipamento cadastrado com sucesso');
      setDeviceFormData({
        name: '',
        type: 'facial_recognition',
        location: ''
      });
      setIsDeviceDialogOpen(false);
      loadDevices();
    }
  };
  const handleAddEquipmentItem = () => {
    setEquipmentItems([...equipmentItems, {
      id: crypto.randomUUID(),
      name: '',
      status: 'functional'
    }]);
  };
  const handleRemoveEquipmentItem = (id: string) => {
    if (equipmentItems.length > 1) {
      setEquipmentItems(equipmentItems.filter(item => item.id !== id));
    }
  };
  const handleEquipmentChange = (id: string, field: 'name' | 'status', value: string) => {
    setEquipmentItems(equipmentItems.map(item => item.id === id ? {
      ...item,
      [field]: value
    } : item));
  };
  const exportShiftsToPDF = (selectedDate?: Date) => {
    const doc = new jsPDF();
    const filteredShifts = selectedDate ? shifts.filter(s => new Date(s.shift_start).toDateString() === selectedDate.toDateString()) : shifts;
    doc.text('Histórico de Plantões', 14, 15);
    if (selectedDate) {
      doc.text(`Data: ${format(selectedDate, 'dd/MM/yyyy', {
        locale: ptBR
      })}`, 14, 22);
    }
    const tableData = filteredShifts.map(shift => [format(new Date(shift.shift_start), "dd/MM/yyyy HH:mm", {
      locale: ptBR
    }), shift.shift_end ? format(new Date(shift.shift_end), "dd/MM/yyyy HH:mm", {
      locale: ptBR
    }) : 'Em andamento', shift.team_members.join(', '), shift.notes || '-']);
    autoTable(doc, {
      head: [['Início', 'Fim', 'Equipe', 'Observações']],
      body: tableData,
      startY: selectedDate ? 28 : 22
    });
    doc.save(`plantoes-${selectedDate ? format(selectedDate, 'dd-MM-yyyy') : 'todos'}.pdf`);
    toast.success('PDF gerado com sucesso');
  };

  const exportShiftsToCSV = (selectedDate?: Date) => {
    const filteredShifts = selectedDate ? shifts.filter(s => new Date(s.shift_start).toDateString() === selectedDate.toDateString()) : shifts;
    const headers = ['Início', 'Fim', 'Equipe', 'Observações'];
    const rows = filteredShifts.map(shift => [
      format(new Date(shift.shift_start), 'dd/MM/yyyy HH:mm', { locale: ptBR }),
      shift.shift_end ? format(new Date(shift.shift_end), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : 'Em andamento',
      shift.team_members.join(', '), shift.notes || '-',
    ]);
    exportToCSV(`plantoes-${selectedDate ? format(selectedDate, 'dd-MM-yyyy') : 'todos'}`, headers, rows);
    toast.success('CSV gerado com sucesso');
  };

  // Filtered and paginated data
  const filteredShifts = shifts.filter(shift => shift.team_members.some(member => member.toLowerCase().includes(shiftSearch.toLowerCase())) || shift.notes && shift.notes.toLowerCase().includes(shiftSearch.toLowerCase()));
  const paginatedShifts = filteredShifts.slice((shiftPage - 1) * ITEMS_PER_PAGE, shiftPage * ITEMS_PER_PAGE);
  const totalShiftPages = Math.ceil(filteredShifts.length / ITEMS_PER_PAGE);
  const paginatedIncidents = incidents.slice((incidentPage - 1) * ITEMS_PER_PAGE, incidentPage * ITEMS_PER_PAGE);
  const totalIncidentPages = Math.ceil(incidents.length / ITEMS_PER_PAGE);
  const paginatedDevices = devices.slice((devicePage - 1) * ITEMS_PER_PAGE, devicePage * ITEMS_PER_PAGE);
  const totalDevicePages = Math.ceil(devices.length / ITEMS_PER_PAGE);
  return <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Relatórios</h1>
      </div>

      <div className="flex gap-2 border-b">
        <Button variant={activeTab === 'shifts' ? 'default' : 'ghost'} onClick={() => setActiveTab('shifts')}>
          <Users className="mr-2 h-4 w-4" />
          Plantões
        </Button>
        <Button variant={activeTab === 'incidents' ? 'default' : 'ghost'} onClick={() => setActiveTab('incidents')}>
          <AlertTriangle className="mr-2 h-4 w-4" />
          Ocorrências
        </Button>
        
      </div>

      {activeTab === 'shifts' && <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Gerenciar Plantão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentShift ? <div className="space-y-4">
                  <div className="p-4 border rounded-lg bg-card">
                    <h3 className="font-semibold mb-2">Plantão Atual</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Iniciado: {format(new Date(currentShift.shift_start), "dd/MM/yyyy 'às' HH:mm", {
                  locale: ptBR
                })}
                    </p>
                    <p className="text-sm">
                      <strong>Equipe:</strong> {currentShift.team_members.join(', ')}
                    </p>
                    {currentShift.notes && <p className="text-sm mt-2">
                        <strong>Observações:</strong> {currentShift.notes}
                      </p>}
                  </div>
                  <Button onClick={handleEndShift} variant="destructive">
                    Encerrar Plantão
                  </Button>
                </div> : <div className="space-y-4">
                  <div>
                    <Label>Membros da Equipe (separados por vírgula)</Label>
                    <Input value={teamMembers} onChange={e => setTeamMembers(e.target.value)} placeholder="João Silva, Maria Santos, Pedro Costa" />
                  </div>
                  <div>
                    <Label>Equipamentos de Portaria</Label>
                    <div className="space-y-2 mt-2">
                      {equipmentItems.map((item, index) => <div key={item.id} className="flex gap-2">
                          <Input value={item.name} onChange={e => handleEquipmentChange(item.id, 'name', e.target.value)} placeholder="Ex: Telefone, Rádio, Celular..." className="flex-1" />
                          <Select value={item.status} onValueChange={(v: any) => handleEquipmentChange(item.id, 'status', v)}>
                            <SelectTrigger className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="functional">Funcionando</SelectItem>
                              <SelectItem value="defective">Defeituoso</SelectItem>
                              <SelectItem value="maintenance">Manutenção</SelectItem>
                            </SelectContent>
                          </Select>
                          {equipmentItems.length > 1 && <Button variant="outline" size="icon" onClick={() => handleRemoveEquipmentItem(item.id)}>
                              <X className="h-4 w-4" />
                            </Button>}
                        </div>)}
                      <Button variant="outline" size="sm" onClick={handleAddEquipmentItem} className="w-full">
                        <Plus className="h-4 w-4 mr-2" />
                        Adicionar Item
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label>Observações</Label>
                    <Textarea value={shiftNotes} onChange={e => setShiftNotes(e.target.value)} placeholder="Observações sobre o plantão..." />
                  </div>
                  <Button onClick={handleStartShift}>
                    <ClipboardList className="mr-2 h-4 w-4" />
                    Iniciar Plantão
                  </Button>
                </div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle>Histórico de Plantões</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportShiftsToPDF()}>
                    <Download className="h-4 w-4 mr-2" />
                    PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportShiftsToCSV()}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar por equipe ou observações..." value={shiftSearch} onChange={e => {
                setShiftSearch(e.target.value);
                setShiftPage(1);
              }} className="pl-10" />
                </div>
              </div>
              <div className="space-y-4">
                {paginatedShifts.map(shift => <div key={shift.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(shift.shift_start), "dd/MM/yyyy 'às' HH:mm", {
                      locale: ptBR
                    })}
                          {shift.shift_end && <> - {format(new Date(shift.shift_end), "dd/MM/yyyy 'às' HH:mm", {
                        locale: ptBR
                      })}</>}
                        </p>
                        <p className="font-medium">Equipe: {shift.team_members.join(', ')}</p>
                      </div>
                      {!shift.shift_end && <Badge variant="default">Em andamento</Badge>}
                    </div>
                    {shift.notes && <p className="text-sm text-muted-foreground mt-2">{shift.notes}</p>}
                  </div>)}
                {filteredShifts.length === 0 && <p className="text-center text-muted-foreground py-8">
                    Nenhum plantão encontrado
                  </p>}
              </div>
              {totalShiftPages > 1 && <div className="flex justify-center gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShiftPage(p => Math.max(1, p - 1))} disabled={shiftPage === 1}>
                    Anterior
                  </Button>
                  <span className="flex items-center px-4">
                    Página {shiftPage} de {totalShiftPages}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setShiftPage(p => Math.min(totalShiftPages, p + 1))} disabled={shiftPage === totalShiftPages}>
                    Próxima
                  </Button>
                </div>}
            </CardContent>
          </Card>
        </div>}

      {activeTab === 'incidents' && <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Registrar Ocorrência</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Título</Label>
                <Input value={incidentTitle} onChange={e => setIncidentTitle(e.target.value)} placeholder="Título da ocorrência" />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea value={incidentDescription} onChange={e => setIncidentDescription(e.target.value)} placeholder="Descreva a ocorrência..." rows={4} />
              </div>
              <div>
                <Label>Gravidade</Label>
                <Select value={incidentSeverity} onValueChange={(v: any) => setIncidentSeverity(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="critical">Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreateIncident}>
                <AlertTriangle className="mr-2 h-4 w-4" />
                Registrar Ocorrência
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lista de Ocorrências</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {paginatedIncidents.map(incident => <div key={incident.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <h3 className="font-semibold">{incident.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{incident.description}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {format(new Date(incident.created_at), "dd/MM/yyyy 'às' HH:mm", {
                      locale: ptBR
                    })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant={getSeverityColor(incident.severity)}>
                          {getSeverityLabel(incident.severity)}
                        </Badge>
                        <Badge variant="outline">
                          {getStatusLabel(incident.status)}
                        </Badge>
                      </div>
                    </div>
                    {incident.status !== 'closed' && <div className="flex gap-2 mt-3">
                        {incident.status === 'open' && <Button size="sm" variant="outline" onClick={() => handleUpdateIncidentStatus(incident.id, 'in_progress')}>
                            Iniciar
                          </Button>}
                        {incident.status === 'in_progress' && <Button size="sm" variant="outline" onClick={() => handleUpdateIncidentStatus(incident.id, 'resolved')}>
                            Resolver
                          </Button>}
                        <Button size="sm" variant="outline" onClick={() => handleUpdateIncidentStatus(incident.id, 'closed')}>
                          Fechar
                        </Button>
                      </div>}
                  </div>)}
              </div>
              {totalIncidentPages > 1 && <div className="flex justify-center gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setIncidentPage(p => Math.max(1, p - 1))} disabled={incidentPage === 1}>
                    Anterior
                  </Button>
                  <span className="flex items-center px-4">
                    Página {incidentPage} de {totalIncidentPages}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setIncidentPage(p => Math.min(totalIncidentPages, p + 1))} disabled={incidentPage === totalIncidentPages}>
                    Próxima
                  </Button>
                </div>}
            </CardContent>
          </Card>
        </div>}

      {activeTab === 'devices' && <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  Equipamentos do Plantão
                </CardTitle>
                <Button onClick={() => setIsDeviceDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Cadastrar Equipamento
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {paginatedDevices.map(device => <div key={device.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{device.name}</h3>
                        <p className="text-sm text-muted-foreground">{device.location}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Tipo: {device.type === 'facial_recognition' ? 'Reconhecimento Facial' : device.type === 'vehicle_tag' ? 'Tag Veicular' : 'Leitor de Cartão'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Última sincronização: {format(new Date(device.last_sync), "dd/MM/yyyy 'às' HH:mm", {
                      locale: ptBR
                    })}
                        </p>
                      </div>
                      <Badge variant={device.status === 'online' ? 'default' : 'destructive'}>
                        {device.status === 'online' ? 'Online' : 'Offline'}
                      </Badge>
                    </div>
                  </div>)}
                {devices.length === 0 && <p className="text-center text-muted-foreground py-8">
                    Nenhum equipamento cadastrado
                  </p>}
              </div>
              {totalDevicePages > 1 && <div className="flex justify-center gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setDevicePage(p => Math.max(1, p - 1))} disabled={devicePage === 1}>
                    Anterior
                  </Button>
                  <span className="flex items-center px-4">
                    Página {devicePage} de {totalDevicePages}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setDevicePage(p => Math.min(totalDevicePages, p + 1))} disabled={devicePage === totalDevicePages}>
                    Próxima
                  </Button>
                </div>}
            </CardContent>
          </Card>
        </div>}

      <Dialog open={isDeviceDialogOpen} onOpenChange={setIsDeviceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar Equipamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Nome do Equipamento *</Label>
              <Input value={deviceFormData.name} onChange={e => setDeviceFormData({
              ...deviceFormData,
              name: e.target.value
            })} placeholder="Ex: Leitor Principal" />
            </div>
            <div>
              <Label>Tipo *</Label>
              <Select value={deviceFormData.type} onValueChange={(v: any) => setDeviceFormData({
              ...deviceFormData,
              type: v
            })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facial_recognition">Reconhecimento Facial</SelectItem>
                  <SelectItem value="vehicle_tag">Tag Veicular</SelectItem>
                  <SelectItem value="card_reader">Leitor de Cartão</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Localização *</Label>
              <Input value={deviceFormData.location} onChange={e => setDeviceFormData({
              ...deviceFormData,
              location: e.target.value
            })} placeholder="Ex: Portaria Principal" />
            </div>
            <Button onClick={handleCreateDevice} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Cadastrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>;
};