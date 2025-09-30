'use client';

/**
 * Authentication Context Provider
 * 
 * Provides authentication state and methods throughout the application
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AccountInfo, AuthenticationResult } from '@azure/msal-browser';
import { getAuthService, AuthService } from '@/services/authService';

interface AuthContextType {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AccountInfo | null;
  userProfile: any | null;
  userPhoto: string | null;
  error: string | null;
  
  // Methods
  login: (useRedirect?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: (scopes?: string[]) => Promise<string | null>;
  refreshToken: () => Promise<boolean>;
  switchAccount: (account: AccountInfo) => void;
  getAllAccounts: () => AccountInfo[];
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
  const [authService] = useState<AuthService>(() => getAuthService());
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AccountInfo | null>(null);
  const [userProfile, setUserProfile] = useState<any | null>(null);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize authentication state
  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      try {
        // Wait a bit for MSAL to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const currentUser = authService.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          setIsAuthenticated(true);
          
          // Load additional user data
          loadUserData();
        } else if (requireAuth) {
          // If auth is required and user is not authenticated, trigger login
          await authService.loginRedirect();
        }
      } catch (err) {
        console.error('Authentication initialization failed:', err);
        setError('Failed to initialize authentication');
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // Listen for authentication events
    const handleAuthSuccess = (event: CustomEvent) => {
      console.log('Authentication successful:', event.detail);
      setUser(authService.getCurrentUser());
      setIsAuthenticated(true);
      setError(null);
      loadUserData();
    };

    window.addEventListener('auth:success' as any, handleAuthSuccess);
    
    return () => {
      window.removeEventListener('auth:success' as any, handleAuthSuccess);
    };
  }, [authService, requireAuth]);

  // Load user profile and photo
  const loadUserData = useCallback(async () => {
    try {
      // Get user profile from Graph API
      const profile = await authService.getUserProfile();
      if (profile) {
        setUserProfile(profile);
      }

      // Get user photo
      const photo = await authService.getUserPhoto();
      if (photo) {
        setUserPhoto(photo);
      }
    } catch (err) {
      console.error('Failed to load user data:', err);
    }
  }, [authService]);

  // Login method
  const login = useCallback(async (useRedirect: boolean = false) => {
    setIsLoading(true);
    setError(null);
    try {
      if (useRedirect) {
        await authService.loginRedirect();
      } else {
        const response = await authService.loginPopup();
        if (response) {
          setUser(response.account);
          setIsAuthenticated(true);
          await loadUserData();
        }
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }, [authService, loadUserData]);

  // Logout method
  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authService.logout();
      setUser(null);
      setUserProfile(null);
      setUserPhoto(null);
      setIsAuthenticated(false);
    } catch (err: any) {
      console.error('Logout failed:', err);
      setError(err.message || 'Logout failed');
    } finally {
      setIsLoading(false);
    }
  }, [authService]);

  // Get access token
  const getAccessToken = useCallback(async (scopes?: string[]): Promise<string | null> => {
    try {
      return await authService.getAccessToken(scopes);
    } catch (err) {
      console.error('Failed to get access token:', err);
      return null;
    }
  }, [authService]);

  // Refresh token
  const refreshToken = useCallback(async (): Promise<boolean> => {
    try {
      return await authService.refreshTokens();
    } catch (err) {
      console.error('Failed to refresh token:', err);
      return false;
    }
  }, [authService]);

  // Switch account
  const switchAccount = useCallback((account: AccountInfo) => {
    authService.setActiveAccount(account);
    setUser(account);
    loadUserData();
  }, [authService, loadUserData]);

  // Get all accounts
  const getAllAccounts = useCallback((): AccountInfo[] => {
    return authService.getAllAccounts();
  }, [authService]);

  // Auto-refresh tokens before expiry
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkTokenExpiry = async () => {
      const isExpired = await authService.isTokenExpired();
      if (isExpired) {
        console.log('Token expired or about to expire, refreshing...');
        const refreshed = await refreshToken();
        if (!refreshed) {
          console.error('Failed to refresh token, user needs to re-authenticate');
          setError('Session expired. Please login again.');
          await logout();
        }
      }
    };

    // Check token every 5 minutes
    const interval = setInterval(checkTokenExpiry, 5 * 60 * 1000);
    
    // Also check immediately
    checkTokenExpiry();

    return () => clearInterval(interval);
  }, [isAuthenticated, authService, refreshToken, logout]);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    user,
    userProfile,
    userPhoto,
    error,
    login,
    logout,
    getAccessToken,
    refreshToken,
    switchAccount,
    getAllAccounts,
  };

  // Show loading component while initializing
  if (isLoading && requireAuth) {
    return <>{loadingComponent}</>;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};