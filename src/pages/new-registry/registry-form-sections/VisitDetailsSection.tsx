import { Dispatch, SetStateAction } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Resident } from '@/types';

import { NewRegistryFormData } from '../registry-form';

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
  );
}
