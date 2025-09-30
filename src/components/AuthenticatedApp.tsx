'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Phone from '@/components/Phone';
import Setup from '@/components/Setup';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthenticatedApp() {
  const [activeComponent, setActiveComponent] = useState('phone');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState('light');
  const { isAuthenticated, isLoading, user } = useAuth();

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const renderComponent = () => {
    // Only show components if user is authenticated
    if (!isAuthenticated || !user) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="loading loading-spinner loading-lg mb-4"></div>
            <p className="text-lg">Please wait while we authenticate you...</p>
          </div>
        </div>
      );
    }

    switch (activeComponent) {
      case 'setup':
        return <Setup />;
      default:
        return <Phone theme={theme} />;
    }
  };

  // Show loading state during authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg mb-4"></div>
          <p className="text-lg">Authenticating with Microsoft...</p>
          <p className="text-sm opacity-60 mt-2">Please complete the sign-in process</p>
        </div>
      </div>
    );
  }

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