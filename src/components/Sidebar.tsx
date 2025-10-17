import { cn } from '@/lib/utils';
import { LayoutDashboard, Users, FileText, Mail, ScrollText, Settings, Smartphone } from 'lucide-react';

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
  { id: 'devices', label: 'Dispositivos', icon: Smartphone, group: 'Sistema' },
  { id: 'logs', label: 'Logs de Acesso', icon: ScrollText, group: 'Sistema' },
  { id: 'settings', label: 'Configurações', icon: Settings, group: 'Sistema' },
];

const groups = ['Principal', 'Cadastros', 'Sistema'];

export const Sidebar = ({ activeSection, onSectionChange, isOpen }: SidebarProps) => {
  return (
    <aside
      className={cn(
        'fixed md:relative z-40 w-80 bg-card shadow-card transition-transform duration-300',
        'md:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <div className="p-6 space-y-6 h-[calc(100vh-88px)] overflow-y-auto">
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
                  
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSectionChange(item.id)}
                      className={cn(
                        'w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-left font-medium transition-all',
                        'hover:translate-x-2',
                        isActive
                          ? 'bg-gradient-primary text-white shadow-elegant translate-x-1'
                          : 'text-foreground hover:bg-muted'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
            </nav>
          </div>
        ))}
      </div>
    </aside>
  );
};
