import { useEffect, useState } from 'react';
import ResidentLayout, { type Counts } from './ResidentLayout';
import ResidentDashboard from './ResidentDashboard';
import ResidentMails from './ResidentMails';
import ResidentVisitors from './ResidentVisitors';
import ResidentAuthorizations from './ResidentAuthorizations';
import ResidentChat from './ResidentChat';
import ResidentAnnouncements from './ResidentAnnouncements';

const RESIDENT_ACTIVE_TAB_KEY = 'resident-active-tab-v1';
const RESIDENT_TABS = new Set(['home', 'mails', 'announcements', 'visitors', 'authorizations', 'chat']);

const ResidentApp = () => {
  const [activeTab, setActiveTab] = useState(() => {
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
  }, [activeTab]);

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
      {renderTab()}
    </ResidentLayout>
  );
};

export default ResidentApp;
