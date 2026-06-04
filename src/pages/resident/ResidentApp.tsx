import { lazy, Suspense, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import ResidentLayout, { type Counts } from './ResidentLayout';
import { Loader2 } from 'lucide-react';

const ResidentDashboard = lazy(() => import('./ResidentDashboard'));
const ResidentMails = lazy(() => import('./ResidentMails'));
const ResidentVisitors = lazy(() => import('./ResidentVisitors'));
const ResidentAuthorizations = lazy(() => import('./ResidentAuthorizations'));
const ResidentChat = lazy(() => import('./ResidentChat'));
const ResidentAnnouncements = lazy(() => import('./ResidentAnnouncements'));

const ResidentTabLoading = () => (
  <div className="min-h-[280px] flex items-center justify-center">
    <Loader2 className="w-7 h-7 animate-spin text-primary" />
  </div>
);

const RESIDENT_ACTIVE_TAB_KEY = 'resident-active-tab-v1';
const RESIDENT_TABS = new Set(['home', 'mails', 'announcements', 'visitors', 'authorizations', 'chat']);
const RESIDENT_HASH_PREFIX = 'morador-';

const getResidentTabFromHash = () => {
  const rawHash = window.location.hash.replace(/^#/, '').trim();
  if (!rawHash.startsWith(RESIDENT_HASH_PREFIX)) return null;
  const tab = rawHash.replace(RESIDENT_HASH_PREFIX, '');
  return RESIDENT_TABS.has(tab) ? tab : null;
};

const ResidentApp = () => {
  const [activeTab, setActiveTab] = useState(() => {
    const tabFromHash = getResidentTabFromHash();
    if (tabFromHash) return tabFromHash;

    try {
      const saved = localStorage.getItem(RESIDENT_ACTIVE_TAB_KEY);
      return saved && RESIDENT_TABS.has(saved) ? saved : 'home';
    } catch {
      return 'home';
    }
  });
  const [counts, setCounts] = useState<Counts>({ chat: 0, notif: 0, mails: 0, announcements: 0 });

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  useEffect(() => {
    try {
      localStorage.setItem(RESIDENT_ACTIVE_TAB_KEY, activeTab);
    } catch {
      // ignore storage errors
    }

    const expectedHash = `#${RESIDENT_HASH_PREFIX}${activeTab}`;
    if (window.location.hash !== expectedHash) {
      window.history.replaceState(null, '', expectedHash);
    }
  }, [activeTab]);

  useEffect(() => {
    const onHashChange = () => {
      const tabFromHash = getResidentTabFromHash();
      if (tabFromHash) setActiveTab(tabFromHash);
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const renderTab = () => {
    switch (activeTab) {
      case 'home': return <ResidentDashboard onNavigate={handleTabChange} counts={counts} />;
      case 'mails': return <ResidentMails />;
      case 'announcements': return <ResidentAnnouncements />;
      case 'visitors': return <ResidentVisitors />;
      case 'authorizations': return <ResidentAuthorizations />;
      case 'chat': return <ResidentChat />;
      default: return <ResidentDashboard onNavigate={handleTabChange} counts={counts} />;
    }
  };

  return (
    <ResidentLayout activeTab={activeTab} onTabChange={handleTabChange} counts={counts} setCounts={setCounts}>
      <Helmet>
        <title>Portal do Morador — PortalGuard Pro</title>
        <meta name="description" content="Acompanhe visitantes autorizados, correspondências, avisos do condomínio e converse com a portaria pelo Portal do Morador." />
        <link rel="canonical" href="https://portalguard.lovable.app/morador" />
        <meta property="og:title" content="Portal do Morador — PortalGuard Pro" />
        <meta property="og:description" content="O seu condomínio na palma da mão." />
        <meta property="og:url" content="https://portalguard.lovable.app/morador" />
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <Suspense fallback={<ResidentTabLoading />}>
        {renderTab()}
      </Suspense>
    </ResidentLayout>
  );
};

export default ResidentApp;
