'use client';

import { TbPhone, TbSettings } from 'react-icons/tb';

interface SidebarProps {
  activeComponent: string;
  setActiveComponent: (component: string) => void;
  isCollapsed: boolean;
}

export default function Sidebar({ activeComponent, setActiveComponent, isCollapsed }: SidebarProps) {

  return (
    <div className={`bg-base-200 min-h-screen transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'}`}>
      <nav className="pt-4">
        <ul className="menu">
          <li>
            <button
              onClick={() => setActiveComponent('phone')}
              className={`${activeComponent === 'phone' ? 'active' : ''}`}
            >
              <TbPhone className="w-6 h-6" />
              {!isCollapsed && <span>Phone</span>}
            </button>
          </li>
          <li>
            <button
              onClick={() => setActiveComponent('setup')}
              className={`${activeComponent === 'setup' ? 'active' : ''}`}
            >
              <TbSettings className="w-6 h-6" />
              {!isCollapsed && <span>Setup</span>}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}