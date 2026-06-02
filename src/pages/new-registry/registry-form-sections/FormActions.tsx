import { LogIn, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface FormActionsProps {
  editingId: string;
  onCancel: () => void;
}

export function FormActions({ editingId, onCancel }: FormActionsProps) {
  return (
    <div className="flex space-x-2">
      <Button type="submit" className="flex-1">
        <LogIn className="h-4 w-4 mr-2" />
        {editingId ? 'Salvar Alterações' : 'Registrar Entrada'}
      </Button>
      <Button type="button" variant="destructive" onClick={onCancel}>
        <X className="h-4 w-4 mr-2" />
        Cancelar
      </Button>
    </div>
  );
}
