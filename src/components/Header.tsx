'use client';

import { useEffect, useState } from 'react';
import { TbMenu2, TbSun, TbMoon } from 'react-icons/tb';

interface HeaderProps {
  onToggleSidebar: () => void;
  onThemeChange: (theme: string) => void;
}

export default function Header({ onToggleSidebar, onThemeChange }: HeaderProps) {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
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
        
        <div className="dropdown dropdown-end">
          <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar">
            <div className="w-10 rounded-full">
              <img alt="User Avatar" src="https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp" />
            </div>
          </div>
          <ul tabIndex={0} className="menu menu-sm dropdown-content bg-base-100 rounded-box z-[1] mt-3 w-52 p-2 shadow">
            <li>
              <a className="justify-between">
                Profile
                <span className="badge">New</span>
              </a>
            </li>
            <li><a>Settings</a></li>
            <li><a>Logout</a></li>
          </ul>
        </div>
      </div>
    </header>
  );
}