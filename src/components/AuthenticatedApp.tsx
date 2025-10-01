'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Phone from '@/components/Phone';
import Setup from '@/components/Setup';
import { useAuth } from '@/contexts/AuthContext';
import { useTabStorage } from '@/utils/tabStorage';

// Check if SSO is enabled
const SSO_ENABLED = process.env.NEXT_PUBLIC_SSO_ENABLED === 'true';

export default function AuthenticatedApp() {
  const [activeComponent, setActiveComponent] = useState('phone');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState('light');
  const { isAuthenticated, isLoading, user } = useAuth();
  const { getItem, loadDefaultTemplateIfNeeded } = useTabStorage();

  useEffect(() => {
    // Try to load default template if no configuration exists
    loadDefaultTemplateIfNeeded();
    
    const savedTheme = getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, [getItem, loadDefaultTemplateIfNeeded]);

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const renderComponent = () => {
    // Show message if SSO is enabled but user is not authenticated
    if (SSO_ENABLED && (!isAuthenticated || !user)) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="loading loading-spinner loading-lg mb-4"></div>
            <p className="text-lg">Authenticating with Microsoft...</p>
            <p className="text-sm opacity-60 mt-2">Please complete the sign-in in the popup window</p>
          </div>
        </div>
      );
    }

    // Show components (authentication not required if SSO is disabled)
    switch (activeComponent) {
      case 'setup':
        return <Setup />;
      default:
        return <Phone theme={theme} />;
    }
  };

  // Don't show loading state - UI should always be visible

  return (
    <div className="min-h-screen bg-base-100">
      <Header onToggleSidebar={toggleSidebar} onThemeChange={handleThemeChange} />
      <div className="flex">
        <Sidebar 
          activeComponent={activeComponent} 
          setActiveComponent={setActiveComponent}
          isCollapsed={isSidebarCollapsed}
        />
        <main className="flex-1 bg-base-100 min-h-[calc(100vh-4rem)]">
          {renderComponent()}
        </main>
      </div>
    </div>
  );
}