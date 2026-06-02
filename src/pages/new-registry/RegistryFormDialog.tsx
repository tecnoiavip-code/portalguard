import { Dispatch, SetStateAction } from 'react';
import { AccessEntry, Device, Resident } from '@/types';
import { AlertTriangle, Camera, LogIn, ScanFace, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NewRegistryFormData } from './registry-form';

interface RegistryFormDialogProps {
  isOpen: boolean;
  editingId: string;
  formData: NewRegistryFormData;
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  onKeepOpen: () => void;
  isVisitorBlocked: (document: string) => boolean;
  blockedReason: string | null;
  badgeError: string | null;
  onClearBadgeError: () => void;
  showSuggestions: boolean;
  suggestions: AccessEntry[];
  onApplySuggestion: (entry: AccessEntry) => void;
  findSimilarEntries: (name: string, document: string, plate?: string) => void;
  visitedLocationSearch: string;
  setVisitedLocationSearch: Dispatch<SetStateAction<string>>;
  showResidentSuggestions: boolean;
  setShowResidentSuggestions: Dispatch<SetStateAction<boolean>>;
  filteredResidents: Resident[];
  onVisitedLocationSelect: (residentId: string, residentName: string, apartment: string) => void;
  companySuggestions: string[];
  showCompanySuggestions: boolean;
  setShowCompanySuggestions: Dispatch<SetStateAction<boolean>>;
  filterCompanies: (query: string) => void;
  vehicleModelSuggestions: string[];
  showModelSuggestions: boolean;
  setShowModelSuggestions: Dispatch<SetStateAction<boolean>>;
  filterVehicleModels: (query: string) => void;
  vehicleColorSuggestions: string[];
  showColorSuggestions: boolean;
  setShowColorSuggestions: Dispatch<SetStateAction<boolean>>;
  filterVehicleColors: (query: string) => void;
  onStartCamera: () => void;
  facialDevices: Device[];
  onOpenDeviceFacialDialog: () => void;
  onPhotoUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function RegistryFormDialog({
  isOpen,
  editingId,
  formData,
  setFormData,
  onSubmit,
  onCancel,
  onKeepOpen,
  isVisitorBlocked,
  blockedReason,
  badgeError,
  onClearBadgeError,
  showSuggestions,
  suggestions,
  onApplySuggestion,
  findSimilarEntries,
  visitedLocationSearch,
  setVisitedLocationSearch,
  showResidentSuggestions,
  setShowResidentSuggestions,
  filteredResidents,
  onVisitedLocationSelect,
  companySuggestions,
  showCompanySuggestions,
  setShowCompanySuggestions,
  filterCompanies,
  vehicleModelSuggestions,
  showModelSuggestions,
  setShowModelSuggestions,
  filterVehicleModels,
  vehicleColorSuggestions,
  showColorSuggestions,
  setShowColorSuggestions,
  filterVehicleColors,
  onStartCamera,
  facialDevices,
  onOpenDeviceFacialDialog,
  onPhotoUpload,
}: RegistryFormDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (open) onKeepOpen();
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-4xl max-h-[90vh] overflow-y-auto" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{editingId ? 'Editar Cadastro' : 'Registrar Nova Entrada'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" autoComplete="off" data-form-type="other" data-lpignore="true">
          <input type="text" name="fake_field_1" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
          <input type="text" name="fake_field_2" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />

          {formData.visitorDocument && isVisitorBlocked(formData.visitorDocument) && (
            <div className="rounded-lg border-2 border-destructive bg-destructive/10 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="rounded-full bg-destructive p-2 shrink-0">
                <AlertTriangle className="h-5 w-5 text-destructive-foreground" />
              </div>
              <div>
                <h4 className="font-bold text-destructive text-base">VISITANTE BLOQUEADO</h4>
                <p className="text-sm text-destructive/90 mt-1">
                  Este documento consta na lista de bloqueio. A entrada <strong>não será permitida</strong>.
                </p>
                {blockedReason && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Motivo: {blockedReason}
                  </p>
                )}
              </div>
            </div>
          )}

