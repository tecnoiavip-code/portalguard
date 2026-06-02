import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, ShieldBan } from 'lucide-react';
import { AccessEntry } from '@/types';
import { useAccessEntries } from '@/hooks/useAccessEntries';
import { useResidents } from '@/hooks/useResidents';
import { useDevices } from '@/hooks/useDevices';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { exportToCSV } from '@/lib/export-csv';
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
import { useRegistryPhotoCapture } from './new-registry/useRegistryPhotoCapture';
import { useVehicleSuggestions } from './new-registry/useVehicleSuggestions';

export const NewRegistry = () => {
  const { residents } = useResidents();
  const { devices } = useDevices();
  const { entries: allEntries, saveEntry, deleteEntry } = useAccessEntries();
  const entries = allEntries.filter(e => !e.exitTime);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [currentPageAll, setCurrentPageAll] = useState(1);
  const [visitedLocationSearch, setVisitedLocationSearch] = useState('');
  const [showResidentSuggestions, setShowResidentSuggestions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showBlockedDialog, setShowBlockedDialog] = useState(false);
  const [showBlockReasonDialog, setShowBlockReasonDialog] = useState(false);
  const [selectedDetailEntry, setSelectedDetailEntry] = useState<AccessEntry | null>(null);
  const itemsPerPage = 12;
  const itemsPerPageTable = 10;
  const [formData, setFormData] = useState({ ...EMPTY_NEW_REGISTRY_FORM });
  const [suggestions, setSuggestions] = useState<AccessEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
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

  useEffect(() => {
    const total = Math.ceil(entries.filter(e => !e.exitTime).length / itemsPerPage);
    if (total > 0 && currentPage > total) {
      setCurrentPage(total);
    }
  }, [entries, currentPage]);

  const handleBlockVisitor = (entry: AccessEntry) => {
    beginBlockVisitor(entry);
    setShowBlockReasonDialog(true);
  };

  const handleConfirmBlockVisitor = async () => {
    const blocked = await confirmBlockVisitor();
    if (blocked) setShowBlockReasonDialog(false);
  };

  const activeEntries = entries.filter(e => !e.exitTime);
  const filteredActiveEntries = activeEntries.filter(entry => entry.visitorName.toLowerCase().includes(searchTerm.toLowerCase()) || entry.apartment.toLowerCase().includes(searchTerm.toLowerCase()) || entry.visitorDocument.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalPages = Math.ceil(filteredActiveEntries.length / itemsPerPage);
  const safePage = Math.max(1, Math.min(currentPage, totalPages || 1));
  if (safePage !== currentPage && totalPages > 0) {
    // Will be corrected on next render via useEffect below
  }
  const paginatedEntries = filteredActiveEntries.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);
  const filteredAllEntries = allEntries.filter(entry => entry.visitorName.toLowerCase().includes(searchTerm.toLowerCase()) || entry.apartment.toLowerCase().includes(searchTerm.toLowerCase()) || entry.visitorDocument.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalPagesAll = Math.ceil(filteredAllEntries.length / itemsPerPageTable);
  const paginatedAllEntries = filteredAllEntries.slice((currentPageAll - 1) * itemsPerPageTable, currentPageAll * itemsPerPageTable);
  const filteredResidents = residents.filter(r => r.name.toLowerCase().includes(visitedLocationSearch.toLowerCase()) || r.apartment.toLowerCase().includes(visitedLocationSearch.toLowerCase()));
  
  const handleVisitedLocationSelect = (residentId: string, residentName: string, apartment: string) => {
    setVisitedLocationSearch(`${residentName} - ${apartment}`);
    setFormData({
      ...formData,
      residentId
    });
    setShowResidentSuggestions(false);
  };
  
  const findSimilarEntries = (name: string, document: string, plate?: string) => {
    const nameReady = name && name.trim().length >= 5;
    const docReady = document && document.replace(/\D/g, '').length >= 5;
    const plateReady = plate && plate.replace(/[^a-zA-Z0-9]/g, '').length >= 3;
    if (!nameReady && !docReady && !plateReady) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const similar = allEntries.filter(entry => {
      const nameMatch = nameReady && entry.visitorName.toLowerCase().includes(name.toLowerCase());
      const docMatch = docReady && entry.visitorDocument.includes(document);
      const plateMatch = plateReady && entry.vehiclePlate && entry.vehiclePlate.toLowerCase().includes(plate!.toLowerCase());
      return nameMatch || docMatch || plateMatch;
    });
    // Deduplicate: keep only the most recent entry per visitor document
    const uniqueMap = new Map<string, AccessEntry>();
    for (const entry of similar) {
      const key = entry.visitorDocument || entry.visitorName;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, entry);
      }
    }
    const unique = Array.from(uniqueMap.values());
    if (unique.length > 0) {
      setSuggestions(unique.slice(0, 3));
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
      badgeNumber: '',
    });
    setShowSuggestions(false);
    toast.success('Dados preenchidos automaticamente! Atribua um novo crachá.');
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
  const exportActiveEntriesToPDF = () => {
    const doc = new jsPDF();
    doc.text('Cadastros Ativos', 14, 15);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', {
      locale: ptBR
    })}`, 14, 22);
    const tableData = filteredActiveEntries.map(entry => {
      const resident = residents.find(r => r.id === entry.residentId);
      return [entry.visitorName, entry.visitorDocument, resident?.name || '-', resident?.apartment || '-', entry.visitorType === 'visitor' ? 'Visitante' : 'Prestador', entry.badgeNumber || '-', format(new Date(entry.entryTime), 'dd/MM/yyyy HH:mm', {
        locale: ptBR
      })];
    });
    autoTable(doc, {
      head: [['Nome', 'Documento', 'Morador', 'Apt', 'Tipo', 'Crachá', 'Entrada']],
      body: tableData,
      startY: 28
    });
    doc.save(`cadastros-ativos-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
    toast.success('PDF gerado com sucesso');
  };
  const exportActiveEntriesToCSV = () => {
    const headers = ['Nome', 'Documento', 'Morador', 'Apt', 'Tipo', 'Crachá', 'Entrada'];
    const rows = filteredActiveEntries.map(entry => {
      const resident = residents.find(r => r.id === entry.residentId);
      return [entry.visitorName, entry.visitorDocument, resident?.name || '-', resident?.apartment || '-', entry.visitorType === 'visitor' ? 'Visitante' : 'Prestador', entry.badgeNumber || '-', format(new Date(entry.entryTime), 'dd/MM/yyyy HH:mm', { locale: ptBR })];
    });
    exportToCSV(`cadastros-ativos-${format(new Date(), 'dd-MM-yyyy')}`, headers, rows);
    toast.success('CSV gerado com sucesso');
  };
  const exportAllEntriesToPDF = () => {
    const doc = new jsPDF();
    doc.text('Todos os Cadastros', 14, 15);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', {
      locale: ptBR
    })}`, 14, 22);
    const tableData = filteredAllEntries.map(entry => {
      const resident = residents.find(r => r.id === entry.residentId);
      return [entry.visitorName, entry.visitorDocument, resident?.name || '-', resident?.apartment || '-', entry.badgeNumber || '-', format(new Date(entry.entryTime), 'dd/MM/yyyy HH:mm', {
        locale: ptBR
      }), entry.exitTime ? format(new Date(entry.exitTime), 'dd/MM/yyyy HH:mm', {
        locale: ptBR
      }) : 'Ativo'];
    });
    autoTable(doc, {
      head: [['Nome', 'Documento', 'Morador', 'Apt', 'Crachá', 'Entrada', 'Saída']],
      body: tableData,
      startY: 28
    });
    doc.save(`todos-cadastros-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
    toast.success('PDF gerado com sucesso');
  };
  const exportAllEntriesToCSV = () => {
    const headers = ['Nome', 'Documento', 'Morador', 'Apt', 'Crachá', 'Entrada', 'Saída'];
    const rows = filteredAllEntries.map(entry => {
      const resident = residents.find(r => r.id === entry.residentId);
      return [entry.visitorName, entry.visitorDocument, resident?.name || '-', resident?.apartment || '-', entry.badgeNumber || '-', format(new Date(entry.entryTime), 'dd/MM/yyyy HH:mm', { locale: ptBR }), entry.exitTime ? format(new Date(entry.exitTime), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : 'Ativo'];
    });
    exportToCSV(`todos-cadastros-${format(new Date(), 'dd-MM-yyyy')}`, headers, rows);
    toast.success('CSV gerado com sucesso');
  };
  const resetForm = () => {
    setEditingId('');
    setFormData({ ...EMPTY_NEW_REGISTRY_FORM });
    setVisitedLocationSearch('');
    setSuggestions([]);
    setShowSuggestions(false);
    setIsDialogOpen(false);
    clearRegistryDraft();
    stopCamera();
  };
  const handleExit = async (entryId: string) => {
    await exitEntry(entryId);
  };
  return <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Novo Cadastro</h2>
          <p className="text-muted-foreground">Registre entradas e saídas de visitantes e prestadores</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowBlockedDialog(true)} className="gap-2">
            <ShieldBan className="h-5 w-5" />
            Bloqueados
            {blockedVisitors.length > 0 && (
              <Badge variant="destructive" className="ml-1">{blockedVisitors.length}</Badge>
            )}
          </Button>
          <Button onClick={() => { setBadgeError(null); setIsDialogOpen(true); }} size="lg" className="gap-2 text-primary-foreground">
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
        onSearchChange={(value) => {
          setSearchTerm(value);
          setCurrentPage(1);
          setCurrentPageAll(1);
        }}
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
