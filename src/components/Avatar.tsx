'use client';

import React from 'react';
import { TbUser } from 'react-icons/tb';
import { useAuth } from '@/contexts/AuthContext';

export default function Avatar() {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return (
      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-base-200">
        <TbUser className="w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar flex items-center justify-center">
        <div className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden">
          <div className="w-full h-full bg-primary flex items-center justify-center text-white font-medium">
            {(user.name || user.username || 'U')[0].toUpperCase()}
          </div>
        </div>
      </div>
      <ul tabIndex={0} className="menu menu-sm dropdown-content bg-base-100 rounded-box z-[1] mt-3 min-w-max p-2 shadow border border-base-300">
        <li className="menu-title">
          <span className="text-sm font-medium">{user.name || user.username}</span>
        </li>
        <li>
          <a className="text-xs opacity-60">{user.username}</a>
        </li>
        <div className="divider my-1"></div>
        <li>
          <a onClick={() => {
            // You can add profile navigation here
          }}>
            <TbUser className="w-4 h-4" />
            Profile
          </a>
        </li>
      </ul>
    </div>
  );
}