          {badgeError && (
            <div className="rounded-lg border-2 border-warning bg-warning/10 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="rounded-full bg-warning p-2 shrink-0">
                <AlertTriangle className="h-5 w-5 text-warning-foreground" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-foreground text-base">Crachá em uso</h4>
                <p className="text-sm text-muted-foreground mt-1">{badgeError}</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={onClearBadgeError}>
                OK
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="visitorType" className="text-xs">Tipo *</Label>
              <Select value={formData.visitorType} onValueChange={(value: 'visitor' | 'service_provider') => setFormData({
                ...formData,
                visitorType: value,
              })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="visitor">Visitante</SelectItem>
                  <SelectItem value="service_provider">Prestador</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="visitorName" className="text-xs">Nome Completo *</Label>
              <Input id="vn_field" name="vn_field" className="h-9" value={formData.visitorName} autoComplete="one-time-code" readOnly onFocus={event => event.currentTarget.removeAttribute('readOnly')} onChange={event => {
                setFormData({
                  ...formData,
                  visitorName: event.target.value,
                });
                findSimilarEntries(event.target.value, formData.visitorDocument, formData.vehiclePlate);
              }} placeholder="Nome completo" required />
            </div>

            <div className="space-y-1">
              <Label htmlFor="visitorDocument" className="text-xs">RG/CPF *</Label>
              <Input id="vd_field" name="vd_field" className="h-9" value={formData.visitorDocument} autoComplete="one-time-code" readOnly onFocus={event => event.currentTarget.removeAttribute('readOnly')} onChange={event => {
                setFormData({
                  ...formData,
                  visitorDocument: event.target.value,
                });
                findSimilarEntries(formData.visitorName, event.target.value, formData.vehiclePlate);
              }} placeholder="Número do documento" required />
            </div>
          </div>

          {showSuggestions && suggestions.length > 0 && (
            <div className="p-2 bg-primary/10 border border-primary rounded-lg">
              <p className="text-xs font-semibold text-primary mb-1">Cadastros encontrados:</p>
              <div className="flex gap-2 flex-wrap">
                {suggestions.map(suggestion => (
                  <button key={suggestion.id} type="button" onClick={() => onApplySuggestion(suggestion)} className="text-left p-2 bg-background rounded hover:bg-muted transition-colors text-xs flex-1 min-w-[150px]">
                    <p className="font-medium">{suggestion.visitorName}</p>
                    <p className="text-muted-foreground">
                      Doc: {suggestion.visitorDocument}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 relative md:col-span-1">
              <Label htmlFor="residentId">Visitando *</Label>
              <Input id="vl_field" name="vl_field" value={visitedLocationSearch} autoComplete="one-time-code" readOnly onFocus={event => { event.currentTarget.removeAttribute('readOnly'); setShowResidentSuggestions(visitedLocationSearch.length > 0); }} onChange={event => {
                setVisitedLocationSearch(event.target.value);
                setShowResidentSuggestions(event.target.value.length > 0);
              }} placeholder="Morador ou apt" required />
              {showResidentSuggestions && filteredResidents.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {filteredResidents.slice(0, 5).map(resident => (
                    <button key={resident.id} type="button" className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-sm" onClick={() => onVisitedLocationSelect(resident.id, resident.name, resident.apartment)}>
                      <span className="font-medium">{resident.name}</span>
                      <span className="text-muted-foreground ml-2">{resident.apartment}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 relative">
              <Label htmlFor="company">{formData.visitorType === 'service_provider' ? 'Empresa' : 'Empresa (opcional)'}</Label>
              <Input
                id="co_field"
                name="co_field"
                value={formData.company}
                autoComplete="off"
                onFocus={() => { filterCompanies(formData.company); setShowCompanySuggestions(true); }}
                onChange={event => { setFormData({ ...formData, company: event.target.value }); filterCompanies(event.target.value); setShowCompanySuggestions(true); }}
                onBlur={() => setTimeout(() => setShowCompanySuggestions(false), 150)}
                placeholder="Nome da empresa"
              />
              {showCompanySuggestions && companySuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {companySuggestions.map(company => (
                    <button key={company} type="button" className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-sm" onMouseDown={(event) => event.preventDefault()} onClick={() => { setFormData({ ...formData, company }); setShowCompanySuggestions(false); }}>
                      {company}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="badgeNumber">Nº Crachá</Label>
              <Input id="bn_field" name="bn_field" value={formData.badgeNumber} onChange={event => setFormData({
                ...formData,
                badgeNumber: event.target.value,
              })} placeholder="Ex: 001" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vehiclePlate">Placa</Label>
              <Input id="vp_field" name="vp_field" value={formData.vehiclePlate} onChange={event => {
                setFormData({
                  ...formData,
                  vehiclePlate: event.target.value,
                });
                findSimilarEntries(formData.visitorName, formData.visitorDocument, event.target.value);
              }} placeholder="ABC-1234" />
            </div>

            <div className="space-y-2 relative">
              <Label htmlFor="vehicleModel">Modelo</Label>
              <Input
                id="vm_field"
                name="vm_field"
                value={formData.vehicleModel}
                autoComplete="off"
                onFocus={() => { filterVehicleModels(formData.vehicleModel); setShowModelSuggestions(true); }}
                onChange={event => { setFormData({ ...formData, vehicleModel: event.target.value }); filterVehicleModels(event.target.value); setShowModelSuggestions(true); }}
                onBlur={() => setTimeout(() => setShowModelSuggestions(false), 150)}
                placeholder="Honda Civic"
              />
              {showModelSuggestions && vehicleModelSuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {vehicleModelSuggestions.map(model => (
                    <button key={model} type="button" className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-sm" onMouseDown={(event) => event.preventDefault()} onClick={() => { setFormData({ ...formData, vehicleModel: model }); setShowModelSuggestions(false); }}>
                      {model}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 relative">
              <Label htmlFor="vehicleColor">Cor</Label>
              <Input
                id="vc_field"
                name="vc_field"
                value={formData.vehicleColor}
                autoComplete="off"
                onFocus={() => { filterVehicleColors(formData.vehicleColor); setShowColorSuggestions(true); }}
                onChange={event => { setFormData({ ...formData, vehicleColor: event.target.value }); filterVehicleColors(event.target.value); setShowColorSuggestions(true); }}
                onBlur={() => setTimeout(() => setShowColorSuggestions(false), 150)}
                placeholder="Preto"
              />
              {showColorSuggestions && vehicleColorSuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {vehicleColorSuggestions.map(color => (
                    <button key={color} type="button" className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-sm" onMouseDown={(event) => event.preventDefault()} onClick={() => { setFormData({ ...formData, vehicleColor: color }); setShowColorSuggestions(false); }}>
                      {color}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="purpose">Motivo</Label>
              <Input id="pp_field" name="pp_field" value={formData.purpose} onChange={event => setFormData({
                ...formData,
                purpose: event.target.value,
              })} placeholder="Visita, manutenção..." />
            </div>
          </div>

          <div className="space-y-2 flex items-center gap-4">
            <div>
              {formData.photo ? (
                <img src={formData.photo} alt="Foto" className="w-24 h-24 rounded-full object-cover border-2 border-primary" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  Sem foto
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label>Foto do Visitante</Label>
              <div className="flex gap-2 flex-wrap">
                <Button type="button" size="sm" variant="outline" onClick={onStartCamera}>
                  <Camera className="h-4 w-4 mr-2" />
                  Webcam
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById('photoUpload')?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Carregar
                </Button>
                {facialDevices.length > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={onOpenDeviceFacialDialog} className="gap-1">
                    <ScanFace className="h-4 w-4" />
                    Dispositivo
                  </Button>
                )}
                {formData.photo && (
                  <Button type="button" size="sm" variant="destructive" onClick={() => setFormData({ ...formData, photo: '' })}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remover
                  </Button>
                )}
              </div>
            </div>
            <input id="photoUpload" type="file" accept="image/*" className="hidden" onChange={onPhotoUpload} />
          </div>

          <div className="flex space-x-2">
            <Button type="submit" className="flex-1">
              <LogIn className="h-4 w-4 mr-2" />
              {editingId ? 'Salvar Alterações' : 'Registrar Entrada'}
            </Button>
            <Button type="button" variant="destructive" onClick={onCancel}>
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
