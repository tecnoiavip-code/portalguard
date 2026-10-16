import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { resolvePortalAccess } from '@/lib/portal-access';
import type { PortalAccess } from '@/lib/portal-access-policy';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  portal?: 'staff' | 'resident';
}

export const ProtectedRoute = ({ children, portal = 'staff' }: ProtectedRouteProps) => {
  const { user, isLoading } = useAuth();
  const [checked, setChecked] = useState<{ userId: string; access: PortalAccess } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setChecked(null);
    setError(null);
    if (isLoading || !user) return;
    resolvePortalAccess().then(access => {
      if (active) setChecked({ userId: user.id, access });
    }).catch(() => {
      if (active) setError('Não foi possível validar seu acesso. Contate a administração.');
    });
    return () => { active = false; };
  }, [user?.id, isLoading]);

  if (error && user) {
    return <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
      <p role="alert">{error}</p>
      <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
    </div>;
  }
  if (isLoading || (user && checked?.userId !== user.id)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to={portal === 'resident' ? '/morador/login' : '/auth'} replace />;
  if (!checked || checked.access === 'denied') return <Navigate to="/auth?access=denied" replace />;
  if (checked.access !== portal) return <Navigate to={checked.access === 'resident' ? '/morador' : '/'} replace />;

  return <>{children}</>;
};
