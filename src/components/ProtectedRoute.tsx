import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getUserRole, isStaffRole } from '@/lib/auth-role';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [roleChecked, setRoleChecked] = useState(false);
  const [canAccessStaffArea, setCanAccessStaffArea] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      setRoleChecked(false);
      setCanAccessStaffArea(false);
      navigate('/auth');
      return;
    }

    if (!isLoading && user) {
      let active = true;
      setRoleChecked(false);

      getUserRole(user.id).then((role) => {
        if (!active) return;
        if (role === 'resident') {
          setCanAccessStaffArea(false);
          navigate('/morador');
          setRoleChecked(true);
          return;
        }

        if (isStaffRole(role)) {
          setCanAccessStaffArea(true);
        } else {
          setCanAccessStaffArea(false);
          navigate('/auth');
        }
        setRoleChecked(true);
      });

      return () => { active = false; };
    }
  }, [user, isLoading, navigate]);

  if (isLoading || (!roleChecked && user)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !canAccessStaffArea) {
    return null;
  }

  return <>{children}</>;
};
