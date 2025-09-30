'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';

interface LoginButtonProps {
  className?: string;
  showUserInfo?: boolean;
}

export default function LoginButton({ className = '', showUserInfo = true }: LoginButtonProps) {
  const { isAuthenticated, isLoading, user, userPhoto, login, logout, error } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);

  if (isLoading) {
    return (
      <div className={`btn btn-ghost loading ${className}`}>
        Loading...
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div className="dropdown dropdown-end">
        <div 
          tabIndex={0} 
          role="button" 
          className={`btn btn-ghost ${className}`}
          onClick={() => setShowDropdown(!showDropdown)}
        >
          <div className="flex items-center gap-2">
            {userPhoto ? (
              <img 
                src={userPhoto} 
                alt={user.name || 'User'} 
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white">
                {(user.name || user.username || 'U')[0].toUpperCase()}
              </div>
            )}
            {showUserInfo && (
              <div className="text-left">
                <div className="text-sm font-medium">{user.name || user.username}</div>
                <div className="text-xs opacity-60">Microsoft Entra ID</div>
              </div>
            )}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        
        {showDropdown && (
          <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-[1] w-52 p-2 shadow border border-base-300">
            <li className="menu-title">
              <span>{user.username}</span>
            </li>
            <li>
              <a onClick={() => {
                setShowDropdown(false);
                // You can add profile navigation here
              }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile
              </a>
            </li>
            <li>
              <a onClick={() => {
                setShowDropdown(false);
                // You can add settings navigation here
              }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </a>
            </li>
            <div className="divider my-1"></div>
            <li>
              <a onClick={async () => {
                setShowDropdown(false);
                await logout();
              }} className="text-error">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </a>
            </li>
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        className={`btn btn-primary ${className}`}
        onClick={() => login(false)}
        disabled={isLoading}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
        </svg>
        Sign in with Microsoft
      </button>
      {error && (
        <div className="alert alert-error mt-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}
    </>
  );
}