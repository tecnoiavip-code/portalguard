import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Archive,
  CalendarClock,
  DatabaseBackup,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Lock,
  RotateCw,
  Send,
  Settings as SettingsIcon,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { supabaseStorage } from '@/lib/supabase-storage';
import {
  backupRangeLabel,
  createBackupPayload,
  DEFAULT_BACKUP_CONFIG,
  formatBytes,
  loadBackupConfig,
  loadBackupSnapshots,
  persistBackupSnapshot,
  saveBackupConfig,
  type BackupConfig,
  type BackupEntryStatus,
  type BackupFrequency,
  type BackupPayload,
  type BackupRange,
  type StoredBackupSnapshot,
} from '@/lib/backup';
import { useResidents } from '@/hooks/useResidents';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const CLEARABLE_LOCAL_STORAGE_KEYS = [
  'pg_residents',
  'pg_mails',
  'pg_entries',
  'pg_devices',
  'pg_events',
  'portalguard-new-registry-draft-v3',
  'portalguard-vehicle-suggestions-v3',
  'portalguard-mail-form-draft-v1',
  'portalguard-device-form-draft-v1',
  'portalguard-staff-announcement-draft-v1',
  'portalguard-staff-active-section',
  'portalguard-resident-active-tab',
  'pwa-install-dismissed',
];

const rangeOptions: Array<{ value: BackupRange; label: string }> = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '45', label: 'Últimos 45 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: 'all', label: 'Todo o histórico' },
];

const entryStatusOptions: Array<{ value: BackupEntryStatus; label: string }> = [
  { value: 'all', label: 'Todos os acessos' },
  { value: 'active', label: 'Somente ativos' },
  { value: 'closed', label: 'Somente finalizados' },
];

const frequencyOptions: Array<{ value: BackupFrequency; label: string }> = [
  { value: 'daily', label: 'Diário' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
];

const maxRowOptions = [100, 300, 500, 1000];
const retentionOptions = [1, 2, 3, 5];

const arrayToCSV = (data: any[], headers: string[]) => {
  const csvRows = [headers.join(',')];

  for (const row of data) {
    const values = headers.map((header) => {
      const escaped = String(row[header] ?? '').replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
};

const downloadCSV = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const downloadJSON = (content: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const parseCSVLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && insideQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const parseCSV = (text: string): any[] => {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.replace(/"/g, '').trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]).map((v) => v.replace(/"/g, '').trim());
    const obj: any = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] || '';
    });
    rows.push(obj);
  }

  return rows;
};

const formatDateTime = (value?: string) => {
  if (!value) return 'Nunca executado';
  return new Date(value).toLocaleString('pt-BR');
};

