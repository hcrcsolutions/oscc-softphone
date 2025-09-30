'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: string[];
  fallback?: React.ReactNode;
}

export default function ProtectedRoute({ 
  children, 
  requiredRoles = [], 
  fallback 
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user, login } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Automatically redirect to login if not authenticated
      login(true);
    }
  }, [isLoading, isAuthenticated, login]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg"></div>
          <p className="mt-4 text-lg">Authenticating...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="card w-96 bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <h2 className="card-title justify-center">Authentication Required</h2>
            <p>Please sign in to access this application.</p>
            <div className="card-actions justify-center mt-4">
              <button className="btn btn-primary" onClick={() => login(false)}>
                Sign in with Microsoft
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Check role-based access if required
  if (requiredRoles.length > 0 && user) {
    const userRoles = (user.idTokenClaims as any)?.roles || [];
    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));
    
    if (!hasRequiredRole) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="card w-96 bg-base-100 shadow-xl">
            <div className="card-body text-center">
              <h2 className="card-title justify-center text-error">Access Denied</h2>
              <p>You don't have the required permissions to access this page.</p>
              <p className="text-sm opacity-60 mt-2">
                Required roles: {requiredRoles.join(', ')}
              </p>
              <div className="card-actions justify-center mt-4">
                <button className="btn btn-ghost" onClick={() => window.history.back()}>
                  Go Back
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  // Authenticated and authorized
  return <>{children}</>;
}