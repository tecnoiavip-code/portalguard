import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, ShieldBan } from 'lucide-react';
import { AccessEntry } from '@/types';
import { useAccessEntries } from '@/hooks/useAccessEntries';
import { useResidents } from '@/hooks/useResidents';
import { useDevices } from '@/hooks/useDevices';
import { Badge } from '@/components/ui/badge';
import { ActiveEntriesSection } from './new-registry/ActiveEntriesSection';
import { ActiveEntryDetailsDialog } from './new-registry/ActiveEntryDetailsDialog';
import { RegistryFormDialog } from './new-registry/RegistryFormDialog';
import { CameraCaptureDialog } from './new-registry/CameraCaptureDialog';
import { BlockedVisitorsDialog } from './new-registry/BlockedVisitorsDialog';
import { BlockReasonDialog } from './new-registry/BlockReasonDialog';
import { DeviceFacialCaptureDialog } from './new-registry/DeviceFacialCaptureDialog';
import { EMPTY_NEW_REGISTRY_FORM } from './new-registry/registry-form';
import { useBlockedVisitors } from './new-registry/useBlockedVisitors';
import { useNewRegistryDraft } from './new-registry/useNewRegistryDraft';
import { useRegistryEntryActions } from './new-registry/useRegistryEntryActions';
import { useRegistryExports } from './new-registry/useRegistryExports';
import { useRegistryListState } from './new-registry/useRegistryListState';
import { useRegistryPhotoCapture } from './new-registry/useRegistryPhotoCapture';
import { useVehicleSuggestions } from './new-registry/useVehicleSuggestions';
import { useVisitorSuggestions } from './new-registry/useVisitorSuggestions';

