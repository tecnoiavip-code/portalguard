import { useState, useEffect, useRef, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Home, LogOut, Bell, ArrowLeft } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { setAppBadge } from '@/lib/pwa-badge';
import { notifyResident, requestNotificationPermission } from '@/lib/pwa-notify';
import { subscribeToPush, sendPushToUser } from '@/lib/push-subscription';

interface ResidentLayoutProps {
  children: ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  counts: Counts;
  setCounts: React.Dispatch<React.SetStateAction<Counts>>;
}

export interface Counts {
  chat: number;
  notif: number;
  mails: number;
  announcements: number;
}

const tabTitles: Record<string, string> = {
  home: 'Portal do Morador',
  mails: 'Correspondências',
  announcements: 'Comunicados',
  visitors: 'Visitas',
  authorizations: 'Autorizações',
  chat: 'Chat com Portaria',
};

const ResidentLayout = ({ children, activeTab, onTabChange, counts, setCounts }: ResidentLayoutProps) => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const prevCountsRef = useRef<Counts>({ chat: 0, notif: 0, mails: 0, announcements: 0 });
  const residentIdRef = useRef<string | null>(null);
  const isFirstLoad = useRef(true);

  const totalBadge = counts.chat + counts.notif + counts.mails + counts.announcements;

  useEffect(() => {
    const handler = () => {
      requestNotificationPermission().then(() => {
        if (user) subscribeToPush(user.id);
      });
      window.removeEventListener('click', handler);
    };
    window.addEventListener('click', handler, { once: true });
    requestNotificationPermission().then(() => {
      if (user) subscribeToPush(user.id);
    });
    return () => window.removeEventListener('click', handler);
  }, [user]);

  useEffect(() => {
    document.title = totalBadge > 0 ? `(${totalBadge}) Portal do Morador` : 'Portal do Morador';
    setAppBadge(totalBadge);
  }, [totalBadge]);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/morador/login');
      return;
    }
    if (!user) return;

    const checkRole = async () => {
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'resident')
        .maybeSingle();
      if (!role) navigate('/morador/login');
    };
    checkRole();

    let isActive = true;
    let pollTimeout: ReturnType<typeof setTimeout>;

    const loadCounts = async () => {
      if (!residentIdRef.current) {
        const { data: res } = await (supabase
          .from('residents')
          .select('id') as any)
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (!res) return;
        residentIdRef.current = res.id;
      }
      const rid = residentIdRef.current!;

      const [chatRes, notifRes, mailsRes, announcementsRes, readsRes] = await Promise.all([
        supabase
          .from('chat_messages')
          .select('*', { count: 'exact', head: true })
          .eq('resident_id', rid)
          .eq('sender_type', 'staff')
          .eq('read', false),
        supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('read', false),
        supabase
          .from('mails')
          .select('*', { count: 'exact', head: true })
          .eq('resident_id', rid)
          .eq('status', 'pending'),
        supabase
          .from('announcements')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('announcement_reads')
          .select('announcement_id', { count: 'exact', head: true })
          .eq('user_id', user.id),
      ]);

      const newCounts: Counts = {
        chat: chatRes.count || 0,
        notif: notifRes.count || 0,
        mails: mailsRes.count || 0,
        announcements: Math.max(0, (announcementsRes.count || 0) - (readsRes.count || 0)),
      };

      const prev = prevCountsRef.current;

      if (!isFirstLoad.current) {
        const total = newCounts.chat + newCounts.notif + newCounts.mails + newCounts.announcements;

        if (newCounts.chat > prev.chat) {
          notifyResident('Nova mensagem da portaria', 'Você recebeu uma nova mensagem no chat.', {
            tag: 'chat-' + Date.now(),
            totalBadge: total,
          });
        }
        if (newCounts.notif > prev.notif) {
          notifyResident('Nova notificação', 'Você tem uma nova notificação.', {
            tag: 'notif-' + Date.now(),
            totalBadge: total,
          });
        }
        if (newCounts.mails > prev.mails) {
          notifyResident('Nova correspondência', 'Você tem uma nova encomenda ou carta na portaria.', {
            tag: 'mail-' + Date.now(),
            totalBadge: total,
          });
        }
        if (newCounts.announcements > prev.announcements) {
          notifyResident('Novo comunicado', 'A administração publicou um novo comunicado.', {
            tag: 'announcement-' + Date.now(),
            totalBadge: total,
          });
        }
      }

      isFirstLoad.current = false;
      prevCountsRef.current = newCounts;
      setCounts(newCounts);
    };

    loadCounts();

    const channel = supabase
      .channel('resident-notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        const notif = payload.new as any;
        setCounts(prev => {
          const next = { ...prev, notif: prev.notif + 1 };
          const total = next.chat + next.notif + next.mails + next.announcements;
          notifyResident(notif.title || 'Nova notificação', notif.body || '', {
            tag: `notif-${notif.id}`,
            totalBadge: total,
          });
          prevCountsRef.current = next;
          return next;
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
        loadCounts();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const msg = payload.new as any;
        if (msg.sender_type === 'staff') {
          setCounts(prev => {
            const next = { ...prev, chat: prev.chat + 1 };
            const total = next.chat + next.notif + next.mails + next.announcements;
            notifyResident('Nova mensagem da portaria', msg.message?.substring(0, 100) || '', {
              tag: `chat-${msg.id}`,
              totalBadge: total,
            });
            prevCountsRef.current = next;
            return next;
          });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, () => {
        loadCounts();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mails' }, () => {
        loadCounts();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mails' }, () => {
        loadCounts();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, () => {
        loadCounts();
      })
      .subscribe();

    const poll = () => {
      if (!isActive) return;
      loadCounts();
      pollTimeout = setTimeout(poll, 8000);
    };
    pollTimeout = setTimeout(poll, 8000);

    return () => {
      isActive = false;
      clearTimeout(pollTimeout);
      supabase.removeChannel(channel);
    };
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Carregando...</span>
        </div>
      </div>
    );
  }

  const markNotifsRead = async () => {
    if (!user) return;
    setCounts(prev => ({ ...prev, notif: 0 }));
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
  };

  const handleSignOut = async () => {
    document.title = 'Portal do Morador';
    setAppBadge(0);
    await supabase.auth.signOut();
    navigate('/morador/login');
  };

  const isHome = activeTab === 'home';

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/50">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!isHome ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl"
                onClick={() => onTabChange('home')}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            ) : (
              <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shadow-lg" style={{ boxShadow: 'var(--shadow-elegant)' }}>
                <Home className="h-5 w-5 text-primary-foreground" />
              </div>
            )}
            <div>
              <h1 className="text-base font-bold tracking-tight text-foreground leading-tight">
                {tabTitles[activeTab] || 'Portal do Morador'}
              </h1>
              {isHome && <p className="text-[11px] text-muted-foreground leading-tight">PortalGuard Pro</p>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 rounded-xl"
              onClick={() => { markNotifsRead(); }}
            >
              <Bell className="h-5 w-5" />
              {totalBadge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold shadow-lg animate-pulse">
                  {totalBadge > 99 ? '99+' : totalBadge}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-xl text-muted-foreground hover:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-5 overflow-y-auto">
        {children}
      </main>

      <PWAInstallPrompt />
    </div>
  );
};

export default ResidentLayout;
