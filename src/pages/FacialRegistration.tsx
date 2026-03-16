import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScanFace, Wifi, WifiOff, Loader2, User, Tag, Search, CheckCircle2, XCircle, Camera, Wrench, Building2, RefreshCw, Download, UserCheck } from 'lucide-react';
import { useDevices } from '@/hooks/useDevices';
import { useResidents } from '@/hooks/useResidents';
import { Device, Resident } from '@/types';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

type RegistrationMode = 'facial' | 'tag';
type PersonType = 'resident' | 'service_provider';

interface EnrollmentStep {
  status: 'idle' | 'connecting' | 'authenticating' | 'enrolling' | 'success' | 'error';
  message: string;
}

interface ServiceProvider {
  name: string;
  document: string;
  company: string;
}

export const FacialRegistration = () => {
  const { devices, loading: devicesLoading } = useDevices();
  const { residents, loading: residentsLoading } = useResidents();
  const [mode, setMode] = useState<RegistrationMode>('facial');
  const [personType, setPersonType] = useState<PersonType>('resident');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedResidentId, setSelectedResidentId] = useState('');
  const [searchResident, setSearchResident] = useState('');
  const [enrollStep, setEnrollStep] = useState<EnrollmentStep>({ status: 'idle', message: '' });
  const [tagCode, setTagCode] = useState('');
  const [serviceProvider, setServiceProvider] = useState<ServiceProvider>({ name: '', document: '', company: '' });
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResults, setSyncResults] = useState<Array<{ userId: number; name: string; registration: string; hasPhoto: boolean; matchedResident?: Resident; photoImported?: boolean }>>([]);
  const [importingPhoto, setImportingPhoto] = useState<string | null>(null);

  const facialDevices = devices.filter(d => d.type === 'facial_recognition');
  const tagDevices = devices.filter(d => d.type === 'vehicle_tag' || d.type === 'card_reader');
  const availableDevices = mode === 'facial' ? facialDevices : tagDevices;

  const filteredResidents = residents.filter(r =>
    r.name.toLowerCase().includes(searchResident.toLowerCase()) ||
    r.apartment.toLowerCase().includes(searchResident.toLowerCase()) ||
    (r.cpf && r.cpf.includes(searchResident))
  );

  const selectedDevice = devices.find(d => d.id === selectedDeviceId);
  const selectedResident = residents.find(r => r.id === selectedResidentId);

  const isPersonSelected = personType === 'resident' ? !!selectedResident : (serviceProvider.name.trim() !== '' && serviceProvider.document.trim() !== '');

  const getPersonName = () => {
    if (personType === 'resident' && selectedResident) return selectedResident.name;
    if (personType === 'service_provider') return serviceProvider.name;
    return '';
  };

  const getPersonLabel = () => {
    if (personType === 'resident' && selectedResident) return `${selectedResident.apartment} - ${selectedResident.name}`;
    if (personType === 'service_provider') return `${serviceProvider.company || 'Prestador'} - ${serviceProvider.name}`;
    return '';
  };

  const getPersonRegistration = () => {
    if (personType === 'resident' && selectedResident) return selectedResident.cpf || selectedResident.id.slice(0, 8);
    if (personType === 'service_provider') return serviceProvider.document;
    return '';
  };

  const getPersonHashId = () => {
    if (personType === 'resident' && selectedResident) return selectedResident.id;
    if (personType === 'service_provider') return `sp-${serviceProvider.document}`;
    return '';
  };

  const callDeviceApi = async (device: Device, endpoint: string, body?: any) => {
    const ip = device.ipAddress;
    if (!ip) throw new Error('Dispositivo sem IP configurado');
    const url = `http://${ip}/${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const handleFacialEnroll = async () => {
    if (!selectedDevice || !isPersonSelected) return;
    if (!selectedDevice.ipAddress) {
      toast.error('Dispositivo sem IP configurado. Configure o IP na tela de Dispositivos.');
      return;
    }

    setEnrollStep({ status: 'connecting', message: 'Conectando ao dispositivo...' });

    try {
      setEnrollStep({ status: 'authenticating', message: 'Autenticando no dispositivo...' });
      const loginRes = await callDeviceApi(selectedDevice, 'login.fcgi', { login: 'admin', password: 'admin' });
      const session = loginRes.session;
      if (!session) throw new Error('Falha na autenticação');

      const personName = getPersonName();
      setEnrollStep({ status: 'enrolling', message: `Cadastrando usuário ${personName}...` });

      const userId = Math.abs(hashCode(getPersonHashId())) % 1000000000;

      await callDeviceApi(selectedDevice, `create_objects.fcgi?session=${session}`, {
        object: 'users',
        values: [{
          id: userId,
          name: getPersonLabel(),
          registration: getPersonRegistration(),
          begin_time: 0,
          end_time: 0,
        }]
      });

      setEnrollStep({ status: 'enrolling', message: 'Iniciando captura facial no dispositivo... Posicione o rosto em frente ao equipamento.' });

      await callDeviceApi(selectedDevice, `remote_enroll.fcgi?session=${session}`, {
        user_id: userId,
        type: 'face',
        save: true,
        panic: false,
      });

      setEnrollStep({ status: 'success', message: `Cadastro facial de ${personName} iniciado! Acompanhe no dispositivo.` });
      toast.success('Captura facial iniciada no dispositivo!', {
        description: 'Posicione o rosto em frente ao equipamento.',
        duration: 8000,
      });
    } catch (err: any) {
      console.error('Facial enrollment error:', err);
      const isNetworkError = err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError');
      setEnrollStep({
        status: 'error',
        message: isNetworkError
          ? 'Não foi possível conectar ao dispositivo. Verifique se você está na mesma rede local.'
          : `Erro: ${err.message}`,
      });
      toast.error('Erro no cadastro facial', { description: err.message });
    }
  };

  const handleTagEnroll = async () => {
    if (!selectedDevice || !isPersonSelected) return;
    if (!selectedDevice.ipAddress) {
      toast.error('Dispositivo sem IP configurado.');
      return;
    }
    if (!tagCode.trim()) {
      toast.error('Informe o código da tag/cartão.');
      return;
    }

    setEnrollStep({ status: 'connecting', message: 'Conectando ao dispositivo...' });

    try {
      setEnrollStep({ status: 'authenticating', message: 'Autenticando...' });
      const loginRes = await callDeviceApi(selectedDevice, 'login.fcgi', { login: 'admin', password: 'admin' });
      const session = loginRes.session;
      if (!session) throw new Error('Falha na autenticação');

      const userId = Math.abs(hashCode(getPersonHashId())) % 1000000000;

      setEnrollStep({ status: 'enrolling', message: 'Cadastrando usuário...' });
      await callDeviceApi(selectedDevice, `create_objects.fcgi?session=${session}`, {
        object: 'users',
        values: [{
          id: userId,
          name: getPersonLabel(),
          registration: getPersonRegistration(),
          begin_time: 0,
          end_time: 0,
        }]
      });

      setEnrollStep({ status: 'enrolling', message: 'Vinculando tag/cartão...' });
      await callDeviceApi(selectedDevice, `create_objects.fcgi?session=${session}`, {
        object: 'cards',
        values: [{
          value: parseInt(tagCode, 10) || tagCode,
          user_id: userId,
        }]
      });

      setEnrollStep({ status: 'success', message: `Tag ${tagCode} vinculada a ${getPersonName()} com sucesso!` });
      toast.success('Tag/cartão cadastrado!');
    } catch (err: any) {
      console.error('Tag enrollment error:', err);
      setEnrollStep({ status: 'error', message: `Erro: ${err.message}` });
      toast.error('Erro no cadastro de tag', { description: err.message });
    }
  };

  const resetEnroll = () => {
    setEnrollStep({ status: 'idle', message: '' });
  };

  const parsePushJson = (value: unknown) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;

    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  };

  const normalizePushResult = (result: any) => {
    const parsedResponse = parsePushJson(result?.response);
    const parsedRawData = parsePushJson(result?.raw_data);

    return {
      ...(result && typeof result === 'object' ? result : {}),
      ...(parsedRawData && typeof parsedRawData === 'object' ? parsedRawData : {}),
      ...(parsedResponse && typeof parsedResponse === 'object' ? parsedResponse : {}),
      ...(result?.raw_data && typeof result.raw_data === 'object' ? result.raw_data : {}),
      ...(result?.response && typeof result.response === 'object' ? result.response : {}),
      ...(result?.result && typeof result.result === 'object' ? result.result : {}),
    };
  };

  const extractPushImage = (result: any) => {
    const normalized = normalizePushResult(result);
    return normalized?.image || normalized?.photo || normalized?.user_image || normalized?.face_image || normalized?.photo_data || normalized?.user_image_data || null;
  };

  // Helper: queue a push command and wait for result
  const queueCommandAndWait = async (deviceSerial: string, endpoint: string, body: any, timeoutMs = 30000): Promise<any> => {
    const { data: inserted, error: insertErr } = await supabase
      .from('push_command_queue')
      .insert({
        device_id: deviceSerial,
        command: {
          verb: 'POST',
          endpoint,
          body,
          contentType: 'application/json',
        },
        status: 'pending',
      } as any)
      .select('id')
      .single();

    if (insertErr || !inserted) throw new Error('Falha ao enfileirar comando: ' + (insertErr?.message || 'unknown'));

    const commandId = inserted.id;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const { data: cmd } = await supabase
        .from('push_command_queue')
        .select('status, result')
        .eq('id', commandId)
        .single();

      if (cmd?.status === 'done') {
        return normalizePushResult(cmd.result);
      }

      if (cmd?.status === 'error') {
        const errorResult = normalizePushResult(cmd.result);
        throw new Error(errorResult?.message || errorResult?.error || 'Comando retornou erro do dispositivo');
      }
    }

    throw new Error('Timeout: o dispositivo não respondeu a tempo. Verifique se está online.');
  };

  const getDeviceSerial = (device: Device): string => {
    // Use serial_number for push queue device_id matching
    return device.serialNumber || device.id;
  };

  const handleSyncFromDevice = async () => {
    if (!selectedDevice) {
      toast.error('Selecione um dispositivo.');
      return;
    }
    
    const deviceSerial = getDeviceSerial(selectedDevice);
    if (!deviceSerial) {
      toast.error('Dispositivo sem número de série configurado.');
      return;
    }

    setSyncLoading(true);
    setSyncResults([]);

    try {
      toast.info('Enviando comando ao dispositivo via fila push...', {
        description: 'Aguardando o dispositivo buscar e executar o comando.',
        duration: 5000,
      });

      // Queue load_objects for users
      const usersResult = await queueCommandAndWait(deviceSerial, 'load_objects', { object: 'users' }, 60000);
      const deviceUsers: Array<{ id: number; name: string; registration: string }> = usersResult?.users || [];

      if (deviceUsers.length === 0) {
        toast.info('Nenhum usuário cadastrado neste dispositivo.');
        setSyncLoading(false);
        return;
      }

      toast.info(`${deviceUsers.length} usuários encontrados. Buscando dados de biometria...`);

      // Queue load_objects for templates
      const templatesResult = await queueCommandAndWait(deviceSerial, 'load_objects', { object: 'templates' }, 60000);
      const templates: Array<{ user_id: number }> = templatesResult?.templates || [];
      const usersWithFace = new Set(templates.map(t => t.user_id));

      // Match with residents by hash
      const results = deviceUsers.map(du => {
        const matchedResident = residents.find(r => {
          const residentHashId = Math.abs(hashCode(r.id)) % 1000000000;
          return residentHashId === du.id;
        });
        return {
          userId: du.id,
          name: du.name,
          registration: du.registration || '',
          hasPhoto: usersWithFace.has(du.id),
          matchedResident,
          photoImported: false,
        };
      });

      setSyncResults(results);
      toast.success(`${results.length} usuários encontrados, ${results.filter(r => r.hasPhoto).length} com facial cadastrada.`);
    } catch (err: any) {
      console.error('Sync error:', err);
      toast.error('Erro na sincronização', {
        description: err.message,
        duration: 8000,
      });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleImportPhoto = async (deviceUserId: number, resident: Resident) => {
    if (!selectedDevice) return;
    setImportingPhoto(resident.id);

    try {
      const deviceSerial = getDeviceSerial(selectedDevice);

      toast.info('Solicitando foto ao dispositivo...', { duration: 3000 });

      // Queue user_get_image command
      const photoResult = await queueCommandAndWait(deviceSerial, 'user_get_image', { user_id: deviceUserId }, 60000);

      const base64Image = extractPushImage(photoResult);

      if (!base64Image) {
        throw new Error('O dispositivo não retornou a foto. Verifique se o firmware suporta exportação de imagem via push.');
      }

      // Decode base64 to blob
      const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
      const binaryString = atob(cleanBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/jpeg' });

      if (blob.size < 100) throw new Error('Foto vazia ou inválida');

      // Upload to Supabase Storage
      const fileName = `facial_${Date.now()}.jpg`;
      const filePath = `${resident.id}/${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('resident-photos')
        .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      // Update sync results
      setSyncResults(prev => prev.map(r => 
        r.userId === deviceUserId ? { ...r, photoImported: true } : r
      ));

      toast.success(`Foto de ${resident.name} importada com sucesso!`);
    } catch (err: any) {
      console.error('Import photo error:', err);
      toast.error(`Erro ao importar foto: ${err.message}`);
    } finally {
      setImportingPhoto(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScanFace className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cadastro Biométrico</h1>
          <p className="text-muted-foreground text-sm">Cadastre faces e tags nos dispositivos Control iD</p>
        </div>
      </div>

      {/* Mode Selection */}
      <div className="grid grid-cols-2 gap-4">
        <Card
          className={`cursor-pointer transition-all border-2 ${mode === 'facial' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
          onClick={() => { setMode('facial'); setSelectedDeviceId(''); resetEnroll(); }}
        >
          <CardContent className="flex items-center gap-4 p-6">
            <Camera className="h-10 w-10 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Cadastro Facial</p>
              <p className="text-sm text-muted-foreground">Reconhecimento facial via câmera</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all border-2 ${mode === 'tag' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
          onClick={() => { setMode('tag'); setSelectedDeviceId(''); resetEnroll(); }}
        >
          <CardContent className="flex items-center gap-4 p-6">
            <Tag className="h-10 w-10 text-primary" />
            <div>
              <p className="font-semibold text-foreground">Cadastro de Tag</p>
              <p className="text-sm text-muted-foreground">Cartão ou tag RFID</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Device Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. Selecione o Dispositivo</CardTitle>
            <CardDescription>
              {mode === 'facial' ? 'Dispositivos de reconhecimento facial' : 'Leitoras de cartão/tag'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {devicesLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : availableDevices.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhum dispositivo {mode === 'facial' ? 'de reconhecimento facial' : 'de tag/cartão'} cadastrado.
                Cadastre na tela de Dispositivos.
              </p>
            ) : (
              availableDevices.map((device) => (
                <button
                  key={device.id}
                  onClick={() => { setSelectedDeviceId(device.id); resetEnroll(); }}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                    selectedDeviceId === device.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  {device.status === 'online' ? (
                    <Wifi className="h-5 w-5 text-green-500 shrink-0" />
                  ) : (
                    <WifiOff className="h-5 w-5 text-destructive shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{device.name}</p>
                    <p className="text-xs text-muted-foreground">{device.location}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {device.ipAddress ? (
                      <Badge variant="outline" className="text-xs">{device.ipAddress}</Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs">Sem IP</Badge>
                    )}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Person Selection with Tabs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. Selecione a Pessoa</CardTitle>
            <CardDescription>Escolha o tipo de cadastro</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Tabs value={personType} onValueChange={(v) => { setPersonType(v as PersonType); setSelectedResidentId(''); setServiceProvider({ name: '', document: '', company: '' }); resetEnroll(); }}>
              <TabsList className="w-full">
                <TabsTrigger value="resident" className="flex-1 gap-2">
                  <User className="h-4 w-4" /> Morador
                </TabsTrigger>
                <TabsTrigger value="service_provider" className="flex-1 gap-2">
                  <Wrench className="h-4 w-4" /> Prestador Fixo
                </TabsTrigger>
              </TabsList>

              <TabsContent value="resident" className="space-y-3 mt-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar morador..."
                    value={searchResident}
                    onChange={(e) => setSearchResident(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {residentsLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-4">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                    </div>
                  ) : filteredResidents.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4 text-center">Nenhum morador encontrado.</p>
                  ) : (
                    filteredResidents.slice(0, 20).map((resident) => (
                      <button
                        key={resident.id}
                        onClick={() => { setSelectedResidentId(resident.id); resetEnroll(); }}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                          selectedResidentId === resident.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/30'
                        }`}
                      >
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground text-sm truncate">{resident.name}</p>
                          <p className="text-xs text-muted-foreground">Apto {resident.apartment}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="service_provider" className="space-y-4 mt-3">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="sp-name">Nome Completo *</Label>
                    <Input
                      id="sp-name"
                      placeholder="Nome do prestador"
                      value={serviceProvider.name}
                      onChange={(e) => setServiceProvider(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="sp-doc">CPF / Documento *</Label>
                    <Input
                      id="sp-doc"
                      placeholder="000.000.000-00"
                      value={serviceProvider.document}
                      onChange={(e) => setServiceProvider(prev => ({ ...prev, document: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="sp-company">Empresa</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="sp-company"
                        placeholder="Nome da empresa"
                        value={serviceProvider.company}
                        onChange={(e) => setServiceProvider(prev => ({ ...prev, company: e.target.value }))}
                        className="pl-10"
                      />
                    </div>
                  </div>
                </div>
                {serviceProvider.name && serviceProvider.document && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">{serviceProvider.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {serviceProvider.company && `${serviceProvider.company} • `}{serviceProvider.document}
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Tag Code Input (only for tag mode) */}
      {mode === 'tag' && selectedDevice && isPersonSelected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">3. Código da Tag/Cartão</CardTitle>
            <CardDescription>Informe o número da tag RFID ou cartão de proximidade</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label htmlFor="tagCode">Código</Label>
                <Input
                  id="tagCode"
                  placeholder="Ex: 1234567890"
                  value={tagCode}
                  onChange={(e) => setTagCode(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action & Status */}
      {selectedDevice && isPersonSelected && (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center gap-4">
              {enrollStep.status === 'idle' && (
                <>
                  <p className="text-muted-foreground text-center">
                    {mode === 'facial'
                      ? `Pronto para cadastrar o rosto de ${getPersonName()} no dispositivo ${selectedDevice.name}`
                      : `Pronto para vincular tag a ${getPersonName()} no dispositivo ${selectedDevice.name}`
                    }
                  </p>
                  <Button
                    size="lg"
                    onClick={mode === 'facial' ? handleFacialEnroll : handleTagEnroll}
                    disabled={mode === 'tag' && !tagCode.trim()}
                  >
                    {mode === 'facial' ? (
                      <><ScanFace className="mr-2 h-5 w-5" /> Iniciar Cadastro Facial</>
                    ) : (
                      <><Tag className="mr-2 h-5 w-5" /> Vincular Tag/Cartão</>
                    )}
                  </Button>
                </>
              )}

              {(enrollStep.status === 'connecting' || enrollStep.status === 'authenticating' || enrollStep.status === 'enrolling') && (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-foreground font-medium">{enrollStep.message}</p>
                </div>
              )}

              {enrollStep.status === 'success' && (
                <div className="flex flex-col items-center gap-3">
                  <CheckCircle2 className="h-12 w-12 text-green-500" />
                  <p className="text-foreground font-medium text-center">{enrollStep.message}</p>
                  <Button variant="outline" onClick={resetEnroll}>Novo Cadastro</Button>
                </div>
              )}

              {enrollStep.status === 'error' && (
                <div className="flex flex-col items-center gap-3">
                  <XCircle className="h-12 w-12 text-destructive" />
                  <p className="text-destructive font-medium text-center">{enrollStep.message}</p>
                  <Button variant="outline" onClick={resetEnroll}>Tentar Novamente</Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync Section */}
      {mode === 'facial' && selectedDevice && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <RefreshCw className="h-5 w-5" /> Sincronizar do Dispositivo
                </CardTitle>
                <CardDescription>
                   Buscar usuários cadastrados no dispositivo via fila push (sem necessidade de acesso direto ao IP)
                </CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={handleSyncFromDevice}
                disabled={syncLoading}
              >
                {syncLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                {syncLoading ? 'Buscando...' : 'Buscar Usuários'}
              </Button>
            </div>
          </CardHeader>
          {syncResults.length > 0 && (
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {syncResults.map((result) => (
                  <div
                    key={result.userId}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-muted text-muted-foreground">
                        {result.hasPhoto ? <Camera className="h-4 w-4" /> : <User className="h-4 w-4" />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground text-sm truncate">{result.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {result.registration && (
                          <span className="text-xs text-muted-foreground">{result.registration}</span>
                        )}
                        {result.hasPhoto ? (
                          <Badge variant="default" className="text-xs">Facial ✓</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Sem facial</Badge>
                        )}
                        {result.matchedResident && (
                          <Badge variant="outline" className="text-xs">
                            <UserCheck className="h-3 w-3 mr-1" />
                            Apto {result.matchedResident.apartment}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {result.photoImported ? (
                        <Badge variant="default" className="text-xs gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Importada
                        </Badge>
                      ) : result.hasPhoto && result.matchedResident ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleImportPhoto(result.userId, result.matchedResident!)}
                          disabled={importingPhoto === result.matchedResident.id}
                        >
                          {importingPhoto === result.matchedResident.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <><Download className="h-4 w-4 mr-1" /> Importar Foto</>
                          )}
                        </Button>
                      ) : !result.matchedResident ? (
                        <span className="text-xs text-muted-foreground">Sem vínculo</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {syncResults.filter(r => r.hasPhoto).length} com facial • {syncResults.filter(r => r.matchedResident).length} vinculados a moradores
              </p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
};

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

export default FacialRegistration;
