import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ShieldBan, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BlockedVisitor } from './registry-form';

interface BlockedVisitorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockedVisitors: BlockedVisitor[];
  onUnblockVisitor: (id: string) => void;
}

export function BlockedVisitorsDialog({
  open,
  onOpenChange,
  blockedVisitors,
  onUnblockVisitor,
}: BlockedVisitorsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldBan className="h-5 w-5 text-destructive" />
            Visitantes/Prestadores Bloqueados
          </DialogTitle>
        </DialogHeader>
        {blockedVisitors.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhum visitante bloqueado</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blockedVisitors.map(blockedVisitor => (
                <TableRow key={blockedVisitor.id}>
                  <TableCell className="font-medium">{blockedVisitor.visitor_name}</TableCell>
                  <TableCell>{blockedVisitor.visitor_document}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{blockedVisitor.reason || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(blockedVisitor.blocked_at), 'dd/MM/yyyy', { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => onUnblockVisitor(blockedVisitor.id)} className="gap-1">
                      <ShieldCheck className="h-4 w-4" />
                      Desbloquear
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
