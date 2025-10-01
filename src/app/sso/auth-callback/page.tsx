'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthService } from '@/services/authService';

export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState('Processing authentication...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        setStatus('Processing authentication...');
        
        // Get the auth service instance
        const authService = getAuthService();
        
        // The MSAL library should automatically handle the redirect response
        // when the page loads via handleRedirectPromise() in initializeMsal()
        
        // Give MSAL some time to process the redirect response
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if authentication was successful
        const currentUser = authService.getCurrentUser();
        if (currentUser) {
          setStatus('Authentication successful! Redirecting...');
          console.log('Authentication successful:', currentUser.username);
          
          // Wait a bit more before redirecting
          await new Promise(resolve => setTimeout(resolve, 1000));
          router.push('/');
        } else {
          setError('Authentication failed. Please try again.');
          setTimeout(() => router.push('/'), 3000);
        }
      } catch (error) {
        console.error('Error handling auth callback:', error);
        setError('An error occurred during authentication.');
        setTimeout(() => router.push('/'), 3000);
      }
    };

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center">
      <div className="text-center">
        <div className="loading loading-spinner loading-lg mb-4"></div>
        <p className="text-lg">{status}</p>
        {error ? (
          <p className="text-sm text-error mt-2">{error}</p>
        ) : (
          <p className="text-sm opacity-60 mt-2">Please wait while we complete the sign-in process</p>
        )}
      </div>
    </div>
  );
}