export const NewRegistry = () => {
  const { residents } = useResidents();
  const { devices } = useDevices();
  const { entries: allEntries, saveEntry, registerExit, deleteEntry } = useAccessEntries();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>('');
  const [visitedLocationSearch, setVisitedLocationSearch] = useState('');
  const [showResidentSuggestions, setShowResidentSuggestions] = useState(false);
  const [showBlockedDialog, setShowBlockedDialog] = useState(false);
  const [showBlockReasonDialog, setShowBlockReasonDialog] = useState(false);
  const [selectedDetailEntry, setSelectedDetailEntry] = useState<AccessEntry | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_NEW_REGISTRY_FORM });
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);
  const [showColorSuggestions, setShowColorSuggestions] = useState(false);
  const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);
  const facialDevices = useMemo(
    () => devices.filter(d => d.type === 'facial_recognition'),
    [devices]
  );
  const {
    vehicleModelSuggestions,
    vehicleColorSuggestions,
    companySuggestions,
    filterVehicleModels,
    filterVehicleColors,
    filterCompanies,
  } = useVehicleSuggestions();
  const {
    activeEntries,
    filteredActiveEntries,
    filteredAllEntries,
    paginatedEntries,
    searchTerm,
    currentPage,
    totalPages,
    setCurrentPage,
    handleSearchChange,
  } = useRegistryListState(allEntries);
  const {
    suggestions,
    showSuggestions,
    findSimilarEntries,
    applySuggestion,
    clearSuggestions,
  } = useVisitorSuggestions({
    allEntries,
    setFormData,
  });
  const {
    blockedVisitors,
    blockingEntry,
    blockReason,
    setBlockReason,
    isVisitorBlocked,
    getBlockedReason,
    beginBlockVisitor,
    confirmBlockVisitor,
    unblockVisitor,
  } = useBlockedVisitors();

  const {
    badgeError,
    setBadgeError,
    registerEntry,
    exitEntry,
  } = useRegistryEntryActions({
    allEntries,
    residents,
    facialDevices,
    editingId,
    formData,
    showSuggestions,
    suggestions,
    isVisitorBlocked,
    saveEntry,
    registerExit,
  });
  const {
    videoRef,
    canvasRef,
    showCameraDialog,
    startCamera,
    stopCamera,
    capturePhoto,
    handlePhotoUpload,
    showDeviceFacialDialog,
    setShowDeviceFacialDialog,
    selectedFacialDeviceId,
    setSelectedFacialDeviceId,
    deviceCaptureStatus,
    deviceCaptureStep,
    deviceCaptureProgress,
    deviceCaptureLoading,
    openDeviceFacialDialog,
    cancelDeviceCapture,
    handleDeviceCapture,
  } = useRegistryPhotoCapture({
    devices,
    residents,
    formData,
    setFormData,
  });

  const { clearRegistryDraft } = useNewRegistryDraft({
    isDialogOpen,
    editingId,
    visitedLocationSearch,
    formData,
    setIsDialogOpen,
    setEditingId,
    setVisitedLocationSearch,
    setFormData,
  });

  const handleBlockVisitor = (entry: AccessEntry) => {
    beginBlockVisitor(entry);
    setShowBlockReasonDialog(true);
  };

  const handleConfirmBlockVisitor = async () => {
    const blocked = await confirmBlockVisitor();
    if (blocked) setShowBlockReasonDialog(false);
  };

  const filteredResidents = residents.filter(r => r.name.toLowerCase().includes(visitedLocationSearch.toLowerCase()) || r.apartment.toLowerCase().includes(visitedLocationSearch.toLowerCase()));
  const {
    exportActiveEntriesToPDF,
    exportActiveEntriesToCSV,
  } = useRegistryExports({
    filteredActiveEntries,
    filteredAllEntries,
    residents,
  });
  
  const handleVisitedLocationSelect = (residentId: string, residentName: string, apartment: string) => {
    setVisitedLocationSearch(`${residentName} - ${apartment}`);
    setFormData({
      ...formData,
      residentId
    });
    setShowResidentSuggestions(false);
  };
  
  const handleEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const registered = await registerEntry();
    if (registered) resetForm();
  };
  const handleEdit = (entry: AccessEntry) => {
    setEditingId(entry.id);
    setFormData({
      visitorName: entry.visitorName,
      visitorDocument: entry.visitorDocument,
      visitorType: entry.visitorType,
      residentId: entry.residentId,
      purpose: entry.purpose || '',
      company: entry.company || '',
      vehiclePlate: entry.vehiclePlate || '',
      vehicleModel: entry.vehicleModel || '',
      vehicleColor: entry.vehicleColor || '',
      photo: entry.photo || '',
      badgeNumber: entry.badgeNumber || '',
    });
    const resident = residents.find(r => r.id === entry.residentId);
    if (resident) {
      setVisitedLocationSearch(`${resident.name} - ${resident.apartment}`);
    }
    setIsDialogOpen(true);
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este cadastro?')) return;
    await deleteEntry(id);
  };
  const resetForm = () => {
    setEditingId('');
    setFormData({ ...EMPTY_NEW_REGISTRY_FORM });
    setVisitedLocationSearch('');
    clearSuggestions();
    setIsDialogOpen(false);
    clearRegistryDraft();
    stopCamera();
  };
  const handleExit = async (entry: AccessEntry) => {
    await exitEntry(entry);
  };
  return <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold text-foreground mb-2">Novo Cadastro</h2>
          <p className="max-w-xl text-muted-foreground">Registre entradas e saídas de visitantes e prestadores</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowBlockedDialog(true)} className="flex-1 gap-2 sm:flex-none">
            <ShieldBan className="h-5 w-5" />
            Bloqueados
            {blockedVisitors.length > 0 && (
              <Badge variant="destructive" className="ml-1">{blockedVisitors.length}</Badge>
            )}
          </Button>
          <Button onClick={() => { setBadgeError(null); setIsDialogOpen(true); }} size="lg" className="flex-1 gap-2 text-primary-foreground sm:flex-none">
            <Plus className="h-5 w-5" />
            Nova Entrada
          </Button>
        </div>
      </div>

      <ActiveEntriesSection
        activeEntries={activeEntries}
        paginatedEntries={paginatedEntries}
        searchTerm={searchTerm}
        currentPage={currentPage}
        totalPages={totalPages}
        onSearchChange={handleSearchChange}
        onPageChange={setCurrentPage}
        onExportPDF={exportActiveEntriesToPDF}
        onExportCSV={exportActiveEntriesToCSV}
        onSelectEntry={setSelectedDetailEntry}
        onEditEntry={handleEdit}
        onBlockEntry={handleBlockVisitor}
        onDeleteEntry={handleDelete}
        onExitEntry={handleExit}
      />

      <ActiveEntryDetailsDialog
        entry={selectedDetailEntry}
        onClose={() => setSelectedDetailEntry(null)}
        onEditEntry={handleEdit}
        onExitEntry={handleExit}
      />

      <RegistryFormDialog
        isOpen={isDialogOpen}
        editingId={editingId}
        formData={formData}
        setFormData={setFormData}
        onSubmit={handleEntry}
        onCancel={resetForm}
        onKeepOpen={() => setIsDialogOpen(true)}
        isVisitorBlocked={isVisitorBlocked}
        blockedReason={getBlockedReason(formData.visitorDocument)}
        badgeError={badgeError}
        onClearBadgeError={() => setBadgeError(null)}
        showSuggestions={showSuggestions}
        suggestions={suggestions}
        onApplySuggestion={applySuggestion}
        findSimilarEntries={findSimilarEntries}
        visitedLocationSearch={visitedLocationSearch}
        setVisitedLocationSearch={setVisitedLocationSearch}
        showResidentSuggestions={showResidentSuggestions}
        setShowResidentSuggestions={setShowResidentSuggestions}
        filteredResidents={filteredResidents}
        onVisitedLocationSelect={handleVisitedLocationSelect}
        companySuggestions={companySuggestions}
        showCompanySuggestions={showCompanySuggestions}
        setShowCompanySuggestions={setShowCompanySuggestions}
        filterCompanies={filterCompanies}
        vehicleModelSuggestions={vehicleModelSuggestions}
        showModelSuggestions={showModelSuggestions}
        setShowModelSuggestions={setShowModelSuggestions}
        filterVehicleModels={filterVehicleModels}
        vehicleColorSuggestions={vehicleColorSuggestions}
        showColorSuggestions={showColorSuggestions}
        setShowColorSuggestions={setShowColorSuggestions}
        filterVehicleColors={filterVehicleColors}
        onStartCamera={startCamera}
        facialDevices={facialDevices}
        onOpenDeviceFacialDialog={openDeviceFacialDialog}
        onPhotoUpload={handlePhotoUpload}
      />

      <CameraCaptureDialog
        open={showCameraDialog}
        videoRef={videoRef}
        canvasRef={canvasRef}
        onClose={stopCamera}
        onCapture={capturePhoto}
      />

      <BlockedVisitorsDialog
        open={showBlockedDialog}
        onOpenChange={setShowBlockedDialog}
        blockedVisitors={blockedVisitors}
        onUnblockVisitor={unblockVisitor}
      />

      <BlockReasonDialog
        open={showBlockReasonDialog}
        onOpenChange={setShowBlockReasonDialog}
        entry={blockingEntry}
        reason={blockReason}
        setReason={setBlockReason}
        onConfirm={handleConfirmBlockVisitor}
      />

      <DeviceFacialCaptureDialog
        open={showDeviceFacialDialog}
        onOpenChange={setShowDeviceFacialDialog}
        facialDevices={facialDevices}
        selectedFacialDeviceId={selectedFacialDeviceId}
        setSelectedFacialDeviceId={setSelectedFacialDeviceId}
        status={deviceCaptureStatus}
        step={deviceCaptureStep}
        progress={deviceCaptureProgress}
        loading={deviceCaptureLoading}
        onCancelCapture={cancelDeviceCapture}
        onCapture={handleDeviceCapture}
      />
    </div>;
};
