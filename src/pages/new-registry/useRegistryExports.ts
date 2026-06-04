import { useCallback } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';

import { exportToCSV } from '@/lib/export-csv';
import { AccessEntry, Resident } from '@/types';

interface UseRegistryExportsParams {
  filteredActiveEntries: AccessEntry[];
  filteredAllEntries: AccessEntry[];
  residents: Resident[];
}

const formatDateTime = (date: string) =>
  format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: ptBR });

const formatFileDate = () => format(new Date(), 'dd-MM-yyyy');

const getResident = (residents: Resident[], entry: AccessEntry) =>
  residents.find(resident => resident.id === entry.residentId);

export const useRegistryExports = ({
  filteredActiveEntries,
  filteredAllEntries,
  residents,
}: UseRegistryExportsParams) => {
  const exportActiveEntriesToPDF = useCallback(() => {
    const doc = new jsPDF();
    doc.text('Cadastros Ativos', 14, 15);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}`, 14, 22);

    const tableData = filteredActiveEntries.map(entry => {
      const resident = getResident(residents, entry);
      return [
        entry.visitorName,
        entry.visitorDocument,
        resident?.name || '-',
        resident?.apartment || '-',
        entry.visitorType === 'visitor' ? 'Visitante' : 'Prestador',
        entry.badgeNumber || '-',
        formatDateTime(entry.entryTime),
      ];
    });

    autoTable(doc, {
      head: [['Nome', 'Documento', 'Morador', 'Apt', 'Tipo', 'Crachá', 'Entrada']],
      body: tableData,
      startY: 28,
    });
    doc.save(`cadastros-ativos-${formatFileDate()}.pdf`);
    toast.success('PDF gerado com sucesso');
  }, [filteredActiveEntries, residents]);

  const exportActiveEntriesToCSV = useCallback(() => {
    const headers = ['Nome', 'Documento', 'Morador', 'Apt', 'Tipo', 'Crachá', 'Entrada'];
    const rows = filteredActiveEntries.map(entry => {
      const resident = getResident(residents, entry);
      return [
        entry.visitorName,
        entry.visitorDocument,
        resident?.name || '-',
        resident?.apartment || '-',
        entry.visitorType === 'visitor' ? 'Visitante' : 'Prestador',
        entry.badgeNumber || '-',
        formatDateTime(entry.entryTime),
      ];
    });

    exportToCSV(`cadastros-ativos-${formatFileDate()}`, headers, rows);
    toast.success('CSV gerado com sucesso');
  }, [filteredActiveEntries, residents]);

  const exportAllEntriesToPDF = useCallback(() => {
    const doc = new jsPDF();
    doc.text('Todos os Cadastros', 14, 15);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}`, 14, 22);

    const tableData = filteredAllEntries.map(entry => {
      const resident = getResident(residents, entry);
      return [
        entry.visitorName,
        entry.visitorDocument,
        resident?.name || '-',
        resident?.apartment || '-',
        entry.badgeNumber || '-',
        formatDateTime(entry.entryTime),
        entry.exitTime ? formatDateTime(entry.exitTime) : 'Ativo',
      ];
    });

    autoTable(doc, {
      head: [['Nome', 'Documento', 'Morador', 'Apt', 'Crachá', 'Entrada', 'Saída']],
      body: tableData,
      startY: 28,
    });
    doc.save(`todos-cadastros-${formatFileDate()}.pdf`);
    toast.success('PDF gerado com sucesso');
  }, [filteredAllEntries, residents]);

  const exportAllEntriesToCSV = useCallback(() => {
    const headers = ['Nome', 'Documento', 'Morador', 'Apt', 'Crachá', 'Entrada', 'Saída'];
    const rows = filteredAllEntries.map(entry => {
      const resident = getResident(residents, entry);
      return [
        entry.visitorName,
        entry.visitorDocument,
        resident?.name || '-',
        resident?.apartment || '-',
        entry.badgeNumber || '-',
        formatDateTime(entry.entryTime),
        entry.exitTime ? formatDateTime(entry.exitTime) : 'Ativo',
      ];
    });

    exportToCSV(`todos-cadastros-${formatFileDate()}`, headers, rows);
    toast.success('CSV gerado com sucesso');
  }, [filteredAllEntries, residents]);

  return {
    exportActiveEntriesToPDF,
    exportActiveEntriesToCSV,
    exportAllEntriesToPDF,
    exportAllEntriesToCSV,
  };
};
