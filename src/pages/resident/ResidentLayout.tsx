import { useState, useEffect, useRef, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Home, Mail, Users, Shield, MessageSquare, LogOut, Bell, Megaphone } from 'lucide-react';
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
}

interface Counts {
  chat: number;
  notif: number;
  mails: number;
  announcements: number;
}

const ResidentLayout = ({ children, activeTab, onTabChange }: ResidentLayoutProps) => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Counts>({ chat: 0, notif: 0, mails: 0, announcements: 0 });
  const prevCountsRef = useRef<Counts>({ chat: 0, notif: 0, mails: 0, announcements: 0 });
  const residentIdRef = useRef<string | null>(null);
  const isFirstLoad = useRef(true);

  const totalBadge = counts.chat + counts.notif + counts.mails + counts.announcements;

  // Request notification permission and subscribe to push on first interaction
  useEffect(() => {
    const handler = () => {
      requestNotificationPermission().then(() => {
        if (user) subscribeToPush(user.id);
      });
      window.removeEventListener('click', handler);
    };
    window.addEventListener('click', handler, { once: true });
    // Also try immediately
    requestNotificationPermission().then(() => {
      if (user) subscribeToPush(user.id);
    });
    return () => window.removeEventListener('click', handler);
  }, [user]);

  // Update title and PWA badge
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
      // Get resident ID
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

      // Only notify on increases (not on first load to avoid spam)
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

    // Realtime: immediate refresh + dedicated notifications
    const channel = supabase
      .channel('resident-notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        const notif = payload.new as any;
        // Immediate UI update
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

    // Polling fallback every 8s
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
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
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

  const markChatRead = async () => {
    if (!user || !residentIdRef.current) return;
    setCounts(prev => ({ ...prev, chat: 0 }));
    await supabase
      .from('chat_messages')
      .update({ read: true })
      .eq('resident_id', residentIdRef.current!)
      .eq('sender_type', 'staff')
      .eq('read', false);
  };

  const handleSignOut = async () => {
    document.title = 'Portal do Morador';
    setAppBadge(0);
    await supabase.auth.signOut();
    navigate('/morador/login');
  };

  const tabs = [
    { id: 'home', label: 'Início', icon: Home },
    { id: 'mails', label: 'Correio', icon: Mail },
    { id: 'announcements', label: 'Avisos', icon: Megaphone },
    { id: 'visitors', label: 'Visitas', icon: Users },
    { id: 'authorizations', label: 'Autorizar', icon: Shield },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-primary text-primary-foreground sticky top-0 z-30 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 relative">
            <Home className="h-5 w-5" />
            <span className="font-bold">Portal do Morador</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="relative cursor-pointer" onClick={() => { markNotifsRead(); onTabChange('home'); }}>
              <Bell className="h-5 w-5" />
              {totalBadge > 0 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold animate-pulse">
                  {totalBadge > 99 ? '99+' : totalBadge}
                </span>
              )}
            </div>
            <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary-foreground/10" onClick={handleSignOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-4 pb-20 overflow-y-auto">
        {children}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-30">
        <div className="flex justify-around">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'chat') markChatRead();
                onTabChange(tab.id);
              }}
              className={cn(
                'flex flex-col items-center py-2 px-3 text-xs transition-colors relative',
                activeTab === tab.id ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <div className="relative">
                <tab.icon className="h-5 w-5" />
              </div>
              <span className="mt-1">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <PWAInstallPrompt />
    </div>
  );
};

export default ResidentLayout;
