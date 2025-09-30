'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import AuthenticatedApp from '@/components/AuthenticatedApp';

export default function AppWrapper() {
  return (
    <AuthProvider 
      requireAuth={true}
      loadingComponent={
        <div className="min-h-screen bg-base-100 flex items-center justify-center">
          <div className="text-center">
            <div className="loading loading-spinner loading-lg mb-4"></div>
            <p className="text-lg">Signing you in with Microsoft...</p>
            <p className="text-sm opacity-60 mt-2">You will be redirected to Microsoft login</p>
          </div>
        </div>
      }
    >
      <AuthenticatedApp />
    </AuthProvider>
  );
}