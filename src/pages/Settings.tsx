import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings as SettingsIcon, Trash2, Download, Upload, Send, FileText, FileSpreadsheet, Lock } from 'lucide-react';
import { storage } from '@/lib/storage';
import { supabase } from '@/integrations/supabase/client';
import { supabaseStorage } from '@/lib/supabase-storage';
import { useResidents } from '@/hooks/useResidents';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useState, useEffect } from 'react';

// Funções auxiliares para CSV
const arrayToCSV = (data: any[], headers: string[]) => {
  const csvRows = [];
  csvRows.push(headers.join(','));
  
  for (const row of data) {
    const values = headers.map(header => {
      const escaped = ('' + row[header]).replace(/"/g, '\\"');
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
};

const parseCSV = (text: string): any[] => {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
    const obj: any = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] || '';
    });
    rows.push(obj);
  }
  
  return rows;
};

export const Settings = () => {
  const { residents } = useResidents();
  const [isIntegrationsUnlocked, setIsIntegrationsUnlocked] = useState(false);
  const [integrationPassword, setIntegrationPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  let webhookHost = 'qasudwuoagblzfkvmyxx.supabase.co';
  try {
    webhookHost = new URL(supabaseUrl).hostname;
  } catch {
    webhookHost = 'qasudwuoagblzfkvmyxx.supabase.co';
  }
  const monitorPath = '/functions/v1/controlid-webhook';
  const pushAddress = `https://${webhookHost}${monitorPath}`;
  const acceptedPushRoutes = `${monitorPath} e ${monitorPath}/push`;

  const handleUnlockIntegrations = () => {
    if (integrationPassword === 'admin') {
      setIsIntegrationsUnlocked(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  };


  const handleExportData = async () => {
    const doc = new jsPDF();
    const residents = await storage.getResidents();
    const mails = await storage.getMails();
    const entries = await storage.getEntries();
    
    // Header
    doc.setFontSize(18);
    doc.text('PortalGuard - Backup de Dados', 14, 20);
    doc.setFontSize(10);
    doc.text(`Data de exportação: ${new Date().toLocaleString('pt-BR')}`, 14, 28);
    
    // Residents
    doc.setFontSize(14);
    doc.text('Moradores Cadastrados', 14, 38);
    
    if (residents.length > 0) {
      autoTable(doc, {
        startY: 42,
        head: [['Nome', 'Apartamento', 'Telefone', 'Veículo']],
        body: residents.map(r => [
          r.name,
          r.apartment,
          r.phone || '-',
          r.vehiclePlate ? `${r.vehiclePlate} (${r.vehicleModel || '-'})` : '-'
        ]),
        theme: 'grid',
        styles: { fontSize: 8 }
      });
    }
    
    // Mails
    const finalY1 = (doc as any).lastAutoTable?.finalY || 42;
    doc.setFontSize(14);
    doc.text('Correspondências', 14, finalY1 + 10);
    
    if (mails.length > 0) {
      autoTable(doc, {
        startY: finalY1 + 14,
        head: [['Morador ID', 'Remetente', 'Tipo', 'Status', 'Data']],
        body: mails.map(m => [
          m.residentId.substring(0, 12),
          m.sender,
          m.packageType,
          m.status === 'pending' ? 'Pendente' : 'Entregue',
          new Date(m.receivedAt).toLocaleDateString('pt-BR')
        ]),
        theme: 'grid',
        styles: { fontSize: 8 }
      });
    }
    
    // Entries
    const finalY2 = (doc as any).lastAutoTable?.finalY || finalY1 + 14;
    doc.setFontSize(14);
    doc.text('Registros de Acesso', 14, finalY2 + 10);
    
    if (entries.length > 0) {
      autoTable(doc, {
        startY: finalY2 + 14,
        head: [['Nome', 'Tipo', 'Apartamento', 'Entrada', 'Saída']],
        body: entries.map(e => [
          e.visitorName,
          e.visitorType === 'visitor' ? 'Visitante' : 'Prestador',
          e.apartment,
          new Date(e.entryTime).toLocaleString('pt-BR'),
          e.exitTime ? new Date(e.exitTime).toLocaleString('pt-BR') : 'Ativo'
        ]),
        theme: 'grid',
        styles: { fontSize: 8 }
      });
    }
    
    // Save PDF
    doc.save(`portalguard-backup-${new Date().toISOString().split('T')[0]}.pdf`);
    toast.success('Backup em PDF gerado com sucesso!');
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

          const data = JSON.parse(text);
          let successCount = 0;
          let errorCount = 0;
          
          // Importar moradores
          if (data.residents && Array.isArray(data.residents)) {
            for (const resident of data.residents) {
              const success = await supabaseStorage.saveResident(resident);
              success ? successCount++ : errorCount++;
            }
          }
          
          // Importar correspondências
          if (data.mails && Array.isArray(data.mails)) {
            for (const mail of data.mails) {
              const success = await supabaseStorage.saveMail(mail);
              success ? successCount++ : errorCount++;
            }
          }
          
          // Importar registros de acesso
          if (data.entries && Array.isArray(data.entries)) {
            for (const entry of data.entries) {
              const success = await supabaseStorage.saveEntry(entry);
              success ? successCount++ : errorCount++;
            }
          }
          
          // Importar dispositivos
          if (data.devices && Array.isArray(data.devices)) {
            for (const device of data.devices) {
              const success = await supabaseStorage.saveDevice(device);
              success ? successCount++ : errorCount++;
            }
          }

          if (successCount > 0) {
            toast.success(`${successCount} registros importados com sucesso!`);
          }
          if (errorCount > 0) {
            toast.error(`${errorCount} registros falharam na importação.`);
          }
          if (successCount === 0 && errorCount === 0) {
            toast.warning('Nenhum dado válido encontrado no arquivo.');
          }
        } catch (error) {
          console.error('Import error:', error);
          toast.error('Erro ao importar dados. Verifique o formato do arquivo JSON.');
        }
      };
      reader.readAsText(file);
    };

    input.click();
  };

  const handleExportCSV = async () => {
    const residents = await storage.getResidents();
    const mails = await storage.getMails();
    const entries = await storage.getEntries();
    
    // Export Residents
    if (residents.length > 0) {
      const residentsData = residents.map(r => ({
        id: r.id,
        name: r.name,
        apartment: r.apartment,
        cpf: r.cpf || '',
        phone: r.phone || '',
        email: r.email || '',
        vehiclePlate: r.vehiclePlate || '',
        vehicleModel: r.vehicleModel || '',
        vehicleColor: r.vehicleColor || ''
      }));
      const csv = arrayToCSV(residentsData, ['id', 'name', 'apartment', 'cpf', 'phone', 'email', 'vehiclePlate', 'vehicleModel', 'vehicleColor']);
      downloadCSV(csv, `moradores-${new Date().toISOString().split('T')[0]}.csv`);
    }
    
    // Export Mails
    if (mails.length > 0) {
      const mailsData = mails.map(m => ({
        id: m.id,
        residentId: m.residentId,
        sender: m.sender,
        packageType: m.packageType,
        status: m.status,
        receivedAt: m.receivedAt,
        deliveredAt: m.deliveredAt || ''
      }));
      const csv = arrayToCSV(mailsData, ['id', 'residentId', 'sender', 'packageType', 'status', 'receivedAt', 'deliveredAt']);
      downloadCSV(csv, `correspondencias-${new Date().toISOString().split('T')[0]}.csv`);
    }
    
    // Export Entries
    if (entries.length > 0) {
      const entriesData = entries.map(e => ({
        id: e.id,
        visitorName: e.visitorName,
        visitorType: e.visitorType,
        visitorDocument: e.visitorDocument || '',
        apartment: e.apartment,
        purpose: e.purpose || '',
        entryTime: e.entryTime,
        exitTime: e.exitTime || '',
        company: e.company || '',
        vehiclePlate: e.vehiclePlate || '',
        vehicleModel: e.vehicleModel || '',
        vehicleColor: e.vehicleColor || ''
      }));
      const csv = arrayToCSV(entriesData, ['id', 'visitorName', 'visitorType', 'visitorDocument', 'apartment', 'purpose', 'entryTime', 'exitTime', 'company', 'vehiclePlate', 'vehicleModel', 'vehicleColor']);
      downloadCSV(csv, `acessos-${new Date().toISOString().split('T')[0]}.csv`);
    }
    
    toast.success('Arquivos CSV exportados com sucesso!');
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
            
            // Identifica o tipo de arquivo pelo nome
            if (file.name.includes('morador')) {
              for (const resident of data) {
                const success = await supabaseStorage.saveResident(resident);
                success ? successCount++ : skippedCount++;
              }
              let msg = `${successCount} moradores importados!`;
              if (skippedCount > 0) msg += ` (${skippedCount} duplicados ignorados)`;
              successCount > 0 ? toast.success(msg) : toast.warning(msg);
            } else if (file.name.includes('correspondencia')) {
              for (const mail of data) {
                const success = await supabaseStorage.saveMail(mail);
                success ? successCount++ : skippedCount++;
              }
              let msg = `${successCount} correspondências importadas!`;
              if (skippedCount > 0) msg += ` (${skippedCount} duplicados ignorados)`;
              successCount > 0 ? toast.success(msg) : toast.warning(msg);
            } else if (file.name.includes('acesso')) {
              for (const entry of data) {
                const success = await supabaseStorage.saveEntry(entry);
                success ? successCount++ : skippedCount++;
              }
              let msg = `${successCount} acessos importados!`;
              if (skippedCount > 0) msg += ` (${skippedCount} duplicados ignorados)`;
              successCount > 0 ? toast.success(msg) : toast.warning(msg);
            } else {
              toast.warning(`Arquivo ${file.name} não reconhecido. Use: moradores-*.csv, correspondencias-*.csv ou acessos-*.csv`);
            }
            
            processedFiles++;
            if (processedFiles === totalFiles) {
              setTimeout(() => {
                toast.info('Importação concluída!');
              }, 1000);
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
      
      const { smartExtractText, parseResidentsFromText, parsedToResident, detectTextType, parseAccessEntriesFromText, parsedToAccessEntry } = await import('@/lib/pdf-import');

      for (const file of Array.from(files)) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          
          toast.info(`Extraindo texto de ${file.name}...`);
          const { text, method } = await smartExtractText(arrayBuffer, file.name);
          
          if (method === 'ocr') {
            toast.info(`OCR utilizado para ${file.name} (PDF escaneado detectado)`);
          }

          if (!text || text.trim().length < 10) {
            toast.warning(`Não foi possível extrair texto de ${file.name}.`);
            continue;
          }

          // Auto-detect data type
          const dataType = detectTextType(text);
          
          if (dataType === 'access') {
            // Parse as access entries
            const parsed = parseAccessEntriesFromText(text);
            if (parsed.length === 0) {
              toast.warning(`Nenhum registro de acesso reconhecido em ${file.name}.`, { duration: 8000 });
              continue;
            }

            // Try to match apartments to residents
            let importedCount = 0;
            let skippedCount = 0;
            for (const p of parsed) {
              const entry = parsedToAccessEntry(p);
              // Match resident by apartment
              const resident = residents.find(r => r.apartment.toLowerCase() === entry.apartment.toLowerCase());
              if (resident) {
                entry.residentId = resident.id;
                entry.residentName = resident.name;
              }
              const success = await supabaseStorage.saveEntry(entry);
              if (success) importedCount++;
              else skippedCount++;
            }

            let msg = `${importedCount} registros de acesso importados de ${file.name}`;
            if (skippedCount > 0) msg += ` (${skippedCount} com falha)`;
            importedCount > 0 ? toast.success(msg) : toast.warning(msg);
          } else {
            // Parse as residents (default)
            const parsed = parseResidentsFromText(text);
            
            if (parsed.length === 0) {
              toast.warning(
                `Nenhum dado reconhecido em ${file.name}. Formatos aceitos: tabelas, "Nome | Apto | Tel", "Nome - Apto 101", campos rotulados (Nome: ..., Apartamento: ...), CSV com ; ou ,.`,
                { duration: 8000 }
              );
              continue;
            }

            let importedCount = 0;
            let skippedCount = 0;
            for (const p of parsed) {
              const resident = parsedToResident(p);
              const success = await supabaseStorage.saveResident(resident);
              if (success) importedCount++;
              else skippedCount++;
            }
            
            let msg = `${importedCount} moradores importados de ${file.name}`;
            if (skippedCount > 0) msg += ` (${skippedCount} duplicados ignorados)`;
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
    if (!confirm('ATENÇÃO: Isso removerá TODOS os dados do sistema. Esta ação não pode ser desfeita. Deseja continuar?')) {
      return;
    }

    if (!confirm('Última confirmação: Tem certeza absoluta?')) {
      return;
    }

    localStorage.clear();
    toast.success('Todos os dados foram removidos. Recarregue a página.');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-2">Configurações</h2>
        <p className="text-muted-foreground">Gerencie as configurações do sistema</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <SettingsIcon className="h-5 w-5 text-primary" />
              <span>Backup e Restauração</span>
            </CardTitle>
            <CardDescription>
              Exporte e importe dados em CSV, PDF ou JSON
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={handleExportData} className="w-full" variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Exportar PDF
              </Button>
              <Button onClick={handleExportCSV} className="w-full" variant="outline">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Exportar CSV
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={handleImportData} className="w-full" variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Importar JSON
              </Button>
              <Button onClick={handleImportCSV} className="w-full" variant="outline">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Importar CSV
              </Button>
              <Button onClick={handleImportPDF} className="w-full" variant="outline">
                <FileText className="h-4 w-4 mr-2" />
                Importar PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              <span>Zona de Perigo</span>
            </CardTitle>
            <CardDescription>
              Ações irreversíveis - use com cuidado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleClearData}
              variant="destructive"
              className="w-full"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Limpar Todos os Dados
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Esta ação removerá permanentemente todos os moradores, correspondências e registros de acesso.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Send className="h-5 w-5 text-primary" />
              <span>Integrações</span>
              <Lock className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
            <CardDescription>
              Configure integrações com dispositivos e notificações (Protegido por senha)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isIntegrationsUnlocked ? (
              <div className="p-6 bg-muted rounded-lg space-y-4">
                <div className="flex items-center justify-center mb-4">
                  <Lock className="h-12 w-12 text-primary" />
                </div>
                <p className="text-center text-sm text-muted-foreground mb-4">
                  Digite a senha para acessar as configurações de integrações.
                </p>
                <div className="flex gap-2 max-w-sm mx-auto">
                  <Input
                    type="password"
                    placeholder="Senha"
                    value={integrationPassword}
                    onChange={(e) => { setIntegrationPassword(e.target.value); setPasswordError(false); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleUnlockIntegrations()}
                  />
                  <Button onClick={handleUnlockIntegrations}>
                    <Lock className="h-4 w-4 mr-2" />
                    Desbloquear
                  </Button>
                </div>
                {passwordError && (
                  <p className="text-center text-sm text-destructive">Senha incorreta</p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4 p-3 bg-success/10 border border-success rounded-lg">
                  <span className="text-sm font-medium text-success">🔓 Acesso de administrador concedido</span>
                </div>
                
                <div className="p-4 bg-muted rounded-lg space-y-3">
                  <Label className="text-base font-semibold mb-2 block">Control iD - Webhook</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Dados atualizados para monitor, push e callbacks dos dispositivos Control iD.
                  </p>
                  <div className="p-3 bg-primary/10 rounded-lg space-y-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Hostname:</p>
                      <code className="text-xs bg-background p-2 rounded block overflow-x-auto">{webhookHost}</code>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Porta:</p>
                      <code className="text-xs bg-background p-2 rounded block">443</code>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Monitor path:</p>
                      <code className="text-xs bg-background p-2 rounded block overflow-x-auto">{monitorPath}</code>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Push remote address:</p>
                      <code className="text-xs bg-background p-2 rounded block overflow-x-auto">{pushAddress}</code>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Rotas aceitas pelo webhook:</p>
                      <code className="text-xs bg-background p-2 rounded block overflow-x-auto">{acceptedPushRoutes}</code>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Timeouts:</p>
                      <code className="text-xs bg-background p-2 rounded block overflow-x-auto">monitor.request_timeout=15000 • push_request_timeout=120000 • push_request_period=5</code>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-muted rounded-lg">
                  <Label className="text-base font-semibold mb-2 block">WhatsApp Business API</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Envie notificações automáticas via WhatsApp quando uma correspondência for registrada.
                  </p>
                  <Input placeholder="Token da API" type="password" className="mb-2" />
                  <Input placeholder="Número de telefone (ex: 5511999999999)" className="mb-2" />
                  <Button variant="outline" className="w-full">
                    <Send className="h-4 w-4 mr-2" />
                    Conectar WhatsApp
                  </Button>
                </div>
                
                <div className="p-4 bg-muted rounded-lg">
                  <Label className="text-base font-semibold mb-2 block">Email - SMTP</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Configure o servidor SMTP para enviar emails automáticos aos moradores.
                  </p>
                  <Input placeholder="Servidor SMTP (ex: smtp.gmail.com)" className="mb-2" />
                  <Input placeholder="Porta (ex: 587)" className="mb-2" />
                  <Input placeholder="Email" type="email" className="mb-2" />
                  <Input placeholder="Senha" type="password" className="mb-2" />
                  <Button variant="outline" className="w-full">
                    <Send className="h-4 w-4 mr-2" />
                    Configurar Email
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Informações do Sistema</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-muted-foreground mb-1">Versão</p>
                <p className="font-semibold">PortalGuard Pro v1.0</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-muted-foreground mb-1">Armazenamento</p>
                <p className="font-semibold">Lovable Cloud (Supabase)</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-muted-foreground mb-1">Status</p>
                <p className="font-semibold text-success">Operacional</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
