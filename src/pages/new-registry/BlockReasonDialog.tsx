import { Dispatch, SetStateAction } from 'react';
import { Ban } from 'lucide-react';
import { AccessEntry } from '@/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface BlockReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: AccessEntry | null;
  reason: string;
  setReason: Dispatch<SetStateAction<string>>;
  onConfirm: () => void;
}

export function BlockReasonDialog({
  open,
  onOpenChange,
  entry,
  reason,
  setReason,
  onConfirm,
}: BlockReasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Bloquear {entry?.visitorName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Motivo do bloqueio (opcional)</Label>
            <Textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Informe o motivo do bloqueio..."
              rows={3}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={onConfirm}>
              <Ban className="h-4 w-4 mr-2" />
              Confirmar Bloqueio
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
