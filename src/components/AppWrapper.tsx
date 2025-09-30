'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Phone from '@/components/Phone';
import Setup from '@/components/Setup';
import { AuthProvider } from '@/contexts/AuthContext';

export default function AppWrapper() {
  const [activeComponent, setActiveComponent] = useState('phone');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState('light');

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
    switch (activeComponent) {
      case 'phone':
        return <Phone theme={theme} />;
      case 'setup':
        return <Setup />;
      default:
        return <Phone theme={theme} />;
    }
  };

  return (
    <AuthProvider requireAuth={false}>
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
    </AuthProvider>
  );
}