export const Settings = () => {
  const { residents } = useResidents();
  const [isIntegrationsUnlocked, setIsIntegrationsUnlocked] = useState(false);
  const [integrationPassword, setIntegrationPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [backupConfig, setBackupConfig] = useState<BackupConfig>(() => loadBackupConfig());
  const [backupSnapshots, setBackupSnapshots] = useState<StoredBackupSnapshot[]>(() => loadBackupSnapshots());
  const [isBackupRunning, setIsBackupRunning] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  let webhookHost = 'uqbxicxpphcfcofufxca.supabase.co';
  try {
    webhookHost = new URL(supabaseUrl).hostname;
  } catch {
    webhookHost = 'uqbxicxpphcfcofufxca.supabase.co';
  }

  const monitorPath = '/functions/v1/controlid-webhook';
  const pushAddress = `https://${webhookHost}${monitorPath}`;
  const pushEndpoint = `${pushAddress}/push`;
  const acceptedPushRoutes = `${monitorPath} e ${monitorPath}/push`;
  const latestSnapshot = backupSnapshots[0];

  const updateBackupConfig = (patch: Partial<BackupConfig>) => {
    setBackupConfig((current) => ({ ...current, ...patch }));
  };

  const selectedBackupBases = [
    backupConfig.includeResidents,
    backupConfig.includeMails,
    backupConfig.includeEntries,
    backupConfig.includeDevices,
  ].filter(Boolean).length;

  const getBackupPayload = async (): Promise<BackupPayload | null> => {
    if (selectedBackupBases === 0) {
      toast.error('Selecione pelo menos uma base de dados para o backup.');
      return null;
    }

    setIsBackupRunning(true);
    try {
      return await createBackupPayload(backupConfig);
    } catch (error) {
      console.error('Backup error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao gerar backup.');
      return null;
    } finally {
      setIsBackupRunning(false);
    }
  };

  const handleCreateAutomaticSnapshot = async (showToast = true) => {
    const payload = await getBackupPayload();
    if (!payload) return;

    const snapshots = persistBackupSnapshot(payload, backupConfig.autoRetention);
    setBackupSnapshots(snapshots);

    if (showToast) {
      toast.success('Backup automático atualizado no armazenamento local.');
    }
  };

  useEffect(() => {
    saveBackupConfig(backupConfig);
  }, [backupConfig]);

  const handleUnlockIntegrations = () => {
    if (integrationPassword === 'admin') {
      setIsIntegrationsUnlocked(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  };

  const handleExportJSON = async () => {
    const payload = await getBackupPayload();
    if (!payload) return;

    downloadJSON(payload, `portalguard-backup-${new Date().toISOString().split('T')[0]}.json`);
    toast.success('Backup JSON gerado com sucesso!');
  };

  const saveBackupPayloadAsPDF = (payload: BackupPayload, filename: string) => {
    const doc = new jsPDF();
    const { residents: backupResidents, mails, entries, devices } = payload.data;

    doc.setFontSize(18);
    doc.text('PortalGuard - Backup de Dados', 14, 20);
    doc.setFontSize(10);
    doc.text(`Data de exportação: ${new Date(payload.generatedAt).toLocaleString('pt-BR')}`, 14, 28);
    doc.text(`Acessos: ${backupRangeLabel(payload.filters.entryRange)} | Correspondências: ${backupRangeLabel(payload.filters.mailRange)}`, 14, 34);

    autoTable(doc, {
      startY: 40,
      head: [['Base', 'Registros']],
      body: [
        ['Moradores', payload.counts.residents],
        ['Correspondências', payload.counts.mails],
        ['Acessos', payload.counts.entries],
        ['Dispositivos', payload.counts.devices],
      ],
      theme: 'grid',
      styles: { fontSize: 8 },
    });

    let currentY = (doc as any).lastAutoTable?.finalY || 48;

    if (backupResidents.length > 0) {
      doc.setFontSize(14);
      doc.text('Moradores cadastrados', 14, currentY + 10);
      autoTable(doc, {
        startY: currentY + 14,
        head: [['Nome', 'Apartamento', 'Telefone', 'Veículo']],
        body: backupResidents.map((resident) => [
          resident.name,
          resident.apartment,
          resident.phone || '-',
          resident.vehiclePlate ? `${resident.vehiclePlate} (${resident.vehicleModel || '-'})` : '-',
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
      });
      currentY = (doc as any).lastAutoTable?.finalY || currentY;
    }

    if (mails.length > 0) {
      doc.setFontSize(14);
      doc.text('Correspondências', 14, currentY + 10);
      autoTable(doc, {
        startY: currentY + 14,
        head: [['Morador ID', 'Remetente', 'Tipo', 'Status', 'Data']],
        body: mails.map((mail) => [
          mail.residentId.substring(0, 12),
          mail.sender,
          mail.packageType,
          mail.status === 'pending' ? 'Pendente' : 'Entregue',
          new Date(mail.receivedAt).toLocaleDateString('pt-BR'),
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
      });
      currentY = (doc as any).lastAutoTable?.finalY || currentY;
    }

    if (entries.length > 0) {
      doc.setFontSize(14);
      doc.text('Registros de acesso', 14, currentY + 10);
      autoTable(doc, {
        startY: currentY + 14,
        head: [['Nome', 'Tipo', 'Apartamento', 'Entrada', 'Saída']],
        body: entries.map((entry) => [
          entry.visitorName,
          entry.visitorType === 'visitor' ? 'Visitante' : 'Prestador',
          entry.apartment,
          new Date(entry.entryTime).toLocaleString('pt-BR'),
          entry.exitTime ? new Date(entry.exitTime).toLocaleString('pt-BR') : 'Ativo',
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
      });
      currentY = (doc as any).lastAutoTable?.finalY || currentY;
    }

    if (devices.length > 0) {
      doc.setFontSize(14);
      doc.text('Dispositivos', 14, currentY + 10);
      autoTable(doc, {
        startY: currentY + 14,
        head: [['Nome', 'Tipo', 'Local', 'Status']],
        body: devices.map((device) => [device.name, device.type, device.location, device.status]),
        theme: 'grid',
        styles: { fontSize: 8 },
      });
    }

    doc.save(filename);
  };

  const handleExportData = async () => {
    const payload = await getBackupPayload();
    if (!payload) return;

    const doc = new jsPDF();
    const { residents: backupResidents, mails, entries, devices } = payload.data;

    doc.setFontSize(18);
    doc.text('PortalGuard - Backup de Dados', 14, 20);
    doc.setFontSize(10);
    doc.text(`Data de exportação: ${new Date(payload.generatedAt).toLocaleString('pt-BR')}`, 14, 28);
    doc.text(`Acessos: ${backupRangeLabel(payload.filters.entryRange)} | Correspondências: ${backupRangeLabel(payload.filters.mailRange)}`, 14, 34);

    autoTable(doc, {
      startY: 40,
      head: [['Base', 'Registros']],
      body: [
        ['Moradores', payload.counts.residents],
        ['Correspondências', payload.counts.mails],
        ['Acessos', payload.counts.entries],
        ['Dispositivos', payload.counts.devices],
      ],
      theme: 'grid',
      styles: { fontSize: 8 },
    });

    let currentY = (doc as any).lastAutoTable?.finalY || 48;

    if (backupResidents.length > 0) {
      doc.setFontSize(14);
      doc.text('Moradores cadastrados', 14, currentY + 10);
      autoTable(doc, {
        startY: currentY + 14,
        head: [['Nome', 'Apartamento', 'Telefone', 'Veículo']],
        body: backupResidents.map((resident) => [
          resident.name,
          resident.apartment,
          resident.phone || '-',
          resident.vehiclePlate ? `${resident.vehiclePlate} (${resident.vehicleModel || '-'})` : '-',
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
      });
      currentY = (doc as any).lastAutoTable?.finalY || currentY;
    }

    if (mails.length > 0) {
      doc.setFontSize(14);
      doc.text('Correspondências', 14, currentY + 10);
      autoTable(doc, {
        startY: currentY + 14,
        head: [['Morador ID', 'Remetente', 'Tipo', 'Status', 'Data']],
        body: mails.map((mail) => [
          mail.residentId.substring(0, 12),
          mail.sender,
          mail.packageType,
          mail.status === 'pending' ? 'Pendente' : 'Entregue',
          new Date(mail.receivedAt).toLocaleDateString('pt-BR'),
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
      });
      currentY = (doc as any).lastAutoTable?.finalY || currentY;
    }

    if (entries.length > 0) {
      doc.setFontSize(14);
      doc.text('Registros de acesso', 14, currentY + 10);
      autoTable(doc, {
        startY: currentY + 14,
        head: [['Nome', 'Tipo', 'Apartamento', 'Entrada', 'Saída']],
        body: entries.map((entry) => [
          entry.visitorName,
          entry.visitorType === 'visitor' ? 'Visitante' : 'Prestador',
          entry.apartment,
          new Date(entry.entryTime).toLocaleString('pt-BR'),
          entry.exitTime ? new Date(entry.exitTime).toLocaleString('pt-BR') : 'Ativo',
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
      });
      currentY = (doc as any).lastAutoTable?.finalY || currentY;
    }

    if (devices.length > 0) {
      doc.setFontSize(14);
      doc.text('Dispositivos', 14, currentY + 10);
      autoTable(doc, {
        startY: currentY + 14,
        head: [['Nome', 'Tipo', 'Local', 'Status']],
        body: devices.map((device) => [device.name, device.type, device.location, device.status]),
        theme: 'grid',
        styles: { fontSize: 8 },
      });
    }

    doc.save(`portalguard-backup-${new Date().toISOString().split('T')[0]}.pdf`);
    toast.success('Backup em PDF gerado com sucesso!');
  };

  const handleExportCSV = async () => {
    const payload = await getBackupPayload();
    if (!payload) return;

    const date = new Date().toISOString().split('T')[0];
    let exportedFiles = 0;

    if (payload.data.residents.length > 0) {
      const rows = payload.data.residents.map((resident) => ({
        id: resident.id,
        name: resident.name,
        apartment: resident.apartment,
        cpf: resident.cpf || '',
        phone: resident.phone || '',
        email: resident.email || '',
        vehiclePlate: resident.vehiclePlate || '',
        vehicleModel: resident.vehicleModel || '',
        vehicleColor: resident.vehicleColor || '',
        vehicleTag: resident.vehicleTag || '',
      }));
      downloadCSV(arrayToCSV(rows, Object.keys(rows[0])), `moradores-${date}.csv`);
      exportedFiles++;
    }

    if (payload.data.mails.length > 0) {
      const rows = payload.data.mails.map((mail) => ({
        id: mail.id,
        residentId: mail.residentId,
        sender: mail.sender,
        packageType: mail.packageType,
        status: mail.status,
        receivedAt: mail.receivedAt,
        deliveredAt: mail.deliveredAt || '',
        withdrawnBy: mail.withdrawnBy || '',
      }));
      downloadCSV(arrayToCSV(rows, Object.keys(rows[0])), `correspondencias-${date}.csv`);
      exportedFiles++;
    }

    if (payload.data.entries.length > 0) {
      const rows = payload.data.entries.map((entry) => ({
        id: entry.id,
        visitorName: entry.visitorName,
        visitorType: entry.visitorType,
        visitorDocument: entry.visitorDocument || '',
        apartment: entry.apartment,
        purpose: entry.purpose || '',
        entryTime: entry.entryTime,
        exitTime: entry.exitTime || '',
        company: entry.company || '',
        vehiclePlate: entry.vehiclePlate || '',
        vehicleModel: entry.vehicleModel || '',
        vehicleColor: entry.vehicleColor || '',
        badgeNumber: entry.badgeNumber || '',
      }));
      downloadCSV(arrayToCSV(rows, Object.keys(rows[0])), `acessos-${date}.csv`);
      exportedFiles++;
    }

    if (payload.data.devices.length > 0) {
      const rows = payload.data.devices.map((device) => ({
        id: device.id,
        name: device.name,
        type: device.type,
        location: device.location,
        status: device.status,
        lastSync: device.lastSync,
        ipAddress: device.ipAddress || '',
        serialNumber: device.serialNumber || '',
      }));
      downloadCSV(arrayToCSV(rows, Object.keys(rows[0])), `dispositivos-${date}.csv`);
      exportedFiles++;
    }

    exportedFiles > 0
      ? toast.success(`${exportedFiles} arquivo(s) CSV exportado(s) com sucesso!`)
      : toast.warning('Nenhum registro encontrado com os filtros atuais.');
  };

  const handleImportData = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const text = event.target?.result as string;
          if (!text || text.trim() === '') {
            toast.error('Arquivo vazio ou inválido');
            return;
          }

          const parsed = JSON.parse(text);
          const data = parsed.data || parsed;
          let successCount = 0;
          let errorCount = 0;

          if (data.residents && Array.isArray(data.residents)) {
            for (const resident of data.residents) {
              const success = await supabaseStorage.saveResident(resident);
              success ? successCount++ : errorCount++;
            }
          }

          if (data.mails && Array.isArray(data.mails)) {
            for (const mail of data.mails) {
              const success = await supabaseStorage.saveMail(mail);
              success ? successCount++ : errorCount++;
            }
          }

          if (data.entries && Array.isArray(data.entries)) {
            for (const entry of data.entries) {
              const success = await supabaseStorage.saveEntry(entry);
              success ? successCount++ : errorCount++;
            }
          }

          if (data.devices && Array.isArray(data.devices)) {
            for (const device of data.devices) {
              const success = await supabaseStorage.saveDevice(device);
              success ? successCount++ : errorCount++;
            }
          }

          if (successCount > 0) toast.success(`${successCount} registros importados com sucesso!`);
          if (errorCount > 0) toast.error(`${errorCount} registros falharam na importação.`);
          if (successCount === 0 && errorCount === 0) toast.warning('Nenhum dado válido encontrado no arquivo.');
        } catch (error) {
          console.error('Import error:', error);
          toast.error('Erro ao importar dados. Verifique o formato do arquivo JSON.');
        }
      };
      reader.readAsText(file);
    };

    input.click();
  };

  const handleImportCSV = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.multiple = true;

    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      let processedFiles = 0;
      const totalFiles = files.length;

      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const text = event.target?.result as string;
            if (!text || text.trim() === '') {
              toast.error(`Arquivo ${file.name} está vazio`);
              return;
            }

            const data = parseCSV(text);
            if (!data || data.length === 0) {
              toast.error(`Nenhum dado encontrado em ${file.name}`);
              return;
            }

            let successCount = 0;
            let skippedCount = 0;

            if (file.name.includes('morador')) {
              for (const resident of data) {
                const success = await supabaseStorage.saveResident(resident);
                success ? successCount++ : skippedCount++;
              }
              const msg = `${successCount} moradores importados${skippedCount > 0 ? ` (${skippedCount} duplicados ignorados)` : ''}`;
              successCount > 0 ? toast.success(msg) : toast.warning(msg);
            } else if (file.name.includes('correspondencia')) {
              for (const mail of data) {
                const success = await supabaseStorage.saveMail(mail);
                success ? successCount++ : skippedCount++;
              }
              const msg = `${successCount} correspondências importadas${skippedCount > 0 ? ` (${skippedCount} duplicados ignorados)` : ''}`;
              successCount > 0 ? toast.success(msg) : toast.warning(msg);
            } else if (file.name.includes('acesso')) {
              for (const entry of data) {
                const success = await supabaseStorage.saveEntry(entry);
                success ? successCount++ : skippedCount++;
              }
              const msg = `${successCount} acessos importados${skippedCount > 0 ? ` (${skippedCount} duplicados ignorados)` : ''}`;
              successCount > 0 ? toast.success(msg) : toast.warning(msg);
            } else {
              toast.warning(`Arquivo ${file.name} não reconhecido. Use: moradores-*.csv, correspondencias-*.csv ou acessos-*.csv`);
            }

            processedFiles++;
            if (processedFiles === totalFiles) {
              setTimeout(() => toast.info('Importação concluída!'), 1000);
            }
          } catch (error) {
            console.error('CSV import error:', error);
            toast.error(`Erro ao importar ${file.name}. Verifique o formato CSV.`);
          }
        };
        reader.readAsText(file);
      }
    };

    input.click();
  };

  const handleImportPDF = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.multiple = true;

    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      toast.info('Processando arquivos PDF...');
      const {
        smartExtractText,
        parseResidentsFromText,
        parsedToResident,
        detectTextType,
        parseAccessEntriesFromText,
        parsedToAccessEntry,
      } = await import('@/lib/pdf-import');

      for (const file of Array.from(files)) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          toast.info(`Extraindo texto de ${file.name}...`);
          const { text, method } = await smartExtractText(arrayBuffer, file.name);

          if (method === 'ocr') {
            toast.info(`OCR utilizado para ${file.name}`);
          }

          if (!text || text.trim().length < 10) {
            toast.warning(`Não foi possível extrair texto de ${file.name}.`);
            continue;
          }

          const dataType = detectTextType(text);

          if (dataType === 'access') {
            const parsed = parseAccessEntriesFromText(text);
            if (parsed.length === 0) {
              toast.warning(`Nenhum registro de acesso reconhecido em ${file.name}.`, { duration: 8000 });
              continue;
            }

            let importedCount = 0;
            let skippedCount = 0;
            for (const parsedEntry of parsed) {
              const entry = parsedToAccessEntry(parsedEntry);
              const resident = residents.find((item) => item.apartment.toLowerCase() === entry.apartment.toLowerCase());
              if (resident) {
                entry.residentId = resident.id;
                entry.residentName = resident.name;
              }
              const success = await supabaseStorage.saveEntry(entry);
              success ? importedCount++ : skippedCount++;
            }

            const msg = `${importedCount} registros de acesso importados de ${file.name}${skippedCount > 0 ? ` (${skippedCount} com falha)` : ''}`;
            importedCount > 0 ? toast.success(msg) : toast.warning(msg);
          } else {
            const parsed = parseResidentsFromText(text);
            if (parsed.length === 0) {
              toast.warning(
                `Nenhum dado reconhecido em ${file.name}. Formatos aceitos: tabelas, "Nome | Apto | Tel", "Nome - Apto 101", campos rotulados, CSV com ; ou ,.`,
                { duration: 8000 },
              );
              continue;
            }

            let importedCount = 0;
            let skippedCount = 0;
            for (const parsedResident of parsed) {
              const resident = parsedToResident(parsedResident);
              const success = await supabaseStorage.saveResident(resident);
              success ? importedCount++ : skippedCount++;
            }

            const msg = `${importedCount} moradores importados de ${file.name}${skippedCount > 0 ? ` (${skippedCount} duplicados ignorados)` : ''}`;
            importedCount > 0 ? toast.success(msg) : toast.warning(msg);
          }
        } catch (error) {
          console.error('PDF import error:', error);
          toast.error(`Erro ao processar ${file.name}. Tente um formato diferente.`);
        }
      }
    };

    input.click();
  };

  const handleClearData = () => {
    if (!confirm('Atenção: isso limpará apenas dados locais, rascunhos e cache deste navegador. Os dados salvos no Supabase serão preservados. Deseja continuar?')) {
      return;
    }

    if (!confirm('Última confirmação: limpar os dados locais deste navegador agora?')) {
      return;
    }

    CLEARABLE_LOCAL_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    toast.success('Dados locais e cache limpos. Sua sessão foi preservada.');
  };

  const handleDownloadLatestSnapshot = () => {
    if (!latestSnapshot) {
      toast.warning('Nenhum backup automático disponível para baixar.');
      return;
    }

    saveBackupPayloadAsPDF(latestSnapshot.payload, `portalguard-backup-auto-${latestSnapshot.generatedAt.split('T')[0]}.pdf`);
    toast.success('Último backup automático baixado em PDF.');
  };

  const handleClearAutomaticSnapshots = () => {
    localStorage.removeItem('portalguard-backup-snapshots-v1');
    setBackupSnapshots([]);
    toast.success('Histórico local de backups automáticos limpo.');
  };

  const renderBackupCheckbox = (
    id: string,
    label: string,
    description: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ) => (
    <div className="flex items-start gap-3 rounded-lg border bg-background p-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="mb-2 text-3xl font-bold text-foreground">Configurações</h2>
        <p className="text-muted-foreground">Gerencie segurança, backup e integrações do sistema</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <DatabaseBackup className="h-5 w-5 text-primary" />
                  <span>Backup e restauração</span>
                </CardTitle>
                <CardDescription>
                  Exporte dados reais do Supabase com filtros para reduzir consultas e tamanho dos arquivos
                </CardDescription>
              </div>
              <Badge variant="outline" className="w-fit">
                {selectedBackupBases} base(s) selecionada(s)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold">Filtros do backup</h3>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {renderBackupCheckbox(
                    'backup-residents',
                    'Moradores',
                    'Cadastro principal, veículos e TAGs.',
                    backupConfig.includeResidents,
                    (checked) => updateBackupConfig({ includeResidents: checked }),
                  )}
                  {renderBackupCheckbox(
                    'backup-mails',
                    'Correspondências',
                    'Registros recentes conforme período escolhido.',
                    backupConfig.includeMails,
                    (checked) => updateBackupConfig({ includeMails: checked }),
                  )}
                  {renderBackupCheckbox(
                    'backup-entries',
                    'Logs de acesso',
                    'Visitantes, prestadores e histórico filtrado.',
                    backupConfig.includeEntries,
                    (checked) => updateBackupConfig({ includeEntries: checked }),
                  )}
                  {renderBackupCheckbox(
                    'backup-devices',
                    'Dispositivos',
                    'Equipamentos cadastrados e identificadores.',
                    backupConfig.includeDevices,
                    (checked) => updateBackupConfig({ includeDevices: checked }),
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Período dos acessos</Label>
                    <Select value={backupConfig.entryRange} onValueChange={(value) => updateBackupConfig({ entryRange: value as BackupRange })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rangeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Status dos acessos</Label>
                    <Select value={backupConfig.entryStatus} onValueChange={(value) => updateBackupConfig({ entryStatus: value as BackupEntryStatus })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {entryStatusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Período das correspondências</Label>
                    <Select value={backupConfig.mailRange} onValueChange={(value) => updateBackupConfig({ mailRange: value as BackupRange })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rangeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Limite por tabela filtrada</Label>
                    <Select value={String(backupConfig.maxRows)} onValueChange={(value) => updateBackupConfig({ maxRows: Number(value) })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {maxRowOptions.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option} registros
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-lg border bg-background p-3 text-sm">
                    <p className="font-medium">Perfil atual</p>
                    <p className="mt-1 text-muted-foreground">
                      Acessos: {backupRangeLabel(backupConfig.entryRange).toLowerCase()} - Correspondências: {backupRangeLabel(backupConfig.mailRange).toLowerCase()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <Button onClick={handleExportData} disabled={isBackupRunning} className="w-full">
                    <FileText className="mr-2 h-4 w-4" />
                    Exportar PDF
                  </Button>
                  <Button onClick={handleExportCSV} disabled={isBackupRunning} className="w-full" variant="outline">
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Exportar CSV
                  </Button>
                  <Button onClick={handleExportJSON} disabled={isBackupRunning} className="w-full" variant="outline">
                    <FileJson className="mr-2 h-4 w-4" />
                    JSON técnico
                  </Button>
                  <Button onClick={() => setBackupConfig(DEFAULT_BACKUP_CONFIG)} disabled={isBackupRunning} className="w-full" variant="ghost">
                    <RotateCw className="mr-2 h-4 w-4" />
                    Padrão
                  </Button>
                </div>
              </div>

              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-primary" />
                      <h3 className="text-base font-semibold">Backup automático</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Salva snapshots locais compactos quando o app abre e o período está vencido.
                    </p>
                  </div>
                  <Switch checked={backupConfig.autoEnabled} onCheckedChange={(checked) => updateBackupConfig({ autoEnabled: checked })} />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Frequência</Label>
                    <Select value={backupConfig.autoFrequency} onValueChange={(value) => updateBackupConfig({ autoFrequency: value as BackupFrequency })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {frequencyOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Retenção local</Label>
                    <Select value={String(backupConfig.autoRetention)} onValueChange={(value) => updateBackupConfig({ autoRetention: Number(value) })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {retentionOptions.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option} backup(s)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-lg border bg-background p-3 text-sm">
                  <p className="font-medium">Último backup automático</p>
                  <p className="mt-1 text-muted-foreground">{formatDateTime(latestSnapshot?.generatedAt)}</p>
                  {latestSnapshot && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatBytes(latestSnapshot.size)} - {latestSnapshot.counts.residents} moradores, {latestSnapshot.counts.entries} acessos
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Button onClick={() => handleCreateAutomaticSnapshot(true)} disabled={isBackupRunning} variant="outline">
                    <Archive className="mr-2 h-4 w-4" />
                    Executar agora
                  </Button>
                  <Button onClick={handleDownloadLatestSnapshot} disabled={!latestSnapshot} variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Baixar PDF
                  </Button>
                </div>

                <Button onClick={handleClearAutomaticSnapshots} disabled={backupSnapshots.length === 0} variant="ghost" className="w-full">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Limpar histórico local de backups
                </Button>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Button onClick={handleImportData} className="w-full" variant="outline">
                <Upload className="mr-2 h-4 w-4" />
                Importar JSON
              </Button>
              <Button onClick={handleImportCSV} className="w-full" variant="outline">
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Importar CSV
              </Button>
              <Button onClick={handleImportPDF} className="w-full" variant="outline">
                <FileText className="mr-2 h-4 w-4" />
                Importar PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              <span>Integrações</span>
              <Lock className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
            <CardDescription>
              Configure dispositivos, notificações e ações sensíveis em área protegida por senha
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isIntegrationsUnlocked ? (
              <div className="space-y-4 rounded-lg bg-muted p-6">
                <div className="flex items-center justify-center">
                  <Lock className="h-12 w-12 text-primary" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Digite a senha para acessar as configurações de integrações e manutenção sensível.
                </p>
                <div className="mx-auto flex max-w-sm gap-2">
                  <Input
                    type="password"
                    placeholder="Senha"
                    value={integrationPassword}
                    onChange={(event) => {
                      setIntegrationPassword(event.target.value);
                      setPasswordError(false);
                    }}
                    onKeyDown={(event) => event.key === 'Enter' && handleUnlockIntegrations()}
                  />
                  <Button onClick={handleUnlockIntegrations}>
                    <Lock className="mr-2 h-4 w-4" />
                    Desbloquear
                  </Button>
                </div>
                {passwordError && <p className="text-center text-sm text-destructive">Senha incorreta</p>}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-lg border border-success bg-success/10 p-3">
                  <span className="text-sm font-medium text-success">Acesso de administrador concedido</span>
                </div>

                <div className="rounded-lg bg-muted p-4">
                  <Label className="mb-2 block text-base font-semibold">Control iD - Webhook</Label>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Dados para modo monitor, push e callbacks dos dispositivos Control iD.
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Hostname</p>
                      <code className="block overflow-x-auto rounded bg-background p-2 text-xs">{webhookHost}</code>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Porta</p>
                      <code className="block rounded bg-background p-2 text-xs">443</code>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Monitor path</p>
                      <code className="block overflow-x-auto rounded bg-background p-2 text-xs">{monitorPath}</code>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Push remote address</p>
                      <code className="block overflow-x-auto rounded bg-background p-2 text-xs">{pushEndpoint}</code>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <p className="text-xs text-muted-foreground">Rotas aceitas pelo webhook</p>
                      <code className="block overflow-x-auto rounded bg-background p-2 text-xs">{acceptedPushRoutes}</code>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <p className="text-xs text-muted-foreground">Timeouts recomendados</p>
                      <code className="block overflow-x-auto rounded bg-background p-2 text-xs">
                        monitor.request_timeout=5000 - online_client.request_timeout=5000 - push_request_timeout=15000 - push_request_period=5s
                      </code>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <p className="text-xs text-muted-foreground">Modo online persistente</p>
                      <code className="block overflow-x-auto rounded bg-background p-2 text-xs">
                        general.online=1 - general.local_identification=1 - online_client.server_id=900001
                      </code>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-lg bg-muted p-4">
                    <Label className="mb-2 block text-base font-semibold">WhatsApp Business API</Label>
                    <p className="mb-3 text-sm text-muted-foreground">
                      Envie notificações automáticas quando uma correspondência for registrada.
                    </p>
                    <Input placeholder="Token da API" type="password" className="mb-2" />
                    <Input placeholder="Número de telefone (ex: 5511999999999)" className="mb-2" />
                    <Button variant="outline" className="w-full">
                      <Send className="mr-2 h-4 w-4" />
                      Conectar WhatsApp
                    </Button>
                  </div>

                  <div className="rounded-lg bg-muted p-4">
                    <Label className="mb-2 block text-base font-semibold">Email - SMTP</Label>
                    <p className="mb-3 text-sm text-muted-foreground">
                      Configure o servidor SMTP para enviar emails automáticos aos moradores.
                    </p>
                    <Input placeholder="Servidor SMTP (ex: smtp.gmail.com)" className="mb-2" />
                    <Input placeholder="Porta (ex: 587)" className="mb-2" />
                    <Input placeholder="Email" type="email" className="mb-2" />
                    <Input placeholder="Senha" type="password" className="mb-2" />
                    <Button variant="outline" className="w-full">
                      <Send className="mr-2 h-4 w-4" />
                      Configurar Email
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-destructive">Zona de perigo</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Ações de manutenção local. Esta limpeza remove cache, rascunhos e dados salvos apenas neste navegador.
                      </p>
                    </div>
                  </div>
                  <Button onClick={handleClearData} variant="destructive" className="mt-4 w-full sm:w-auto">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Limpar dados locais e cache
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-primary" />
              <span>Informações do sistema</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
              <div className="rounded-lg bg-muted p-4">
                <p className="mb-1 text-muted-foreground">Versão</p>
                <p className="font-semibold">PortalGuard Pro v1.0</p>
              </div>
              <div className="rounded-lg bg-muted p-4">
                <p className="mb-1 text-muted-foreground">Armazenamento</p>
                <p className="font-semibold">Supabase</p>
              </div>
              <div className="rounded-lg bg-muted p-4">
                <p className="mb-1 text-muted-foreground">Status</p>
                <p className="font-semibold text-success">Operacional</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
