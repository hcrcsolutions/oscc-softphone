'use client';

import React from 'react';
import { TbUser } from 'react-icons/tb';
import { useAuth } from '@/contexts/AuthContext';

export default function Avatar() {
  const { user, userPhoto, logout, isAuthenticated } = useAuth();

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
          {userPhoto ? (
            <img 
              src={userPhoto} 
              alt={user.name || 'User'} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-primary flex items-center justify-center text-white font-medium">
              {(user.name || user.username || 'U')[0].toUpperCase()}
            </div>
          )}
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
        <li>
          <a onClick={async () => {
            await logout();
          }} className="text-error">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </a>
        </li>
      </ul>
    </div>
  );
}