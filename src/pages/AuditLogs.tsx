import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { Download, Eye, FileSpreadsheet, History, Search, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { exportToCSV } from '@/lib/export-csv';
import StandardPagination from '@/components/StandardPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type AuditMetadata = Record<string, unknown> | unknown[] | string | number | boolean | null;

type AuditLog = {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: AuditMetadata;
  created_at: string;
};

const ITEMS_PER_PAGE = 10;
const AUDIT_QUERY_LIMIT = 150;

const actionLabels: Record<string, string> = {
  create: 'Criado',
  update: 'Atualizado',
  delete: 'Excluído',
  register_exit: 'Saída registrada',
  review: 'Revisão',
  bulk_review: 'Revisão em lote',
};

const entityLabels: Record<string, string> = {
  residents: 'Morador',
  access_entries: 'Acesso',
  mails: 'Correspondência',
  devices: 'Dispositivo',
  staff_authorizations: 'Autorização',
  resident_authorizations: 'Autorização',
};

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  receptionist: 'Portaria',
  security_guard: 'Segurança',
  resident: 'Morador',
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
};

const actionLabel = (action: string) => actionLabels[action] || action;
const entityLabel = (entity: string) => entityLabels[entity] || entity;
const roleLabel = (role: string | null) => (role ? roleLabels[role] || role : 'Sem papel');

const actionBadge = (action: string) => {
  if (action === 'delete') {
    return <Badge variant="destructive">{actionLabel(action)}</Badge>;
  }

  if (action === 'create') {
    return <Badge className="bg-primary hover:bg-primary/90">{actionLabel(action)}</Badge>;
  }

  if (action === 'register_exit') {
    return <Badge variant="secondary">{actionLabel(action)}</Badge>;
  }

  return <Badge variant="outline">{actionLabel(action)}</Badge>;
};

const stringifyMetadata = (metadata: AuditMetadata) => {
  if (metadata === null || metadata === undefined) return '{}';

  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
};

export const AuditLogs = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  useEffect(() => {
    let active = true;

    const loadAuditLogs = async () => {
      setLoading(true);

      try {
        const { data, error } = await (supabase as any)
          .from('audit_logs')
          .select('id, actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(AUDIT_QUERY_LIMIT);

        if (error) throw error;
        if (active) setLogs((data || []) as AuditLog[]);
      } catch (error) {
        console.error('Error loading audit logs:', error);
        if (active) toast.error('Erro ao carregar auditoria');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAuditLogs();

    return () => {
      active = false;
    };
  }, []);

  const actionOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).sort(),
    [logs],
  );

  const entityOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.entity_type).filter(Boolean))).sort(),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLowerCase();

    return logs.filter((log) => {
      const createdAt = new Date(log.created_at);
      const matchesSearch = !term || [
        actionLabel(log.action),
        entityLabel(log.entity_type),
        log.action,
        log.entity_type,
        log.entity_id,
        log.actor_user_id,
        roleLabel(log.actor_role),
        log.summary,
      ].some((value) => String(value || '').toLowerCase().includes(term));
      const matchesAction = actionFilter === 'all' || log.action === actionFilter;
      const matchesEntity = entityFilter === 'all' || log.entity_type === entityFilter;
      const matchesFrom = !dateFrom || createdAt >= new Date(`${dateFrom}T00:00:00`);
      const matchesTo = !dateTo || createdAt <= new Date(`${dateTo}T23:59:59`);

      return matchesSearch && matchesAction && matchesEntity && matchesFrom && matchesTo;
    });
  }, [actionFilter, dateFrom, dateTo, entityFilter, logs, search]);

  const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE);
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const clearFilters = () => {
    setSearch('');
    setActionFilter('all');
    setEntityFilter('all');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  const exportAuditLogsToCSV = () => {
    const headers = ['Data', 'Ação', 'Entidade', 'Resumo', 'Papel', 'Usuário', 'ID do registro'];
    const rows = filteredLogs.map((log) => [
      formatDateTime(log.created_at),
      actionLabel(log.action),
      entityLabel(log.entity_type),
      log.summary,
      roleLabel(log.actor_role),
      log.actor_user_id || '-',
      log.entity_id || '-',
    ]);

    exportToCSV(`auditoria-operacional-${format(new Date(), 'dd-MM-yyyy')}`, headers, rows);
    toast.success('CSV gerado com sucesso');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-2">Auditoria Operacional</h2>
        <p className="text-muted-foreground">Acompanhamento das ações críticas da equipe e dos moradores</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>Filtros</span>
              <Badge variant="secondary">{logs.length} últimos registros</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Limpar Filtros
              </Button>
              <Button variant="outline" size="sm" onClick={exportAuditLogsToCSV} disabled={filteredLogs.length === 0}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                CSV
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar ação, entidade, resumo, usuário..."
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-10"
                />
              </div>
              <Select value={actionFilter} onValueChange={(value) => { setActionFilter(value); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Ação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {actionOptions.map((action) => (
                    <SelectItem key={action} value={action}>{actionLabel(action)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={(value) => { setEntityFilter(value); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Entidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as entidades</SelectItem>
                  {entityOptions.map((entity) => (
                    <SelectItem key={entity} value={entity}>{entityLabel(entity)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:max-w-md">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">De</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setCurrentPage(1);
                  }}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Até</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setCurrentPage(1);
                  }}
                  className="text-sm"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
            <span>{filteredLogs.length} registro{filteredLogs.length !== 1 ? 's' : ''} encontrado{filteredLogs.length !== 1 ? 's' : ''}</span>
            <span className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Limite de leitura: {AUDIT_QUERY_LIMIT}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Resumo</TableHead>
                  <TableHead>Usuário/Papel</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead className="text-right w-[80px]">Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      Carregando auditoria...
                    </TableCell>
                  </TableRow>
                ) : paginatedLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      Nenhum registro encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedLogs.map((log) => (
                    <TableRow key={log.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedLog(log)}>
                      <TableCell className="whitespace-nowrap text-sm">{formatDateTime(log.created_at)}</TableCell>
                      <TableCell>{actionBadge(log.action)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{entityLabel(log.entity_type)}</div>
                        <div className="text-xs text-muted-foreground">{log.entity_type}</div>
                      </TableCell>
                      <TableCell className="max-w-[360px]">
                        <p className="line-clamp-2 text-sm">{log.summary}</p>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{roleLabel(log.actor_role)}</div>
                        <div className="text-xs text-muted-foreground font-mono">{log.actor_user_id || '-'}</div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{log.entity_id || '-'}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="Ver detalhes"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedLog(log);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <StandardPagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} className="mt-4" />
        </CardContent>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={(open) => { if (!open) setSelectedLog(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Detalhes da Auditoria
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Data</p>
                  <p className="font-medium">{formatDateTime(selectedLog.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Ação</p>
                  <div className="mt-1">{actionBadge(selectedLog.action)}</div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Entidade</p>
                  <p className="font-medium">{entityLabel(selectedLog.entity_type)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Papel</p>
                  <p className="font-medium">{roleLabel(selectedLog.actor_role)}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Resumo</p>
                <p className="font-medium">{selectedLog.summary}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Usuário</p>
                  <p className="font-mono text-xs break-all">{selectedLog.actor_user_id || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ID do registro</p>
                  <p className="font-mono text-xs break-all">{selectedLog.entity_id || '-'}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">Metadados</p>
                <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                  {stringifyMetadata(selectedLog.metadata)}
                </pre>
              </div>

              <Button variant="outline" size="sm" onClick={exportAuditLogsToCSV}>
                <Download className="h-4 w-4 mr-2" />
                Exportar lista atual
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
