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
    // Show message if user is not authenticated
    if (!isAuthenticated || !user) {
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

    // Only show Phone and Setup for authenticated users
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