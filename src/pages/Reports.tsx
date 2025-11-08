import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ClipboardList, Users, AlertTriangle, Activity, Plus, Wrench } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
  
  // Incidents state
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('low');
  
  // Devices state
  const [devices, setDevices] = useState<Device[]>([]);
  const [isDeviceDialogOpen, setIsDeviceDialogOpen] = useState(false);
  const [deviceFormData, setDeviceFormData] = useState({
    name: '',
    type: 'facial_recognition' as 'facial_recognition' | 'vehicle_tag' | 'card_reader',
    location: '',
  });

  useEffect(() => {
    loadShifts();
    loadIncidents();
    loadDevices();
    checkCurrentShift();
  }, []);

  const loadShifts = async () => {
    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .order('shift_start', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('Error loading shifts:', error);
    } else {
      setShifts(data || []);
    }
  };

  const loadIncidents = async () => {
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error loading incidents:', error);
    } else {
      setIncidents((data as Incident[]) || []);
    }
  };

  const loadDevices = async () => {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .order('name');
    
    if (error) {
      console.error('Error loading devices:', error);
    } else {
      setDevices((data as Device[]) || []);
    }
  };

  const checkCurrentShift = async () => {
    const { data } = await supabase
      .from('shifts')
      .select('*')
      .is('shift_end', null)
      .order('shift_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (data) {
      setCurrentShift(data);
    }
  };

  const handleStartShift = async () => {
    if (!teamMembers.trim()) {
      toast.error('Informe os membros da equipe');
      return;
    }

    const members = teamMembers.split(',').map(m => m.trim()).filter(m => m);
    
    const { error } = await supabase
      .from('shifts')
      .insert({
        team_members: members,
        shift_start: new Date().toISOString(),
        notes: shiftNotes || null
      });

    if (error) {
      toast.error('Erro ao iniciar plantão');
    } else {
      toast.success('Plantão iniciado com sucesso');
      setTeamMembers('');
      setShiftNotes('');
      loadShifts();
      checkCurrentShift();
    }
  };

  const handleEndShift = async () => {
    if (!currentShift) return;

    const { error } = await supabase
      .from('shifts')
      .update({ shift_end: new Date().toISOString() })
      .eq('id', currentShift.id);

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

    const { error } = await supabase
      .from('incidents')
      .insert({
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
    const updates: any = { status: newStatus };
    if (newStatus === 'resolved' || newStatus === 'closed') {
      updates.resolved_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('incidents')
      .update(updates)
      .eq('id', id);

    if (error) {
      toast.error('Erro ao atualizar ocorrência');
    } else {
      toast.success('Ocorrência atualizada');
      loadIncidents();
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'default';
      case 'low': return 'secondary';
      default: return 'default';
    }
  };

  const getSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'critical': return 'Crítica';
      case 'high': return 'Alta';
      case 'medium': return 'Média';
      case 'low': return 'Baixa';
      default: return severity;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open': return 'Aberta';
      case 'in_progress': return 'Em Andamento';
      case 'resolved': return 'Resolvida';
      case 'closed': return 'Fechada';
      default: return status;
    }
  };

  const handleCreateDevice = async () => {
    if (!deviceFormData.name.trim() || !deviceFormData.location.trim()) {
      toast.error('Preencha nome e localização do equipamento');
      return;
    }

    const { error } = await supabase
      .from('devices')
      .insert({
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Relatórios</h1>
      </div>

      <div className="flex gap-2 border-b">
        <Button
          variant={activeTab === 'shifts' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('shifts')}
        >
          <Users className="mr-2 h-4 w-4" />
          Plantões
        </Button>
        <Button
          variant={activeTab === 'incidents' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('incidents')}
        >
          <AlertTriangle className="mr-2 h-4 w-4" />
          Ocorrências
        </Button>
        <Button
          variant={activeTab === 'devices' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('devices')}
        >
          <Activity className="mr-2 h-4 w-4" />
          Equipamentos
        </Button>
      </div>

      {activeTab === 'shifts' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Gerenciar Plantão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentShift ? (
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg bg-card">
                    <h3 className="font-semibold mb-2">Plantão Atual</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Iniciado: {format(new Date(currentShift.shift_start), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                    <p className="text-sm">
                      <strong>Equipe:</strong> {currentShift.team_members.join(', ')}
                    </p>
                    {currentShift.notes && (
                      <p className="text-sm mt-2">
                        <strong>Observações:</strong> {currentShift.notes}
                      </p>
                    )}
                  </div>
                  <Button onClick={handleEndShift} variant="destructive">
                    Encerrar Plantão
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label>Membros da Equipe (separados por vírgula)</Label>
                    <Input
                      value={teamMembers}
                      onChange={(e) => setTeamMembers(e.target.value)}
                      placeholder="João Silva, Maria Santos, Pedro Costa"
                    />
                  </div>
                  <div>
                    <Label>Observações</Label>
                    <Textarea
                      value={shiftNotes}
                      onChange={(e) => setShiftNotes(e.target.value)}
                      placeholder="Observações sobre o plantão..."
                    />
                  </div>
                  <Button onClick={handleStartShift}>
                    <ClipboardList className="mr-2 h-4 w-4" />
                    Iniciar Plantão
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Histórico de Plantões</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {shifts.map((shift) => (
                  <div key={shift.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(shift.shift_start), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          {shift.shift_end && (
                            <> - {format(new Date(shift.shift_end), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</>
                          )}
                        </p>
                        <p className="font-medium">Equipe: {shift.team_members.join(', ')}</p>
                      </div>
                      {!shift.shift_end && (
                        <Badge variant="default">Em andamento</Badge>
                      )}
                    </div>
                    {shift.notes && (
                      <p className="text-sm text-muted-foreground mt-2">{shift.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'incidents' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Registrar Ocorrência</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Título</Label>
                <Input
                  value={incidentTitle}
                  onChange={(e) => setIncidentTitle(e.target.value)}
                  placeholder="Título da ocorrência"
                />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea
                  value={incidentDescription}
                  onChange={(e) => setIncidentDescription(e.target.value)}
                  placeholder="Descreva a ocorrência..."
                  rows={4}
                />
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
                {incidents.map((incident) => (
                  <div key={incident.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <h3 className="font-semibold">{incident.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{incident.description}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {format(new Date(incident.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
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
                    {incident.status !== 'closed' && (
                      <div className="flex gap-2 mt-3">
                        {incident.status === 'open' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateIncidentStatus(incident.id, 'in_progress')}
                          >
                            Iniciar
                          </Button>
                        )}
                        {incident.status === 'in_progress' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateIncidentStatus(incident.id, 'resolved')}
                          >
                            Resolver
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUpdateIncidentStatus(incident.id, 'closed')}
                        >
                          Fechar
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'devices' && (
        <div className="space-y-6">
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
                {devices.map((device) => (
                  <div key={device.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{device.name}</h3>
                        <p className="text-sm text-muted-foreground">{device.location}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Tipo: {device.type === 'facial_recognition' ? 'Reconhecimento Facial' : 
                                device.type === 'vehicle_tag' ? 'Tag Veicular' : 'Leitor de Cartão'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Última sincronização: {format(new Date(device.last_sync), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                      <Badge variant={device.status === 'online' ? 'default' : 'destructive'}>
                        {device.status === 'online' ? 'Online' : 'Offline'}
                      </Badge>
                    </div>
                  </div>
                ))}
                {devices.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    Nenhum equipamento cadastrado
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={isDeviceDialogOpen} onOpenChange={setIsDeviceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar Equipamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Nome do Equipamento *</Label>
              <Input
                value={deviceFormData.name}
                onChange={(e) => setDeviceFormData({ ...deviceFormData, name: e.target.value })}
                placeholder="Ex: Leitor Principal"
              />
            </div>
            <div>
              <Label>Tipo *</Label>
              <Select 
                value={deviceFormData.type} 
                onValueChange={(v: any) => setDeviceFormData({ ...deviceFormData, type: v })}
              >
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
              <Input
                value={deviceFormData.location}
                onChange={(e) => setDeviceFormData({ ...deviceFormData, location: e.target.value })}
                placeholder="Ex: Portaria Principal"
              />
            </div>
            <Button onClick={handleCreateDevice} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Cadastrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
