import { ChangeEvent, Dispatch, FormEvent, SetStateAction } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AccessEntry, Device, Resident } from '@/types';

import { NewRegistryFormData } from './registry-form';
import {
  FormActions,
  PhotoSection,
  RegistryFormAlerts,
  VehicleDetailsSection,
  VisitDetailsSection,
  VisitorIdentitySection,
} from './registry-form-sections';

interface RegistryFormDialogProps {
  isOpen: boolean;
  editingId: string;
  formData: NewRegistryFormData;
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
  onSubmit: (event: FormEvent) => void;
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
  onPhotoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
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
      <DialogContent
        showCloseButton={false}
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{editingId ? 'Editar Cadastro' : 'Registrar Nova Entrada'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" autoComplete="off" data-form-type="other" data-lpignore="true">
          <input type="text" name="fake_field_1" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
          <input type="text" name="fake_field_2" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />

          <RegistryFormAlerts
            visitorDocument={formData.visitorDocument}
            isVisitorBlocked={isVisitorBlocked}
            blockedReason={blockedReason}
            badgeError={badgeError}
            onClearBadgeError={onClearBadgeError}
          />

          <VisitorIdentitySection
            formData={formData}
            setFormData={setFormData}
            showSuggestions={showSuggestions}
            suggestions={suggestions}
            onApplySuggestion={onApplySuggestion}
            findSimilarEntries={findSimilarEntries}
          />

          <VisitDetailsSection
            formData={formData}
            setFormData={setFormData}
            visitedLocationSearch={visitedLocationSearch}
            setVisitedLocationSearch={setVisitedLocationSearch}
            showResidentSuggestions={showResidentSuggestions}
            setShowResidentSuggestions={setShowResidentSuggestions}
            filteredResidents={filteredResidents}
            onVisitedLocationSelect={onVisitedLocationSelect}
            companySuggestions={companySuggestions}
            showCompanySuggestions={showCompanySuggestions}
            setShowCompanySuggestions={setShowCompanySuggestions}
            filterCompanies={filterCompanies}
          />

          <VehicleDetailsSection
            formData={formData}
            setFormData={setFormData}
            findSimilarEntries={findSimilarEntries}
            vehicleModelSuggestions={vehicleModelSuggestions}
            showModelSuggestions={showModelSuggestions}
            setShowModelSuggestions={setShowModelSuggestions}
            filterVehicleModels={filterVehicleModels}
            vehicleColorSuggestions={vehicleColorSuggestions}
            showColorSuggestions={showColorSuggestions}
            setShowColorSuggestions={setShowColorSuggestions}
            filterVehicleColors={filterVehicleColors}
          />

          <PhotoSection
            formData={formData}
            setFormData={setFormData}
            onStartCamera={onStartCamera}
            facialDevices={facialDevices}
            onOpenDeviceFacialDialog={onOpenDeviceFacialDialog}
            onPhotoUpload={onPhotoUpload}
          />

          <FormActions editingId={editingId} onCancel={onCancel} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
