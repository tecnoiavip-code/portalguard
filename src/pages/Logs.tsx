import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollText, Search, LogIn, LogOut, Download } from 'lucide-react';
import { AccessEntry } from '@/types';
import { useAccessEntries } from '@/hooks/useAccessEntries';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export const Logs = () => {
  const { entries: allEntries } = useAccessEntries();
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const entries = allEntries.sort(
    (a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
  );

  const filteredEntries = entries.filter(
    (entry) =>
      entry.visitorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.residentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.apartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.visitorDocument.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredEntries.length / itemsPerPage);
  const paginatedEntries = filteredEntries.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const exportLogsToPDF = () => {
    const doc = new jsPDF();
    doc.text('Logs de Acesso', 14, 15);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}`, 14, 22);

    const tableData = filteredEntries.map(entry => [
      entry.visitorName,
      entry.visitorDocument,
      entry.residentName,
      entry.apartment,
      format(new Date(entry.entryTime), 'dd/MM/yyyy HH:mm', { locale: ptBR }),
      entry.exitTime ? format(new Date(entry.exitTime), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : 'Ativo',
    ]);

    autoTable(doc, {
      head: [['Visitante', 'Documento', 'Morador', 'Apt', 'Entrada', 'Saída']],
      body: tableData,
      startY: 28,
    });

    doc.save(`logs-acesso-${format(new Date(), 'dd-MM-yyyy')}.pdf`);
    toast.success('PDF gerado com sucesso');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-2">Logs de Acesso</h2>
        <p className="text-muted-foreground">Histórico completo de entradas e saídas</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ScrollText className="h-5 w-5 text-primary" />
              <span>Histórico de Acessos</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{entries.length} registros</Badge>
              <Button variant="outline" size="sm" onClick={exportLogsToPDF}>
                <Download className="h-4 w-4 mr-2" />
                Exportar PDF
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por visitante, morador, apartamento ou documento..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-3">
            {paginatedEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {searchTerm ? 'Nenhum registro encontrado' : 'Nenhum acesso registrado ainda'}
              </p>
            ) : (
              paginatedEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 bg-card rounded-lg border border-border hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-foreground text-lg">
                        {entry.visitorName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Doc: {entry.visitorDocument}
                      </p>
                    </div>
                    <Badge
                      variant={entry.exitTime ? 'secondary' : 'default'}
                      className={entry.exitTime ? '' : 'bg-success'}
                    >
                      {entry.exitTime ? 'Finalizado' : 'Ativo'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        <span className="font-medium">Visitando:</span> {entry.residentName}
                      </p>
                      <p className="text-muted-foreground">
                        <span className="font-medium">Apartamento:</span> {entry.apartment}
                      </p>
                      {entry.vehiclePlate && (
                        <p className="text-muted-foreground">
                          <span className="font-medium">Veículo:</span> {entry.vehiclePlate}
                        </p>
                      )}
                      {entry.purpose && (
                        <p className="text-muted-foreground">
                          <span className="font-medium">Motivo:</span> {entry.purpose}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center space-x-2 text-success">
                        <LogIn className="h-4 w-4" />
                        <div>
                          <p className="font-medium">Entrada</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(entry.entryTime).toLocaleString('pt-BR')}
                          </p>
                        </div>
                      </div>
                      {entry.exitTime && (
                        <div className="flex items-center space-x-2 text-muted-foreground">
                          <LogOut className="h-4 w-4" />
                          <div>
                            <p className="font-medium">Saída</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(entry.exitTime).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => setCurrentPage(page)}
                        isActive={currentPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
