import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { clearRoleCache } from '@/lib/auth-role';

type AuthUser = any;
type AuthSession = any;

interface AuthContextType {
  user: AuthUser | null;
  session: AuthSession | null;
  isLoading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const auth = supabase.auth as any;

  useEffect(() => {
    let isMounted = true;
    let refreshFailures = 0;

    const clearCorruptedSession = async () => {
      try {
        // Limpa tokens locais do Supabase para sair do loop de refresh inválido
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith('sb-') && key.includes('-auth-token')) {
            localStorage.removeItem(key);
          }
        });
      } catch {}
      if (!isMounted) return;
      setSession(null);
      setUser(null);
    };

    const { data: { subscription } } = auth.onAuthStateChange(
      (event: any, nextSession: any) => {
        if (!isMounted) return;
        if (event === 'TOKEN_REFRESHED') refreshFailures = 0;
        if (event === 'SIGNED_OUT') refreshFailures = 0;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
      }
    );

    // Detecta falhas repetidas no refresh do token (sessão corrompida ou offline persistente)
    const handleUnhandledRejection = (e: PromiseRejectionEvent) => {
      const msg = String(e?.reason?.message || e?.reason || '');
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        refreshFailures += 1;
        if (refreshFailures >= 5 && navigator.onLine) {
          refreshFailures = 0;
          console.warn('[Auth] Sessão corrompida detectada, limpando tokens locais');
          clearCorruptedSession();
        }
      }
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    const initializeAuth = async () => {
      try {
        const { data: { session: nextSession } } = await auth.getSession();
        if (!isMounted) return;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [auth]);

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;

    const { error } = await auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        }
      }
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await auth.signInWithPassword({
      email,
      password,
    });
    if (data?.user?.id) clearRoleCache(data.user.id);
    return { error };
  };

  const signOut = async () => {
    if (user?.id) clearRoleCache(user.id);
    await auth.signOut();
    navigate('/auth');
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
