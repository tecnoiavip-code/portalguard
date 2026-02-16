import { useState, useEffect, useCallback, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { playNotificationSound } from '@/lib/notification-sound';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Home, Mail, Users, Shield, MessageSquare, LogOut, Bell, Megaphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { setAppBadge } from '@/lib/pwa-badge';

interface ResidentLayoutProps {
  children: ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const ResidentLayout = ({ children, activeTab, onTabChange }: ResidentLayoutProps) => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifCount, setNotifCount] = useState(0);
  const [totalBadge, setTotalBadge] = useState(0);

  // Request browser notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const vibrate = useCallback(() => {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch { /* silent */ }
  }, []);

  const showBrowserNotification = useCallback((title: string, body: string) => {
    vibrate();
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'portalguard-chat',
        });
      } catch {
        // Silent fail on unsupported environments
      }
    }
  }, [vibrate]);

  useEffect(() => {
    const total = unreadCount + notifCount;
    setTotalBadge(total);
    // Update page title with badge
    if (total > 0) {
      document.title = `(${total}) Portal do Morador`;
    } else {
      document.title = 'Portal do Morador';
    }
    // Update PWA app icon badge
    setAppBadge(total);
  }, [unreadCount, notifCount]);

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
      if (!role) {
        navigate('/morador/login');
      }
    };
    checkRole();

    let currentResidentId: string | null = null;

    let isActive = true;
    let pollTimeout: ReturnType<typeof setTimeout>;

    const loadCounts = async () => {
      const { data: res } = await (supabase
        .from('residents')
        .select('id') as any)
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (!res) return;
      currentResidentId = res.id;

      const { count: chatCount } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('resident_id', res.id)
        .eq('sender_type', 'staff')
        .eq('read', false);
      setUnreadCount(chatCount || 0);

      const { count: nCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);
      setNotifCount(nCount || 0);
    };
    loadCounts();

    const channel = supabase
      .channel('resident-notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        playNotificationSound();
        loadCounts();
        const notif = payload.new as any;
        showBrowserNotification(notif.title || 'Nova notificação', notif.body || '');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
        loadCounts();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const msg = payload.new as any;
        if (msg.sender_type === 'staff') {
          playNotificationSound();
          loadCounts();
          showBrowserNotification('Nova mensagem da portaria', msg.message?.substring(0, 100) || '');
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, () => {
        loadCounts();
      })
      .subscribe();

    // Polling fallback every 10s
    const poll = () => {
      if (!isActive) return;
      loadCounts();
      pollTimeout = setTimeout(poll, 10000);
    };
    pollTimeout = setTimeout(poll, 10000);

    return () => {
      isActive = false;
      clearTimeout(pollTimeout);
      supabase.removeChannel(channel);
    };
  }, [user, isLoading, navigate, showBrowserNotification]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const markNotifsRead = async () => {
    if (!user) return;
    setNotifCount(0);
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
  };

  const markChatRead = async () => {
    if (!user) return;
    setUnreadCount(0);
    const { data: res } = await supabase
      .from('residents')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!res) return;
    await supabase
      .from('chat_messages')
      .update({ read: true })
      .eq('resident_id', res.id)
      .eq('sender_type', 'staff')
      .eq('read', false);
  };

  const handleSignOut = async () => {
    document.title = 'Portal do Morador';
    await supabase.auth.signOut();
    navigate('/morador/login');
  };

  const tabs = [
    { id: 'home', label: 'Início', icon: Home },
    { id: 'mails', label: 'Correio', icon: Mail },
    { id: 'announcements', label: 'Avisos', icon: Megaphone },
    { id: 'visitors', label: 'Visitas', icon: Users },
    { id: 'authorizations', label: 'Autorizar', icon: Shield },
    { id: 'chat', label: 'Chat', icon: MessageSquare, badge: unreadCount },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-primary text-primary-foreground sticky top-0 z-30 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 relative">
            <Home className="h-5 w-5" />
            <span className="font-bold">Portal do Morador</span>
            {totalBadge > 0 && (
              <span className="absolute -top-2 -left-1 bg-destructive text-destructive-foreground text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold animate-pulse">
                {totalBadge > 99 ? '99+' : totalBadge}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="relative cursor-pointer" onClick={() => { markNotifsRead(); onTabChange('home'); }}>
              <Bell className="h-5 w-5" />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {notifCount > 9 ? '9+' : notifCount}
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
                {tab.badge && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2 bg-destructive text-destructive-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                )}
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
