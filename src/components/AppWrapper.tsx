'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import AuthenticatedApp from '@/components/AuthenticatedApp';

export default function AppWrapper() {
  return (
    <AuthProvider requireAuth={false}>
      <AuthenticatedApp />
    </AuthProvider>
  );
}