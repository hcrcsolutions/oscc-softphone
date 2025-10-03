'use client';

import { useEffect, useRef, useState } from 'react';

interface InactivityMonitorProps {
  /**
   * Time in milliseconds before user is considered inactive
   * @default 300000 (5 minutes)
   */
  inactivityTimeout?: number;

  /**
   * Whether to show debug info
   * @default false
   */
  debug?: boolean;
}

/**
 * InactivityMonitor Component
 *
 * Monitors user activity (mouse moves, clicks, key presses, touches)
 * and broadcasts inactive/active state changes via custom events.
 *
 * Events dispatched:
 * - 'user:inactive' - User has been inactive for the specified timeout
 * - 'user:active' - User became active again after being inactive
 *
 * Example usage in other components:
 * ```tsx
 * useEffect(() => {
 *   const handleInactive = () => console.log('User is inactive');
 *   const handleActive = () => console.log('User is active');
 *
 *   window.addEventListener('user:inactive', handleInactive);
 *   window.addEventListener('user:active', handleActive);
 *
 *   return () => {
 *     window.removeEventListener('user:inactive', handleInactive);
 *     window.removeEventListener('user:active', handleActive);
 *   };
 * }, []);
 * ```
 */
export default function InactivityMonitor({
  inactivityTimeout = 300000, // 5 minutes default
  debug = false
}: InactivityMonitorProps) {
  const [isInactive, setIsInactive] = useState(false);
  const [lastActivityTime, setLastActivityTime] = useState<Date>(new Date());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInactiveRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    isInactiveRef.current = isInactive;
  }, [isInactive]);

  useEffect(() => {
    // Activity events to monitor
    const activityEvents = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ];

    const handleActivity = () => {
      const now = new Date();
      setLastActivityTime(now);

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // If user was inactive, mark as active again
      if (isInactiveRef.current) {
        setIsInactive(false);
        window.dispatchEvent(new CustomEvent('user:active', {
          detail: { timestamp: now.toISOString() }
        }));

        if (debug) {
          console.log('[InactivityMonitor] User became active');
        }
      }

      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        setIsInactive(true);
        const inactiveTime = new Date();
        window.dispatchEvent(new CustomEvent('user:inactive', {
          detail: {
            timestamp: inactiveTime.toISOString(),
            lastActivity: now.toISOString()
          }
        }));

        if (debug) {
          console.log('[InactivityMonitor] User became inactive');
        }
      }, inactivityTimeout);
    };

    // Initialize - user is active on mount
    handleActivity();

    // Add event listeners
    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [inactivityTimeout, debug]);

  // Don't render anything in production
  if (!debug) {
    return null;
  }

  // Debug UI
  return (
    <div className="fixed bottom-4 left-4 bg-base-200 p-3 rounded-lg shadow-lg text-xs z-50 max-w-xs">
      <div className="font-bold mb-2 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isInactive ? 'bg-error' : 'bg-success'}`}></div>
        Inactivity Monitor
      </div>
      <div className="space-y-1 text-base-content/70">
        <div>Status: <span className="font-semibold">{isInactive ? 'Inactive' : 'Active'}</span></div>
        <div>Timeout: <span className="font-semibold">{inactivityTimeout / 1000}s</span></div>
        <div>Last Activity: <span className="font-semibold">{lastActivityTime.toLocaleTimeString()}</span></div>
      </div>
    </div>
  );
}
