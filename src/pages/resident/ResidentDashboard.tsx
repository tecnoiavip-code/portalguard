import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Mail, Users, Shield, MessageSquare, Megaphone, ChevronRight, Package, Clock, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Counts } from './ResidentLayout';

interface ResidentInfo {
  id: string;
  name: string;
  apartment: string;
}

interface PreviewMail {
  id: string;
  sender: string;
  package_type: string | null;
  received_at: string | null;
}

interface PreviewVisitor {
  id: string;
  visitor_name: string;
  entry_time: string | null;
  exit_time: string | null;
}

interface PreviewAuth {
  id: string;
  visitor_name: string;
  status: string | null;
  authorized_date: string;
}

interface PreviewMsg {
  id: string;
  message: string;
  sender_type: string;
  created_at: string;
}

interface PreviewAnnouncement {
  id: string;
  title: string;
  priority: string;
  created_at: string;
}

interface Props {
  onNavigate: (tab: string) => void;
  counts: Counts;
}

const ResidentDashboard = ({ onNavigate, counts }: Props) => {
  const { user } = useAuth();
  const [resident, setResident] = useState<ResidentInfo | null>(null);
  const [previewMails, setPreviewMails] = useState<PreviewMail[]>([]);
  const [previewVisitors, setPreviewVisitors] = useState<PreviewVisitor[]>([]);
  const [previewAuths, setPreviewAuths] = useState<PreviewAuth[]>([]);
  const [previewMsgs, setPreviewMsgs] = useState<PreviewMsg[]>([]);
  const [previewAnnouncements, setPreviewAnnouncements] = useState<PreviewAnnouncement[]>([]);

  useEffect(() => {
    if (!user) return;
    
    const load = async () => {
      const { data: res } = await (supabase
        .from('residents')
        .select('id, name, apartment') as any)
        .eq('auth_user_id', user.id)
        .maybeSingle();
      
      if (!res) return;
      setResident(res);

      const [mailsRes, visitorsRes, authsRes, msgsRes, annsRes] = await Promise.all([
        supabase.from('mails').select('id, sender, package_type, received_at').eq('resident_id', res.id).order('received_at', { ascending: false }).limit(3),
        supabase.from('access_entries').select('id, visitor_name, entry_time, exit_time').eq('apartment', res.apartment).order('entry_time', { ascending: false }).limit(3),
        supabase.from('visitor_authorizations').select('id, visitor_name, status, authorized_date').eq('resident_id', res.id).order('created_at', { ascending: false }).limit(3),
        supabase.from('chat_messages').select('id, message, sender_type, created_at').eq('resident_id', res.id).order('created_at', { ascending: false }).limit(3),
        supabase.from('announcements').select('id, title, priority, created_at').order('created_at', { ascending: false }).limit(3),
      ]);

      setPreviewMails(mailsRes.data || []);
      setPreviewVisitors(visitorsRes.data || []);
      setPreviewAuths((authsRes.data as any) || []);
      setPreviewMsgs((msgsRes.data as any) || []);
      setPreviewAnnouncements((annsRes.data as any) || []);
    };

    load();
  }, [user]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  const statusLabel: Record<string, string> = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Rejeitada', expired: 'Expirada' };

  const sections = [
    {
      id: 'mails',
      title: 'Correspondências',
      icon: Mail,
      iconBg: 'bg-blue-500/10',
      iconColor: 'text-blue-600 dark:text-blue-400',
      borderColor: 'border-blue-500/20',
      badge: counts.mails,
      badgeLabel: 'pendente',
      items: previewMails.map(m => ({
        primary: m.sender,
        secondary: m.package_type || 'Carta',
        time: m.received_at ? format(new Date(m.received_at), "dd/MM HH:mm", { locale: ptBR }) : '',
      })),
    },
    {
      id: 'visitors',
      title: 'Visitas',
      icon: Users,
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      borderColor: 'border-emerald-500/20',
      badge: previewVisitors.filter(v => !v.exit_time).length,
      badgeLabel: 'no local',
      items: previewVisitors.map(v => ({
        primary: v.visitor_name,
        secondary: v.exit_time ? 'Saiu' : 'No local',
        time: v.entry_time ? format(new Date(v.entry_time), "dd/MM HH:mm", { locale: ptBR }) : '',
        active: !v.exit_time,
      })),
    },
    {
      id: 'announcements',
      title: 'Comunicados',
      icon: Megaphone,
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-600 dark:text-amber-400',
      borderColor: 'border-amber-500/20',
      badge: counts.announcements,
      badgeLabel: 'novo',
      items: previewAnnouncements.map(a => ({
        primary: a.title,
        secondary: a.priority === 'urgent' ? '🔴 Urgente' : a.priority === 'important' ? '🟡 Importante' : 'Normal',
        time: format(new Date(a.created_at), "dd/MM HH:mm", { locale: ptBR }),
      })),
    },
    {
      id: 'authorizations',
      title: 'Autorizações',
      icon: Shield,
      iconBg: 'bg-violet-500/10',
      iconColor: 'text-violet-600 dark:text-violet-400',
      borderColor: 'border-violet-500/20',
      badge: 0,
      badgeLabel: '',
      items: previewAuths.map(a => ({
        primary: a.visitor_name,
        secondary: statusLabel[a.status || 'pending'] || a.status,
        time: format(new Date(a.authorized_date), "dd/MM/yyyy", { locale: ptBR }),
      })),
    },
    {
      id: 'chat',
      title: 'Chat com Portaria',
      icon: MessageSquare,
      iconBg: 'bg-rose-500/10',
      iconColor: 'text-rose-600 dark:text-rose-400',
      borderColor: 'border-rose-500/20',
      badge: counts.chat,
      badgeLabel: 'não lida',
      items: previewMsgs.length > 0 ? [{
        primary: previewMsgs[0].sender_type === 'resident' ? 'Você' : 'Portaria',
        secondary: previewMsgs[0].message.length > 60 ? previewMsgs[0].message.substring(0, 60) + '…' : previewMsgs[0].message,
        time: format(new Date(previewMsgs[0].created_at), "HH:mm", { locale: ptBR }),
      }] : [],
    },
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* Welcome */}
      <div className="rounded-2xl bg-primary p-5 text-primary-foreground relative overflow-hidden"
        style={{ boxShadow: 'var(--shadow-elegant)' }}
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-8 translate-x-8" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-6 -translate-x-6" />
        <div className="relative z-10">
          <p className="text-sm opacity-80">{greeting()}</p>
          <h2 className="text-xl font-bold mt-0.5">{resident?.name || 'Morador'}</h2>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded-full backdrop-blur-sm">
              Apto {resident?.apartment}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Access Cards */}
      <div className="space-y-4">
        {sections.map((section) => (
          <div
            key={section.id}
            className={cn(
              "bg-card/80 backdrop-blur-sm border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200",
              "hover:shadow-lg active:scale-[0.98]",
              section.borderColor
            )}
            onClick={() => onNavigate(section.id)}
          >
            {/* Card Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-xl", section.iconBg)}>
                  <section.icon className={cn("h-5 w-5", section.iconColor)} />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm">{section.title}</h3>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {section.badge > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5 rounded-full animate-pulse">
                    {section.badge} {section.badgeLabel}{section.badge > 1 ? 's' : ''}
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
              </div>
            </div>

            {/* Preview Items */}
            <div className="px-4 pb-3">
              {section.items.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">Nenhum registro</p>
              ) : (
                <div className="space-y-1">
                  {section.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-t border-border/30 first:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {'active' in item && (item as any).active && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          )}
                          <span className="text-sm font-medium text-foreground truncate">{item.primary}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{item.secondary}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground/70 shrink-0 ml-2">{item.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResidentDashboard;
