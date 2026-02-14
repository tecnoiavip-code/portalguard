import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Megaphone, CheckCircle, FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: string;
  created_at: string;
}

interface Attachment {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
}

const ResidentAnnouncements = () => {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [detailDialog, setDetailDialog] = useState<{ open: boolean; announcement: Announcement | null }>({ open: false, announcement: null });
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const loadData = async () => {
    if (!user) return;

    const [{ data: anns }, { data: rds }] = await Promise.all([
      supabase.from('announcements').select('*').order('created_at', { ascending: false }),
      supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id),
    ]);

    setAnnouncements((anns as any) || []);
    setReadIds(new Set((rds as any)?.map((r: any) => r.announcement_id) || []));
    setLoading(false);
  };

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel('resident-announcements')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, () => loadData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const openDetail = async (ann: Announcement) => {
    setDetailDialog({ open: true, announcement: ann });

    const { data: att } = await supabase
      .from('announcement_attachments')
      .select('*')
      .eq('announcement_id', ann.id);
    setAttachments((att as any) || []);

    // Mark as read
    if (user && !readIds.has(ann.id)) {
      const { error } = await supabase
        .from('announcement_reads')
        .insert({ announcement_id: ann.id, user_id: user.id });
      if (!error) {
        setReadIds(prev => new Set([...prev, ann.id]));
      }
    }
  };

  const priorityBadge = (p: string) => {
    switch (p) {
      case 'urgent': return <Badge variant="destructive">Urgente</Badge>;
      case 'important': return <Badge variant="secondary">Importante</Badge>;
      default: return <Badge variant="outline">Normal</Badge>;
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const unreadCount = announcements.filter(a => !readIds.has(a.id)).length;

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Comunicados</h2>
          <p className="text-sm text-muted-foreground">Avisos e comunicados do condomínio</p>
        </div>
        {unreadCount > 0 && (
          <Badge variant="destructive">{unreadCount} não lido{unreadCount > 1 ? 's' : ''}</Badge>
        )}
      </div>

      {announcements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Megaphone className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum comunicado ainda</p>
          </CardContent>
        </Card>
      ) : (
        announcements.map((ann) => {
          const isRead = readIds.has(ann.id);
          return (
            <Card
              key={ann.id}
              className={`cursor-pointer transition-all hover:shadow-md ${!isRead ? 'border-primary/50 bg-primary/5' : ''}`}
              onClick={() => openDetail(ann)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {priorityBadge(ann.priority)}
                      {!isRead && <span className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <h3 className="font-semibold">{ann.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{ann.body}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {format(new Date(ann.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                  {isRead && <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-1" />}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Detail dialog */}
      <Dialog open={detailDialog.open} onOpenChange={(open) => setDetailDialog({ open, announcement: open ? detailDialog.announcement : null })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailDialog.announcement && priorityBadge(detailDialog.announcement.priority)}
              {detailDialog.announcement?.title}
            </DialogTitle>
          </DialogHeader>

          {detailDialog.announcement && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {format(new Date(detailDialog.announcement.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>

              <div className="bg-muted/50 rounded-lg p-4 whitespace-pre-wrap text-sm">
                {detailDialog.announcement.body}
              </div>

              {attachments.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Anexos</Label>
                  {attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <FileText className="h-4 w-4" />
                      {att.file_name} {att.file_size && <span className="text-muted-foreground">({formatSize(att.file_size)})</span>}
                    </a>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 text-sm text-primary">
                <CheckCircle className="h-4 w-4" />
                Leitura confirmada
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ResidentAnnouncements;
