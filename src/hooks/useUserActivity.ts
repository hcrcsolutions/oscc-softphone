'use client';

import { useEffect, useState } from 'react';

interface UserActivityState {
  isInactive: boolean;
  isTabHidden: boolean;
  lastInactiveTime: string | null;
  lastActiveTime: string | null;
  lastTabHiddenTime: string | null;
  lastTabVisibleTime: string | null;
}

/**
 * Custom hook to listen to user activity and tab visibility events
 *
 * @returns UserActivityState object with current activity state
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isInactive, isTabHidden } = useUserActivity();
 *
 *   useEffect(() => {
 *     if (isInactive) {
 *       console.log('User is inactive, pause updates');
 *     }
 *   }, [isInactive]);
 *
 *   useEffect(() => {
 *     if (isTabHidden) {
 *       console.log('Tab is hidden, reduce polling frequency');
 *     }
 *   }, [isTabHidden]);
 *
 *   return <div>User active: {!isInactive && !isTabHidden}</div>;
 * }
 * ```
 */
export function useUserActivity(): UserActivityState {
  const [state, setState] = useState<UserActivityState>({
    isInactive: false,
    isTabHidden: false,
    lastInactiveTime: null,
    lastActiveTime: null,
    lastTabHiddenTime: null,
    lastTabVisibleTime: null,
  });

  useEffect(() => {
    const handleUserInactive = (event: Event) => {
      const customEvent = event as CustomEvent;
      setState(prev => ({
        ...prev,
        isInactive: true,
        lastInactiveTime: customEvent.detail?.timestamp || new Date().toISOString(),
      }));
    };

    const handleUserActive = (event: Event) => {
      const customEvent = event as CustomEvent;
      setState(prev => ({
        ...prev,
        isInactive: false,
        lastActiveTime: customEvent.detail?.timestamp || new Date().toISOString(),
      }));
    };

    const handleTabHidden = (event: Event) => {
      const customEvent = event as CustomEvent;
      setState(prev => ({
        ...prev,
        isTabHidden: true,
        lastTabHiddenTime: customEvent.detail?.timestamp || new Date().toISOString(),
      }));
    };

    const handleTabVisible = (event: Event) => {
      const customEvent = event as CustomEvent;
      setState(prev => ({
        ...prev,
        isTabHidden: false,
        lastTabVisibleTime: customEvent.detail?.timestamp || new Date().toISOString(),
      }));
    };

    window.addEventListener('user:inactive', handleUserInactive);
    window.addEventListener('user:active', handleUserActive);
    window.addEventListener('tab:hidden', handleTabHidden);
    window.addEventListener('tab:visible', handleTabVisible);

    return () => {
      window.removeEventListener('user:inactive', handleUserInactive);
      window.removeEventListener('user:active', handleUserActive);
      window.removeEventListener('tab:hidden', handleTabHidden);
      window.removeEventListener('tab:visible', handleTabVisible);
    };
  }, []);

  return state;
}
