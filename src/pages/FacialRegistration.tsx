import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScanFace, Wifi, WifiOff, Loader2, User, Tag, Search, CheckCircle2, XCircle, Camera } from 'lucide-react';
import { useDevices } from '@/hooks/useDevices';
import { useResidents } from '@/hooks/useResidents';
import { Device, Resident } from '@/types';
import { toast } from 'sonner';

type RegistrationMode = 'facial' | 'tag';

interface EnrollmentStep {
  status: 'idle' | 'connecting' | 'authenticating' | 'enrolling' | 'success' | 'error';
  message: string;
}

export const FacialRegistration = () => {
  const { devices, loading: devicesLoading } = useDevices();
  const { residents, loading: residentsLoading } = useResidents();
  const [mode, setMode] = useState<RegistrationMode>('facial');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedResidentId, setSelectedResidentId] = useState('');
  const [searchResident, setSearchResident] = useState('');
  const [enrollStep, setEnrollStep] = useState<EnrollmentStep>({ status: 'idle', message: '' });
  const [tagCode, setTagCode] = useState('');

  // Filter devices by type
  const facialDevices = devices.filter(d => d.type === 'facial_recognition');
  const tagDevices = devices.filter(d => d.type === 'vehicle_tag' || d.type === 'card_reader');
  const availableDevices = mode === 'facial' ? facialDevices : tagDevices;

  // Filter residents by search
  const filteredResidents = residents.filter(r =>
    r.name.toLowerCase().includes(searchResident.toLowerCase()) ||
    r.apartment.toLowerCase().includes(searchResident.toLowerCase()) ||
    (r.cpf && r.cpf.includes(searchResident))
  );

  const selectedDevice = devices.find(d => d.id === selectedDeviceId);
  const selectedResident = residents.find(r => r.id === selectedResidentId);

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

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
    if (!selectedDevice || !selectedResident) return;
    if (!selectedDevice.ipAddress) {
      toast.error('Dispositivo sem IP configurado. Configure o IP na tela de Dispositivos.');
      return;
    }

    setEnrollStep({ status: 'connecting', message: 'Conectando ao dispositivo...' });

    try {
      // 1. Login
      setEnrollStep({ status: 'authenticating', message: 'Autenticando no dispositivo...' });
      const loginRes = await callDeviceApi(selectedDevice, 'login.fcgi', { login: 'admin', password: 'admin' });
      const session = loginRes.session;
      if (!session) throw new Error('Falha na autenticação');

      // 2. Create or update user on device
      setEnrollStep({ status: 'enrolling', message: `Cadastrando usuário ${selectedResident.name}...` });

      // Use resident ID as user_id on device (numeric hash)
      const userId = Math.abs(hashCode(selectedResident.id)) % 1000000000;

      await callDeviceApi(selectedDevice, `create_objects.fcgi?session=${session}`, {
        object: 'users',
        values: [
          {
            id: userId,
            name: `${selectedResident.apartment} - ${selectedResident.name}`,
            registration: selectedResident.cpf || selectedResident.id.slice(0, 8),
            begin_time: 0,
            end_time: 0,
          }
        ]
      });

      // 3. Trigger facial capture on device
      setEnrollStep({ status: 'enrolling', message: 'Iniciando captura facial no dispositivo... Posicione o rosto em frente ao equipamento.' });

      await callDeviceApi(selectedDevice, `remote_enroll.fcgi?session=${session}`, {
        user_id: userId,
        type: 'face',
        save: true,
        panic: false,
      });

      setEnrollStep({ status: 'success', message: `Cadastro facial de ${selectedResident.name} iniciado! Acompanhe no dispositivo.` });
      toast.success('Captura facial iniciada no dispositivo!', {
        description: 'O morador deve posicionar o rosto em frente ao equipamento.',
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
    if (!selectedDevice || !selectedResident) return;
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

      const userId = Math.abs(hashCode(selectedResident.id)) % 1000000000;

      // Create user
      setEnrollStep({ status: 'enrolling', message: 'Cadastrando usuário...' });
      await callDeviceApi(selectedDevice, `create_objects.fcgi?session=${session}`, {
        object: 'users',
        values: [
          {
            id: userId,
            name: `${selectedResident.apartment} - ${selectedResident.name}`,
            registration: selectedResident.cpf || selectedResident.id.slice(0, 8),
            begin_time: 0,
            end_time: 0,
          }
        ]
      });

      // Register card/tag
      setEnrollStep({ status: 'enrolling', message: 'Vinculando tag/cartão...' });
      await callDeviceApi(selectedDevice, `create_objects.fcgi?session=${session}`, {
        object: 'cards',
        values: [
          {
            value: parseInt(tagCode, 10) || tagCode,
            user_id: userId,
          }
        ]
      });

      setEnrollStep({ status: 'success', message: `Tag ${tagCode} vinculada a ${selectedResident.name} com sucesso!` });
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

        {/* Resident Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. Selecione o Morador</CardTitle>
            <CardDescription>Busque por nome, apartamento ou CPF</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar morador..."
                value={searchResident}
                onChange={(e) => setSearchResident(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2">
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
          </CardContent>
        </Card>
      </div>

      {/* Tag Code Input (only for tag mode) */}
      {mode === 'tag' && selectedDevice && selectedResident && (
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
      {selectedDevice && selectedResident && (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center gap-4">
              {enrollStep.status === 'idle' && (
                <>
                  <p className="text-muted-foreground text-center">
                    {mode === 'facial'
                      ? `Pronto para cadastrar o rosto de ${selectedResident.name} no dispositivo ${selectedDevice.name}`
                      : `Pronto para vincular tag ao morador ${selectedResident.name} no dispositivo ${selectedDevice.name}`
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
