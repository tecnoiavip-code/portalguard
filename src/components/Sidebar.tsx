import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, Users, FileText, Mail, ScrollText, Settings, Smartphone, ClipboardList, MessageSquare, Shield, Bell, MailSearch, Megaphone } from 'lucide-react';

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  isOpen: boolean;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Principal' },
  { id: 'residents', label: 'Moradores', icon: Users, group: 'Cadastros' },
  { id: 'new-registry', label: 'Novo Cadastro', icon: FileText, group: 'Cadastros' },
  { id: 'mail', label: 'Correspondências', icon: Mail, group: 'Cadastros' },
  { id: 'mail-logs', label: 'Log Correspondências', icon: MailSearch, group: 'Cadastros' },
  { id: 'staff-chat', label: 'Chat Moradores', icon: MessageSquare, group: 'Comunicação', badgeKey: 'chat' },
  { id: 'authorizations', label: 'Autorizações', icon: Shield, group: 'Comunicação', badgeKey: 'auth' },
  { id: 'announcements', label: 'Comunicados', icon: Megaphone, group: 'Comunicação' },
  { id: 'reports', label: 'Relatórios', icon: ClipboardList, group: 'Operações' },
  { id: 'devices', label: 'Dispositivos', icon: Smartphone, group: 'Sistema' },
  { id: 'logs', label: 'Logs de Acesso', icon: ScrollText, group: 'Sistema' },
  { id: 'settings', label: 'Configurações', icon: Settings, group: 'Sistema' },
];

const groups = ['Principal', 'Cadastros', 'Comunicação', 'Operações', 'Sistema'];

export const Sidebar = ({ activeSection, onSectionChange, isOpen }: SidebarProps) => {
  const { user } = useAuth();
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;

    const loadBadges = async () => {
      // Unread chat messages from residents
      const { count: chatCount } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('sender_type', 'resident')
        .eq('read', false);

      // Pending authorizations
      const { count: authCount } = await supabase
        .from('visitor_authorizations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Unread staff notifications
      const { count: notifCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);

      setBadges({
        chat: chatCount || 0,
        auth: authCount || 0,
        notif: notifCount || 0,
      });
    };

    loadBadges();

    // Realtime updates
    const channel = supabase
      .channel('staff-badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => loadBadges())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visitor_authorizations' }, () => loadBadges())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => loadBadges())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  return (
    <aside
      className={cn(
        'fixed md:sticky top-[88px] z-20 w-80 h-[calc(100vh-88px)] bg-card shadow-card transition-transform duration-300 flex flex-col',
        'md:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <div className="p-6 space-y-6 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <div key={group}>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
              {group}
            </h3>
            <nav className="space-y-2">
              {navItems
                .filter((item) => item.group === group)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  const badgeCount = item.badgeKey ? badges[item.badgeKey] || 0 : 0;
                  
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSectionChange(item.id)}
                      className={cn(
                        'w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left font-medium transition-all',
                        'hover:translate-x-2',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-elegant translate-x-1'
                          : 'text-foreground hover:bg-muted'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="flex-1">{item.label}</span>
                      {badgeCount > 0 && (
                        <span className={cn(
                          'text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5',
                          isActive ? 'bg-primary-foreground text-primary' : 'bg-destructive text-destructive-foreground'
                        )}>
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
            </nav>
          </div>
        ))}
      </div>
      
      <div className="border-t border-border p-4 space-y-2 bg-muted/30">
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">© 2024 PortalGuard</p>
          <p>Todos os direitos reservados</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <a href="#" className="hover:text-primary transition-colors">Política de Privacidade</a>
            <span>•</span>
            <a href="#" className="hover:text-primary transition-colors">Termos de Uso</a>
          </div>
          <div className="pt-2 space-y-1">
            <p className="font-semibold text-foreground">Suporte:</p>
            <p>tecno.iavip@gmail.com</p>
            <p>(11) 97694-9949</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
