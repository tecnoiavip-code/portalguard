import { Dispatch, SetStateAction } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { NewRegistryFormData } from '../registry-form';

interface VehicleDetailsSectionProps {
  formData: NewRegistryFormData;
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
  findSimilarEntries: (name: string, document: string, plate?: string) => void;
  vehicleModelSuggestions: string[];
  showModelSuggestions: boolean;
  setShowModelSuggestions: Dispatch<SetStateAction<boolean>>;
  filterVehicleModels: (query: string) => void;
  vehicleColorSuggestions: string[];
  showColorSuggestions: boolean;
  setShowColorSuggestions: Dispatch<SetStateAction<boolean>>;
  filterVehicleColors: (query: string) => void;
}

export function VehicleDetailsSection({
  formData,
  setFormData,
  findSimilarEntries,
  vehicleModelSuggestions,
  showModelSuggestions,
  setShowModelSuggestions,
  filterVehicleModels,
  vehicleColorSuggestions,
  showColorSuggestions,
  setShowColorSuggestions,
  filterVehicleColors,
}: VehicleDetailsSectionProps) {
  return (
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
  );
}
