import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [roleChecked, setRoleChecked] = useState(false);
  const [isResident, setIsResident] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      setRoleChecked(false);
      setIsResident(false);
      navigate('/auth');
      return;
    }

    if (!isLoading && user) {
      let active = true;
      setRoleChecked(false);

      Promise.race([
        supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'resident')
          .maybeSingle(),
        new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), 4000)),
      ]).then(({ data }) => {
        if (!active) return;
        if (data) {
          setIsResident(true);
          navigate('/morador');
        } else {
          setIsResident(false);
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

  if (!user || isResident) {
    return null;
  }

  return <>{children}</>;
};
