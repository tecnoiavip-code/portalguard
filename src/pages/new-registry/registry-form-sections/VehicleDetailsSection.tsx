import { Dispatch, SetStateAction } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { NewRegistryFormData } from '../registry-form';
import { AutocompleteField } from './AutocompleteField';

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

      <AutocompleteField
        id="vm_field"
        name="vm_field"
        label="Modelo"
        value={formData.vehicleModel}
        placeholder="Honda Civic"
        suggestions={vehicleModelSuggestions}
        showSuggestions={showModelSuggestions}
        setShowSuggestions={setShowModelSuggestions}
        onBeforeOpen={filterVehicleModels}
        onValueChange={(vehicleModel) => setFormData(current => ({ ...current, vehicleModel }))}
        onSuggestionSelect={(vehicleModel) => setFormData(current => ({ ...current, vehicleModel }))}
        getSuggestionKey={(vehicleModel) => vehicleModel}
        renderSuggestion={(vehicleModel) => vehicleModel}
      />

      <AutocompleteField
        id="vc_field"
        name="vc_field"
        label="Cor"
        value={formData.vehicleColor}
        placeholder="Preto"
        suggestions={vehicleColorSuggestions}
        showSuggestions={showColorSuggestions}
        setShowSuggestions={setShowColorSuggestions}
        onBeforeOpen={filterVehicleColors}
        onValueChange={(vehicleColor) => setFormData(current => ({ ...current, vehicleColor }))}
        onSuggestionSelect={(vehicleColor) => setFormData(current => ({ ...current, vehicleColor }))}
        getSuggestionKey={(vehicleColor) => vehicleColor}
        renderSuggestion={(vehicleColor) => vehicleColor}
      />

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
