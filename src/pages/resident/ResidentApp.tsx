import { useState } from 'react';
import ResidentLayout from './ResidentLayout';
import ResidentDashboard from './ResidentDashboard';
import ResidentMails from './ResidentMails';
import ResidentVisitors from './ResidentVisitors';
import ResidentAuthorizations from './ResidentAuthorizations';
import ResidentChat from './ResidentChat';
import ResidentAnnouncements from './ResidentAnnouncements';

const ResidentApp = () => {
  const [activeTab, setActiveTab] = useState('home');

  const renderTab = () => {
    switch (activeTab) {
      case 'home': return <ResidentDashboard />;
      case 'mails': return <ResidentMails />;
      case 'announcements': return <ResidentAnnouncements />;
      case 'visitors': return <ResidentVisitors />;
      case 'authorizations': return <ResidentAuthorizations />;
      case 'chat': return <ResidentChat />;
      default: return <ResidentDashboard />;
    }
  };

  return (
    <ResidentLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderTab()}
    </ResidentLayout>
  );
};

export default ResidentApp;
