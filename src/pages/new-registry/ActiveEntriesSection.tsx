import { AccessEntry } from '@/types';
import StandardPagination from '@/components/StandardPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Ban, Download, FileSpreadsheet, LogOut, Pencil, Search, Trash2 } from 'lucide-react';

interface ActiveEntriesSectionProps {
  activeEntries: AccessEntry[];
  paginatedEntries: AccessEntry[];
  searchTerm: string;
  currentPage: number;
  totalPages: number;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onExportPDF: () => void;
  onExportCSV: () => void;
  onSelectEntry: (entry: AccessEntry) => void;
  onEditEntry: (entry: AccessEntry) => void;
  onBlockEntry: (entry: AccessEntry) => void;
  onDeleteEntry: (id: string) => void;
  onExitEntry: (id: string) => void;
}

export function ActiveEntriesSection({
  activeEntries,
  paginatedEntries,
  searchTerm,
  currentPage,
  totalPages,
  onSearchChange,
  onPageChange,
  onExportPDF,
  onExportCSV,
  onSelectEntry,
  onEditEntry,
  onBlockEntry,
  onDeleteEntry,
  onExitEntry,
}: ActiveEntriesSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <LogOut className="h-5 w-5 text-warning" />
            <span>Ativos no Condomínio</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-normal text-muted-foreground">
              {activeEntries.length} {activeEntries.length === 1 ? 'pessoa' : 'pessoas'}
            </span>
            <Button variant="outline" size="sm" onClick={onExportPDF}>
              <Download className="h-4 w-4 mr-2" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={onExportCSV}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              CSV
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, documento ou apartamento..."
              value={searchTerm}
              onChange={event => onSearchChange(event.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Foto</TableHead>
                <TableHead>Visitante</TableHead>
                <TableHead>Apartamento</TableHead>
                <TableHead>Crachá</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead className="text-right w-[180px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {searchTerm ? 'Nenhum registro encontrado' : 'Nenhuma pessoa no momento'}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedEntries.map(entry => (
                  <TableRow
                    key={entry.id}
                    className={`cursor-pointer ${entry.visitorType === 'service_provider' ? 'bg-warning/5 hover:bg-warning/10' : 'bg-success/5 hover:bg-success/10'}`}
                    onClick={() => onSelectEntry(entry)}
                  >
                    <TableCell>
                      {entry.photo ? (
                        <img src={entry.photo} alt={entry.visitorName} className="w-20 h-20 rounded-full object-cover border-2 border-primary/20" />
                      ) : (
                        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center text-3xl">
                          {entry.visitorType === 'service_provider' ? '🔧' : '👤'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-semibold">{entry.visitorName}</p>
                        <p className="text-xs text-muted-foreground">{entry.visitorDocument}</p>
                        {entry.company && <p className="text-xs text-muted-foreground">🏢 {entry.company}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{entry.apartment}</p>
                        <p className="text-xs text-muted-foreground">{entry.residentName}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {entry.badgeNumber || '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(entry.entryTime).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.vehiclePlate ? (
                        <div>
                          <p>🚗 {entry.vehiclePlate}</p>
                          {entry.vehicleModel && <p className="text-xs">{entry.vehicleModel}</p>}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={(event) => { event.stopPropagation(); onEditEntry(entry); }} className="h-8 w-8" title="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={(event) => { event.stopPropagation(); onBlockEntry(entry); }} className="h-8 w-8 text-destructive hover:text-destructive" title="Bloquear">
                          <Ban className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={(event) => { event.stopPropagation(); onDeleteEntry(entry.id); }} className="h-8 w-8 text-destructive hover:text-destructive" title="Excluir">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" onClick={(event) => { event.stopPropagation(); onExitEntry(entry.id); }} className="h-8">
                          <LogOut className="h-4 w-4 mr-1" />
                          Saída
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <StandardPagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} className="mt-4" />
      </CardContent>
    </Card>
  );
}
