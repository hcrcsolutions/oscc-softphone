'use client';

import { useEffect, useState } from 'react';
import { TbMenu2, TbSun, TbMoon } from 'react-icons/tb';
import Avatar from '@/components/Avatar';
import { useTabStorage } from '@/utils/tabStorage';

interface HeaderProps {
  onToggleSidebar: () => void;
  onThemeChange: (theme: string) => void;
}

export default function Header({ onToggleSidebar, onThemeChange }: HeaderProps) {
  const [theme, setTheme] = useState('light');
  const { getItem, setItem } = useTabStorage();

  useEffect(() => {
    const savedTheme = getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, [getItem]);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    onThemeChange(newTheme);
  };

  return (
    <header className="navbar bg-base-200 shadow-lg">
      <div className="flex-1">
        <button 
          onClick={onToggleSidebar}
          className="btn btn-square btn-ghost"
          aria-label="Toggle sidebar"
        >
          <TbMenu2 className="w-6 h-6" />
        </button>
        <a className="btn btn-ghost text-xl">OSCC Softphone</a>
      </div>
      <div className="flex-none flex items-center gap-4">
        <label className="swap swap-rotate">
          <input 
            type="checkbox" 
            onChange={toggleTheme}
            checked={theme === 'dark'}
          />
          
          <TbSun className="swap-off w-8 h-8" />
          
          <TbMoon className="swap-on w-8 h-8" />
        </label>
        
        <Avatar />
      </div>
    </header>
  );
}