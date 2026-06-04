import { Dispatch, SetStateAction } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Resident } from '@/types';

import { NewRegistryFormData } from '../registry-form';
import { AutocompleteField } from './AutocompleteField';

interface VisitDetailsSectionProps {
  formData: NewRegistryFormData;
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
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
}

export function VisitDetailsSection({
  formData,
  setFormData,
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
}: VisitDetailsSectionProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <AutocompleteField
          id="vl_field"
          name="vl_field"
          label="Visitando *"
          value={visitedLocationSearch}
          autoComplete="one-time-code"
          readOnlyUntilFocus
          required
          placeholder="Morador ou apt"
          suggestions={filteredResidents}
          showSuggestions={showResidentSuggestions}
          setShowSuggestions={setShowResidentSuggestions}
          maxSuggestions={5}
          shouldShowSuggestions={(value) => value.length > 0}
          onValueChange={setVisitedLocationSearch}
          onSuggestionSelect={(resident) => onVisitedLocationSelect(resident.id, resident.name, resident.apartment)}
          getSuggestionKey={(resident) => resident.id}
          renderSuggestion={(resident) => (
            <>
              <span className="font-medium">{resident.name}</span>
              <span className="text-muted-foreground ml-2">{resident.apartment}</span>
            </>
          )}
        />
      </div>

      <AutocompleteField
        id="co_field"
        name="co_field"
        label={formData.visitorType === 'service_provider' ? 'Empresa' : 'Empresa (opcional)'}
        value={formData.company}
        placeholder="Nome da empresa"
        suggestions={companySuggestions}
        showSuggestions={showCompanySuggestions}
        setShowSuggestions={setShowCompanySuggestions}
        onBeforeOpen={filterCompanies}
        onValueChange={(company) => setFormData(current => ({ ...current, company }))}
        onSuggestionSelect={(company) => setFormData(current => ({ ...current, company }))}
        getSuggestionKey={(company) => company}
        renderSuggestion={(company) => company}
      />

      <div className="space-y-2">
        <Label htmlFor="badgeNumber">Nº Crachá</Label>
        <Input id="bn_field" name="bn_field" value={formData.badgeNumber} onChange={event => setFormData({
          ...formData,
          badgeNumber: event.target.value,
        })} placeholder="Ex: 001" />
      </div>
    </div>
  );
}
