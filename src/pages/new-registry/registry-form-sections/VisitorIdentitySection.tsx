import { Dispatch, SetStateAction } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AccessEntry } from '@/types';

import { NewRegistryFormData } from '../registry-form';

interface VisitorIdentitySectionProps {
  formData: NewRegistryFormData;
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
  showSuggestions: boolean;
  suggestions: AccessEntry[];
  onApplySuggestion: (entry: AccessEntry) => void;
  findSimilarEntries: (name: string, document: string, plate?: string) => void;
}

export function VisitorIdentitySection({
  formData,
  setFormData,
  showSuggestions,
  suggestions,
  onApplySuggestion,
  findSimilarEntries,
}: VisitorIdentitySectionProps) {
  return (
    <>
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
    </>
  );
}
