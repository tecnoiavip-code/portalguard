import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Camera, Tag, CreditCard, Pencil, Trash2, Plus, Settings2, Loader2, Network } from 'lucide-react';
import { Device } from '@/types';
import { useDevices } from '@/hooks/useDevices';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export const Devices = () => {
  const { devices, loading, saveDevice, deleteDevice, refresh } = useDevices();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string>('');
  const [pushingConfig, setPushingConfig] = useState<string | null>(null);
  const [localConfigLoading, setLocalConfigLoading] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'facial_recognition' as Device['type'],
    location: '',
    status: 'online' as Device['status'],
    ipAddress: '',
    serialNumber: '',
  });

  const handlePushConfig = async (device: Device) => {
    if (!device.serialNumber) {
      toast.error('Dispositivo sem número de série configurado');
      return;
    }

    setPushingConfig(device.id);
    try {
      const { data, error } = await supabase.functions.invoke('controlid-webhook/push-config', {
        method: 'POST',
        body: { device_id: device.serialNumber },
      });

      if (error) throw error;

      toast.success('Configuração do monitor enfileirada com sucesso! O dispositivo receberá na próxima consulta push.', {
        duration: 5000,
        description: `Hostname: ${data?.config?.monitor?.hostname || 'N/A'}`,
      });
    } catch (err: any) {
      console.error('Error pushing config:', err);
      toast.error('Erro ao enviar configuração', {
        description: err.message || 'Tente novamente',
      });
    } finally {
      setPushingConfig(null);
    }
  };

  const handleLocalConfig = async (device: Device) => {
    if (!device.ipAddress) {
      toast.error('Dispositivo sem IP configurado');
      return;
    }

    // Mixed Content: browsers block http:// requests from https:// pages.
    // Detect and guide the user to open via http instead.
    if (window.location.protocol === 'https:') {
      const httpUrl = window.location.href.replace('https://', 'http://');
      toast.error('Configuração local requer acesso via HTTP', {
        duration: 10000,
        description: 'O navegador bloqueia requisições para dispositivos locais (HTTP) quando a página é HTTPS. Use o script abaixo ou configure manualmente.',
      });
      
      // Open a small helper window that does the config via plain HTTP
      const ip = device.ipAddress;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
      let hostname = '';
      try { hostname = new URL(supabaseUrl).hostname; } catch { hostname = 'kxdqffkkufgsizszchvw.supabase.co'; }
      
      const script = generateLocalConfigScript(ip, hostname);
      const blob = new Blob([script], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'width=600,height=400');
      return;
    }

    setLocalConfigLoading(device.id);
    const ip = device.ipAddress;
    const port = '80';
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    let hostname = '';
    try {
      hostname = new URL(supabaseUrl).hostname;
    } catch {
      hostname = 'kxdqffkkufgsizszchvw.supabase.co';
    }

    await executeLocalConfig(ip, port, hostname);
    setLocalConfigLoading(null);
  };

  const generateLocalConfigScript = (ip: string, hostname: string) => {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Config Local - Control iD</title>
<style>body{font-family:system-ui;max-width:500px;margin:40px auto;padding:20px}
.log{background:#f5f5f5;padding:12px;border-radius:8px;margin:12px 0;font-size:14px;white-space:pre-wrap}
.ok{color:green}.err{color:red}.info{color:#666}
h2{margin:0 0 16px}button{padding:8px 16px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:14px}
button:hover{background:#2563eb}</style></head>
<body><h2>⚙️ Configuração Local - Control iD</h2>
<p>Dispositivo: <strong>${ip}</strong></p>
<p>Servidor: <strong>${hostname}</strong></p>
<div id="log" class="log"><span class="info">Clique em Configurar para iniciar...</span></div>
<button onclick="run()">Configurar</button>
<script>
const log = document.getElementById('log');
function addLog(msg, cls) { log.innerHTML += '\\n<span class="'+cls+'">'+msg+'</span>'; }
async function run() {
  log.innerHTML = '<span class="info">Iniciando...</span>';
  try {
    addLog('1. Fazendo login...', 'info');
    const lr = await fetch('http://${ip}/login.fcgi', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'admin',password:'admin'})});
    if (!lr.ok) throw new Error('Login falhou: ' + lr.status);
    const ld = await lr.json();
    const s = ld.session;
    if (!s) throw new Error('Sessão não retornada');
    addLog('✓ Login OK (session: '+s+')', 'ok');
    
    addLog('2. Aplicando configuração...', 'info');
    const cfg = {monitor:{request_timeout:'5000',hostname:'${hostname}',port:'443',path:'functions/v1/controlid-webhook'},push_server:{push_remote_address:'https://${hostname}/functions/v1/controlid-webhook/push',push_request_timeout:'30000',push_request_period:'5'}};
    const cr = await fetch('http://${ip}/set_configuration.fcgi?session='+s, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
    if (!cr.ok) throw new Error('Erro ao aplicar: ' + cr.status);
    addLog('✓ Configuração aplicada!', 'ok');
    
    addLog('3. Verificando...', 'info');
    const vr = await fetch('http://${ip}/get_configuration.fcgi?session='+s, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({monitor:true,push_server:true})});
    if (vr.ok) { const vd = await vr.json(); addLog('✓ Monitor hostname: '+(vd.monitor?.hostname||'?'), 'ok'); addLog('✓ Push address: '+(vd.push_server?.push_remote_address||'?'), 'ok'); }
    
    addLog('\\n🎉 Configuração concluída com sucesso!', 'ok');
  } catch(e) { addLog('✗ Erro: '+e.message, 'err'); }
}
</script></body></html>`;
  };

  const executeLocalConfig = async (ip: string, port: string, hostname: string) => {
    const monitorConfig = {
      monitor: {
        request_timeout: '5000',
        hostname: hostname,
        port: '443',
        path: 'functions/v1/controlid-webhook',
      },
    };

    const pushConfig = {
      push_server: {
        push_remote_address: `https://${hostname}/functions/v1/controlid-webhook/push`,
        push_request_timeout: '30000',
        push_request_period: '5',
      },
    };

    const fullConfig = { ...monitorConfig, ...pushConfig };

    try {
      const loginResp = await fetch(`http://${ip}:${port}/login.fcgi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'admin', password: 'admin' }),
      });

      if (!loginResp.ok) {
        throw new Error(`Login falhou (status ${loginResp.status}). Verifique as credenciais.`);
      }

      const loginData = await loginResp.json();
      const session = loginData.session;
      if (!session) throw new Error('Sessão não retornada pelo dispositivo');

      const configResp = await fetch(`http://${ip}:${port}/set_configuration.fcgi?session=${session}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullConfig),
      });

      if (!configResp.ok) {
        throw new Error(`Erro ao aplicar configuração (status ${configResp.status})`);
      }

      let verifyData: any = null;
      try {
        const verifyResp = await fetch(`http://${ip}:${port}/get_configuration.fcgi?session=${session}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitor: true, push_server: true }),
        });
        if (verifyResp.ok) verifyData = await verifyResp.json();
      } catch { /* ignore */ }

      const appliedHostname = verifyData?.monitor?.hostname || '';
      const appliedPush = verifyData?.push_server?.push_remote_address || '';

      toast.success('Configuração aplicada com sucesso via rede local!', {
        duration: 6000,
        description: `Monitor: ${appliedHostname || hostname} | Push: ${appliedPush ? 'OK' : 'verificar'}`,
      });
    } catch (err: any) {
      console.error('Error configuring device locally:', err);
      toast.error('Erro ao configurar dispositivo via rede local', {
        duration: 6000,
        description: err.message || 'Verifique se o dispositivo está acessível na rede.',
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const isNew = !editingId;
    const deviceData: Device = {
      id: editingId || `dev_${Date.now()}`,
      ...formData,
      lastSync: new Date().toISOString(),
    };

    const success = await saveDevice(deviceData);
    if (success) {
      resetForm();
      // Auto-sync config for new devices with serial number
      if (isNew && deviceData.serialNumber) {
        toast.info('Sincronizando configuração automaticamente...');
        await handlePushConfig(deviceData);
      }
    }
  };

  const handleEdit = (device: Device) => {
    setEditingId(device.id);
    setFormData({
      name: device.name,
      type: device.type,
      location: device.location,
      status: device.status,
      ipAddress: device.ipAddress || '',
      serialNumber: device.serialNumber || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente excluir este dispositivo?')) return;
    await deleteDevice(id);
  };

  const toggleStatus = async (id: string) => {
    const device = devices.find(d => d.id === id);
    if (!device) return;
    
    const updatedDevice: Device = {
      ...device,
      status: device.status === 'online' ? 'offline' : 'online',
      lastSync: new Date().toISOString()
    };
    
    await saveDevice(updatedDevice);
  };

  const resetForm = () => {
    setEditingId('');
    setFormData({
      name: '',
      type: 'facial_recognition',
      location: '',
      status: 'online',
      ipAddress: '',
      serialNumber: '',
    });
    setShowForm(false);
  };

  const getDeviceIcon = (type: Device['type']) => {
    switch (type) {
      case 'facial_recognition':
        return <Camera className="h-5 w-5" />;
      case 'vehicle_tag':
        return <Tag className="h-5 w-5" />;
      case 'card_reader':
        return <CreditCard className="h-5 w-5" />;
    }
  };

  const getDeviceTypeName = (type: Device['type']) => {
    switch (type) {
      case 'facial_recognition':
        return 'Reconhecimento Facial';
      case 'vehicle_tag':
        return 'TAG Veicular';
      case 'card_reader':
        return 'Leitor de Cartão';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Dispositivos</h2>
          <p className="text-muted-foreground">Gerencie os dispositivos de controle de acesso</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Dispositivo
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Editar Dispositivo' : 'Novo Dispositivo'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome do Dispositivo *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Portaria Principal"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">Tipo *</Label>
                  <Select 
                    value={formData.type} 
                    onValueChange={(value: Device['type']) => setFormData({ ...formData, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facial_recognition">📷 Reconhecimento Facial</SelectItem>
                      <SelectItem value="vehicle_tag">🏷️ TAG Veicular</SelectItem>
                      <SelectItem value="card_reader">💳 Leitor de Cartão</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Localização *</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="Ex: Portaria 1, Garagem, etc."
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status *</Label>
                  <Select 
                    value={formData.status} 
                    onValueChange={(value: Device['status']) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="online">🟢 Online</SelectItem>
                      <SelectItem value="offline">🔴 Offline</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ipAddress">Endereço IP</Label>
                  <Input
                    id="ipAddress"
                    value={formData.ipAddress}
                    onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                    placeholder="192.168.1.100"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serialNumber">Número de Série</Label>
                  <Input
                    id="serialNumber"
                    value={formData.serialNumber}
                    onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                    placeholder="SN12345678"
                  />
                </div>
              </div>

              <div className="flex space-x-2">
                <Button type="submit" className="flex-1">
                  {editingId ? 'Salvar Alterações' : 'Cadastrar Dispositivo'}
                </Button>
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">
                Nenhum dispositivo cadastrado. Clique em "Novo Dispositivo" para começar.
              </p>
            </CardContent>
          </Card>
        ) : (
          devices.map((device) => (
            <Card key={device.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <div className={`p-2 rounded-lg ${device.status === 'online' ? 'bg-success/20' : 'bg-destructive/20'}`}>
                      {getDeviceIcon(device.type)}
                    </div>
                    <div>
                      <CardTitle className="text-lg">{device.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">{getDeviceTypeName(device.type)}</p>
                    </div>
                  </div>
                  <Badge variant={device.status === 'online' ? 'default' : 'destructive'}>
                    {device.status === 'online' ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
                    {device.status === 'online' ? 'Online' : 'Offline'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Localização:</span>
                    <span className="font-medium">{device.location}</span>
                  </div>
                  {device.ipAddress && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">IP:</span>
                      <span className="font-mono text-xs">{device.ipAddress}</span>
                    </div>
                  )}
                  {device.serialNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Série:</span>
                      <span className="font-mono text-xs">{device.serialNumber}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Última Sync:</span>
                    <span className="text-xs">{new Date(device.lastSync).toLocaleString('pt-BR')}</span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePushConfig(device)}
                    disabled={pushingConfig === device.id}
                    className="flex-1"
                    title="Enviar configuração do monitor ao dispositivo via Push"
                  >
                    {pushingConfig === device.id ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Settings2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    Enviar Config
                  </Button>
                  {device.ipAddress && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleLocalConfig(device)}
                      disabled={localConfigLoading === device.id}
                      className="flex-1"
                      title="Configurar via rede local (navegador → dispositivo)"
                    >
                      {localConfigLoading === device.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Network className="h-3.5 w-3.5 mr-1" />
                      )}
                      Config Local
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleStatus(device.id)}
                    className="flex-1"
                  >
                    {device.status === 'online' ? 'Desativar' : 'Ativar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(device)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(device.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};
