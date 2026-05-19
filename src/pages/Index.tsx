import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Layout } from '@/components/Layout';
import { Sidebar } from '@/components/Sidebar';
import { Dashboard } from './Dashboard';
import { Residents } from './Residents';
import { NewRegistry } from './NewRegistry';
import { MailManagement } from './MailManagement';
import { MailLogs } from './MailLogs';
import { Devices } from './Devices';
import { Logs } from './Logs';
import { Settings } from './Settings';
import { Reports } from './Reports';
import StaffChat from './StaffChat';
import StaffAuthorizations from './StaffAuthorizations';
import StaffAnnouncements from './StaffAnnouncements';


const STAFF_ACTIVE_SECTION_KEY = 'staff-active-section-v1';
const STAFF_SECTIONS = new Set([
  'dashboard',
  'residents',
  'new-registry',
  'mail',
  'mail-logs',
  'staff-chat',
  'authorizations',
  'announcements',
  'devices',
  'logs',
  'reports',
  'settings',
]);

const getSectionFromHash = () => {
  const rawHash = window.location.hash.replace(/^#/, '').trim();
  return STAFF_SECTIONS.has(rawHash) ? rawHash : null;
};

const Index = () => {
  const [activeSection, setActiveSection] = useState(() => {
    const sectionFromHash = getSectionFromHash();
    if (sectionFromHash) return sectionFromHash;

    try {
      const saved = localStorage.getItem(STAFF_ACTIVE_SECTION_KEY);
      return saved && STAFF_SECTIONS.has(saved) ? saved : 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STAFF_ACTIVE_SECTION_KEY, activeSection);
    } catch {
      // ignore storage errors
    }

    if (window.location.hash !== `#${activeSection}`) {
      window.history.replaceState(null, '', `#${activeSection}`);
    }
  }, [activeSection]);

  useEffect(() => {
    const onHashChange = () => {
      const sectionFromHash = getSectionFromHash();
      if (sectionFromHash) setActiveSection(sectionFromHash);
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard': return <Dashboard />;
      case 'residents': return <Residents />;
      case 'new-registry': return <NewRegistry />;
      case 'mail': return <MailManagement />;
      case 'mail-logs': return <MailLogs />;
      
      case 'staff-chat': return <StaffChat />;
      case 'authorizations': return <StaffAuthorizations />;
      case 'announcements': return <StaffAnnouncements />;
      case 'devices': return <Devices />;
      case 'logs': return <Logs />;
      case 'reports': return <Reports />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  const handleSectionChange = (section: string) => {
    setActiveSection(section);
    setSidebarOpen(false);
  };

  return (
    <Layout>
      <Helmet>
        <title>Painel da equipe — PortalGuard Pro</title>
        <meta name="description" content="Painel da equipe do condomínio: gerencie moradores, visitantes, prestadores, correspondências e dispositivos no PortalGuard Pro." />
        <link rel="canonical" href="https://portalguard.lovable.app/" />
        <meta property="og:title" content="Painel da equipe — PortalGuard Pro" />
        <meta property="og:description" content="Gerencie o seu condomínio em um único painel." />
        <meta property="og:url" content="https://portalguard.lovable.app/" />
      </Helmet>
      <Sidebar
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        isOpen={sidebarOpen}
      />
      <main className="flex-1 p-6 md:ml-0 overflow-x-hidden">
        {renderSection()}
      </main>
    </Layout>
  );
};

export default Index;
