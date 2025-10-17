import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LogIn, LogOut, Camera, Upload, X, Plus } from 'lucide-react';
import { storage } from '@/lib/storage';
import { AccessEntry, Resident } from '@/types';
import { toast } from 'sonner';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

export const NewRegistry = () => {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [visitedLocationSearch, setVisitedLocationSearch] = useState('');
  const [showResidentSuggestions, setShowResidentSuggestions] = useState(false);
  const itemsPerPage = 12;
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
    photo: '',
  });
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [suggestions, setSuggestions] = useState<AccessEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setResidents(storage.getResidents());
    setEntries(storage.getEntries().filter((e) => !e.exitTime));
  };

  const activeEntries = entries.filter(e => !e.exitTime).reverse();
  const totalPages = Math.ceil(activeEntries.length / itemsPerPage);
  const paginatedEntries = activeEntries.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const filteredResidents = residents.filter(r => 
    r.name.toLowerCase().includes(visitedLocationSearch.toLowerCase()) ||
    r.apartment.toLowerCase().includes(visitedLocationSearch.toLowerCase())
  );

  const handleVisitedLocationSelect = (residentId: string, residentName: string, apartment: string) => {
    setVisitedLocationSearch(`${residentName} - ${apartment}`);
    setFormData({ ...formData, residentId });
    setShowResidentSuggestions(false);
  };

  const findSimilarEntries = (name: string, document: string) => {
    if (!name && !document) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const allEntries = storage.getEntries();
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
      photo: entry.photo || '',
    });
    setShowSuggestions(false);
    toast.success('Dados preenchidos automaticamente!');
    storage.addEvent({
      type: 'entry',
      description: `Sistema reconheceu visitante: ${entry.visitorName}`,
      priority: 'low',
    });
  };

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setShowCamera(true);
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
        setFormData({ ...formData, photo: photoData });
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
        setFormData({ ...formData, photo: reader.result as string });
        toast.success('Foto carregada com sucesso!');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEntry = (e: React.FormEvent) => {
    e.preventDefault();

    const resident = residents.find((r) => r.id === formData.residentId);
    if (!resident) {
      toast.error('Selecione um morador válido');
      return;
    }

    const entry: AccessEntry = {
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
      autoRecognized: showSuggestions && suggestions.length > 0,
    };

    const allEntries = storage.getEntries();
    const updatedEntries = [...allEntries, entry];
    storage.saveEntries(updatedEntries);
    
    storage.addEvent({
      type: 'entry',
      description: `${formData.visitorType === 'visitor' ? 'Visitante' : 'Prestador'} registrado: ${formData.visitorName} - ${resident.apartment}`,
      priority: 'medium',
      relatedId: entry.id,
    });

    setEntries(updatedEntries.filter((e) => !e.exitTime));
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
      photo: '',
    });
    setVisitedLocationSearch('');
    setSuggestions([]);
    setShowSuggestions(false);
    setIsDialogOpen(false);

    toast.success(`Entrada registrada: ${formData.visitorName}`);
  };

  const handleExit = (entryId: string) => {
    const allEntries = storage.getEntries();
    const entry = allEntries.find((e) => e.id === entryId);
    const updatedEntries = allEntries.map((e) =>
      e.id === entryId
        ? { ...e, exitTime: new Date().toISOString() }
        : e
    );
    
    storage.saveEntries(updatedEntries);
    setEntries(updatedEntries.filter((e) => !e.exitTime));
    
    if (entry) {
      storage.addEvent({
        type: 'exit',
        description: `Saída registrada: ${entry.visitorName} - ${entry.apartment}`,
        priority: 'low',
        relatedId: entryId,
      });
      toast.success(`Saída registrada: ${entry.visitorName}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Novo Cadastro</h2>
          <p className="text-muted-foreground">Registre entradas e saídas de visitantes e prestadores</p>
        </div>
        <Button onClick={() => setIsDialogOpen(true)} size="lg" className="gap-2">
          <Plus className="h-5 w-5" />
          Nova Entrada
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <LogOut className="h-5 w-5 text-warning" />
              <span>Ativos no Condomínio</span>
            </div>
            <span className="text-sm font-normal text-muted-foreground">
              {entries.length} {entries.length === 1 ? 'pessoa' : 'pessoas'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 col-span-full">
                Nenhuma pessoa no momento
              </p>
            ) : (
              paginatedEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`p-4 rounded-lg border-l-4 ${
                    entry.visitorType === 'service_provider' 
                      ? 'bg-warning/10 border-warning' 
                      : 'bg-success/10 border-success'
                  }`}
                >
                  <div className="flex gap-3 mb-3">
                    {entry.photo ? (
                      <img src={entry.photo} alt={entry.visitorName} className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-xl">
                        {entry.visitorType === 'service_provider' ? '🔧' : '👤'}
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">{entry.visitorName}</p>
                      <p className="text-xs text-muted-foreground">{entry.visitorDocument}</p>
                      {entry.company && (
                        <p className="text-xs text-muted-foreground">🏢 {entry.company}</p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground mb-3">
                    <p>📍 {entry.apartment} - {entry.residentName}</p>
                    <p>🕐 {new Date(entry.entryTime).toLocaleString('pt-BR')}</p>
                    {entry.vehiclePlate && (
                      <p>🚗 {entry.vehiclePlate} - {entry.vehicleModel}</p>
                    )}
                  </div>
                  <Button
                    onClick={() => handleExit(entry.id)}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Registrar Saída
                  </Button>
                </div>
              ))
            )}
          </div>
          
          {totalPages > 1 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
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
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar Nova Entrada</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEntry} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="visitorType">Tipo *</Label>
                  <Select 
                    value={formData.visitorType} 
                    onValueChange={(value: 'visitor' | 'service_provider') => 
                      setFormData({ ...formData, visitorType: value })
                    }
                  >
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
                  <Input
                    id="visitorName"
                    value={formData.visitorName}
                    onChange={(e) => {
                      setFormData({ ...formData, visitorName: e.target.value });
                      findSimilarEntries(e.target.value, formData.visitorDocument);
                    }}
                    placeholder="Nome completo"
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="visitorDocument">RG/CPF *</Label>
                  <Input
                    id="visitorDocument"
                    value={formData.visitorDocument}
                    onChange={(e) => {
                      setFormData({ ...formData, visitorDocument: e.target.value });
                      findSimilarEntries(formData.visitorName, e.target.value);
                    }}
                    placeholder="Número do documento"
                    required
                  />
                </div>

                {showSuggestions && suggestions.length > 0 && (
                  <div className="md:col-span-2 p-3 bg-primary/10 border border-primary rounded-lg">
                    <p className="text-sm font-semibold text-primary mb-2">✨ Cadastros encontrados:</p>
                    <div className="space-y-2">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          onClick={() => applySuggestion(suggestion)}
                          className="w-full text-left p-2 bg-background rounded hover:bg-muted transition-colors text-sm"
                        >
                          <p className="font-medium">{suggestion.visitorName}</p>
                          <p className="text-xs text-muted-foreground">
                            Doc: {suggestion.visitorDocument} • Última visita: {new Date(suggestion.entryTime).toLocaleDateString('pt-BR')}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {formData.visitorType === 'service_provider' && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="company">Empresa</Label>
                    <Input
                      id="company"
                      value={formData.company}
                      onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                      placeholder="Nome da empresa"
                    />
                  </div>
                )}

                <div className="space-y-2 md:col-span-2 relative">
                  <Label htmlFor="residentId">Visitando *</Label>
                  <Input
                    id="visitedLocation"
                    value={visitedLocationSearch}
                    onChange={(e) => {
                      setVisitedLocationSearch(e.target.value);
                      setShowResidentSuggestions(e.target.value.length > 0);
                    }}
                    onFocus={() => setShowResidentSuggestions(visitedLocationSearch.length > 0)}
                    placeholder="Digite o nome ou apartamento do morador"
                    required
                  />
                  {showResidentSuggestions && filteredResidents.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredResidents.slice(0, 5).map((resident) => (
                        <button
                          key={resident.id}
                          type="button"
                          className="w-full text-left px-4 py-2 hover:bg-accent transition-colors"
                          onClick={() => handleVisitedLocationSelect(resident.id, resident.name, resident.apartment)}
                        >
                          <div className="font-medium">{resident.name}</div>
                          <div className="text-sm text-muted-foreground">{resident.apartment}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vehiclePlate">Placa do Veículo</Label>
                  <Input
                    id="vehiclePlate"
                    value={formData.vehiclePlate}
                    onChange={(e) => setFormData({ ...formData, vehiclePlate: e.target.value })}
                    placeholder="ABC-1234"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vehicleModel">Modelo</Label>
                  <Input
                    id="vehicleModel"
                    value={formData.vehicleModel}
                    onChange={(e) => setFormData({ ...formData, vehicleModel: e.target.value })}
                    placeholder="Ex: Honda Civic"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vehicleColor">Cor do Veículo</Label>
                  <Input
                    id="vehicleColor"
                    value={formData.vehicleColor}
                    onChange={(e) => setFormData({ ...formData, vehicleColor: e.target.value })}
                    placeholder="Ex: Preto"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purpose">Motivo da Visita</Label>
                  <Textarea
                    id="purpose"
                    value={formData.purpose}
                    onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                    placeholder="Ex: Visita social, manutenção..."
                    rows={2}
                  />
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
                    <input
                      id="photoUpload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoUpload}
                    />
                  </div>
                  {formData.photo && (
                    <div className="relative inline-block">
                      <img src={formData.photo} alt="Foto" className="w-24 h-24 object-cover rounded-lg border" />
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, photo: '' })}
                        className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {showCamera && (
                <div className="space-y-2">
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
                </div>
              )}

              <Button type="submit" className="w-full">
                <LogIn className="h-4 w-4 mr-2" />
                Registrar Entrada
              </Button>
            </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
