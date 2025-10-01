'use client';

/**
 * Authentication Context Provider
 * 
 * Provides authentication state and methods throughout the application
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AccountInfo, AuthenticationResult } from '@azure/msal-browser';
import { getAuthService, AuthService } from '@/services/authService';

// Check if SSO is enabled via environment variable
const SSO_ENABLED = process.env.NEXT_PUBLIC_SSO_ENABLED === 'true';

interface AuthContextType {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AccountInfo | null;
  userPhoto: string | null;
  error: string | null;
  
  // Methods
  login: () => Promise<void>;
  getAccessToken: (scopes?: string[]) => Promise<string | null>;
  refreshToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  loadingComponent?: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  requireAuth = false,
  loadingComponent = <div>Loading authentication...</div>,
}) => {
  const [authService] = useState<AuthService | null>(() => SSO_ENABLED ? getAuthService() : null);
  const [isLoading, setIsLoading] = useState(SSO_ENABLED);
  const [isAuthenticated, setIsAuthenticated] = useState(!SSO_ENABLED); // If SSO disabled, consider user authenticated
  const [user, setUser] = useState<AccountInfo | null>(null);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize authentication state
  useEffect(() => {
    // If SSO is disabled, skip authentication initialization
    if (!SSO_ENABLED) {
      console.log('SSO is disabled, skipping authentication');
      // Set a mock user for non-SSO mode
      setUser({
        username: 'Local User',
        localAccountId: 'local-user',
        tenantId: 'local',
        homeAccountId: 'local-user',
        environment: 'local',
        name: 'Local User',
      } as AccountInfo);
      return;
    }

    const initAuth = async () => {
      if (!authService) return;
      
      setIsLoading(true);
      try {
        // Wait a bit for MSAL to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const currentUser = authService.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          setIsAuthenticated(true);
        } else {
          // Always trigger popup login if user is not authenticated
          try {
            console.log('No authenticated user found, showing login popup...');
            const response = await authService.loginPopup();
            if (response) {
              setUser(response.account);
              setIsAuthenticated(true);
            }
          } catch (err: any) {
            // If popup fails (e.g., blocked), fall back to redirect
            if (err.errorCode === 'popup_window_error' || err.errorCode === 'empty_window_error') {
              console.log('Popup blocked, falling back to redirect login...');
              try {
                await authService.loginRedirect();
              } catch (redirectErr) {
                console.error('Redirect login also failed:', redirectErr);
                setError('Authentication required');
              }
            } else {
              console.error('Auto-login failed:', err);
              setError('Authentication required');
            }
          }
        }
      } catch (err) {
        console.error('Authentication initialization failed:', err);
        setError('Failed to initialize authentication');
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // Listen for authentication events (only if SSO is enabled)
    if (SSO_ENABLED && authService) {
      const handleAuthSuccess = (event: CustomEvent) => {
        console.log('Authentication successful:', event.detail);
        setUser(authService.getCurrentUser());
        setIsAuthenticated(true);
        setError(null);
      };

      window.addEventListener('auth:success' as any, handleAuthSuccess);
      
      return () => {
        window.removeEventListener('auth:success' as any, handleAuthSuccess);
      };
    }
  }, [authService]);

  // Set custom user photo if needed
  const setCustomUserPhoto = useCallback((photoUrl: string) => {
    setUserPhoto(photoUrl);
  }, []);

  // Login method (no-op if SSO is disabled)
  const login = useCallback(async () => {
    if (!SSO_ENABLED || !authService) {
      console.log('SSO is disabled, login is not required');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      const response = await authService.loginPopup();
      if (response) {
        setUser(response.account);
        setIsAuthenticated(true);
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }, [authService]);


  // Get access token (returns null if SSO is disabled)
  const getAccessToken = useCallback(async (scopes?: string[]): Promise<string | null> => {
    if (!SSO_ENABLED || !authService) {
      return null;
    }
    
    try {
      return await authService.getAccessToken(scopes);
    } catch (err) {
      console.error('Failed to get access token:', err);
      return null;
    }
  }, [authService]);

  // Refresh token (returns true if SSO is disabled)
  const refreshToken = useCallback(async (): Promise<boolean> => {
    if (!SSO_ENABLED || !authService) {
      return true;
    }
    
    try {
      return await authService.refreshTokens();
    } catch (err) {
      console.error('Failed to refresh token:', err);
      return false;
    }
  }, [authService]);


  // Auto-refresh tokens before expiry (only if SSO is enabled)
  useEffect(() => {
    if (!SSO_ENABLED || !authService || !isAuthenticated) return;

    const checkTokenExpiry = async () => {
      const isExpired = await authService.isTokenExpired();
      if (isExpired) {
        console.log('Token expired or about to expire, refreshing...');
        const refreshed = await refreshToken();
        if (!refreshed) {
          console.error('Failed to refresh token, user needs to re-authenticate');
          setError('Session expired. Please login again.');
          // Session expired, user needs to re-authenticate
        }
      }
    };

    // Check token every 5 minutes
    const interval = setInterval(checkTokenExpiry, 5 * 60 * 1000);
    
    // Also check immediately
    checkTokenExpiry();

    return () => clearInterval(interval);
  }, [isAuthenticated, authService, refreshToken]);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    user,
    userPhoto,
    error,
    login,
    getAccessToken,
    refreshToken,
  };

  // Show loading component while initializing
  if (isLoading && requireAuth) {
    return <>{loadingComponent}</>;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};