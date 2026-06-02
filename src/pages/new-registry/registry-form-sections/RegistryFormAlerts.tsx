import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface RegistryFormAlertsProps {
  visitorDocument: string;
  isVisitorBlocked: (document: string) => boolean;
  blockedReason: string | null;
  badgeError: string | null;
  onClearBadgeError: () => void;
}

export function RegistryFormAlerts({
  visitorDocument,
  isVisitorBlocked,
  blockedReason,
  badgeError,
  onClearBadgeError,
}: RegistryFormAlertsProps) {
  return (
    <>
      {visitorDocument && isVisitorBlocked(visitorDocument) && (
        <div className="rounded-lg border-2 border-destructive bg-destructive/10 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="rounded-full bg-destructive p-2 shrink-0">
            <AlertTriangle className="h-5 w-5 text-destructive-foreground" />
          </div>
          <div>
            <h4 className="font-bold text-destructive text-base">VISITANTE BLOQUEADO</h4>
            <p className="text-sm text-destructive/90 mt-1">
              Este documento consta na lista de bloqueio. A entrada <strong>não será permitida</strong>.
            </p>
            {blockedReason && (
              <p className="text-xs text-muted-foreground mt-1">
                Motivo: {blockedReason}
              </p>
            )}
          </div>
        </div>
      )}

      {badgeError && (
        <div className="rounded-lg border-2 border-warning bg-warning/10 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="rounded-full bg-warning p-2 shrink-0">
            <AlertTriangle className="h-5 w-5 text-warning-foreground" />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-foreground text-base">Crachá em uso</h4>
            <p className="text-sm text-muted-foreground mt-1">{badgeError}</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClearBadgeError}>
            OK
          </Button>
        </div>
      )}
    </>
  );
}
