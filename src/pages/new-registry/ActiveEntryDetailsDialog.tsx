import { AccessEntry } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LogIn, LogOut, Pencil } from 'lucide-react';

interface ActiveEntryDetailsDialogProps {
  entry: AccessEntry | null;
  onClose: () => void;
  onEditEntry: (entry: AccessEntry) => void;
  onExitEntry: (id: string) => void;
}

export function ActiveEntryDetailsDialog({
  entry,
  onClose,
  onEditEntry,
  onExitEntry,
}: ActiveEntryDetailsDialogProps) {
  return (
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-primary" />
            Detalhes do Cadastro Ativo
          </DialogTitle>
        </DialogHeader>
        {entry && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {entry.photo ? (
                <img src={entry.photo} alt={entry.visitorName} className="w-24 h-24 rounded-full object-cover border-2 border-primary/20" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center text-4xl">
                  {entry.visitorType === 'service_provider' ? '🔧' : '👤'}
                </div>
              )}
              <div>
                <h3 className="text-xl font-semibold">{entry.visitorName}</h3>
                <Badge variant={entry.visitorType === 'service_provider' ? 'outline' : 'secondary'}>
                  {entry.visitorType === 'service_provider' ? 'Prestador de Serviço' : 'Visitante'}
                </Badge>
                <Badge variant="default" className="ml-2 bg-success">Ativo</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground block">Documento</span>
                <span className="font-medium">{entry.visitorDocument}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Crachá</span>
                <span className="font-medium font-mono">{entry.badgeNumber || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Visitando</span>
                <span className="font-medium">{entry.residentName}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Apartamento</span>
                <span className="font-medium">{entry.apartment}</span>
              </div>
              {entry.purpose && (
                <div className="col-span-2">
                  <span className="text-muted-foreground block">Motivo</span>
                  <span className="font-medium">{entry.purpose}</span>
                </div>
              )}
              {entry.company && (
                <div className="col-span-2">
                  <span className="text-muted-foreground block">Empresa</span>
                  <span className="font-medium">{entry.company}</span>
                </div>
              )}
            </div>

            {(entry.vehiclePlate || entry.vehicleModel || entry.vehicleColor) && (
              <div className="border-t pt-3">
                <h4 className="font-semibold mb-2">Veículo</h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground block">Placa</span>
                    <span className="font-medium">{entry.vehiclePlate || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Modelo</span>
                    <span className="font-medium">{entry.vehicleModel || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Cor</span>
                    <span className="font-medium">{entry.vehicleColor || '-'}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t pt-3">
              <div className="flex items-center gap-2 text-success">
                <LogIn className="h-4 w-4" />
                <span className="text-sm font-medium">Entrada: {new Date(entry.entryTime).toLocaleString('pt-BR')}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => { onClose(); onEditEntry(entry); }}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </Button>
              <Button size="sm" onClick={() => { onClose(); onExitEntry(entry.id); }}>
                <LogOut className="h-4 w-4 mr-2" />
                Registrar Saída
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
