'use client';

import { useEffect, useState } from 'react';

interface TabVisibilityMonitorProps {
  /**
   * Whether to show debug info
   * @default false
   */
  debug?: boolean;
}

/**
 * TabVisibilityMonitor Component
 *
 * Monitors browser tab visibility state (whether user has switched
 * to a different tab or minimized the window) and broadcasts state
 * changes via custom events.
 *
 * Events dispatched:
 * - 'tab:hidden' - Tab is no longer visible (user switched to another tab)
 * - 'tab:visible' - Tab became visible again
 *
 * Example usage in other components:
 * ```tsx
 * useEffect(() => {
 *   const handleTabHidden = () => console.log('Tab is hidden');
 *   const handleTabVisible = () => console.log('Tab is visible');
 *
 *   window.addEventListener('tab:hidden', handleTabHidden);
 *   window.addEventListener('tab:visible', handleTabVisible);
 *
 *   return () => {
 *     window.removeEventListener('tab:hidden', handleTabHidden);
 *     window.removeEventListener('tab:visible', handleTabVisible);
 *   };
 * }, []);
 * ```
 */
export default function TabVisibilityMonitor({
  debug = false
}: TabVisibilityMonitorProps) {
  const [isHidden, setIsHidden] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [lastHiddenTime, setLastHiddenTime] = useState<Date | null>(null);
  const [lastVisibleTime, setLastVisibleTime] = useState<Date>(new Date());

  useEffect(() => {
    const handleVisibilityChange = () => {
      const now = new Date();

      if (document.hidden) {
        // Tab became hidden
        setIsHidden(true);
        setLastHiddenTime(now);
        setHiddenCount(prev => prev + 1);

        window.dispatchEvent(new CustomEvent('tab:hidden', {
          detail: {
            timestamp: now.toISOString(),
            hiddenCount: hiddenCount + 1
          }
        }));

        if (debug) {
          console.log('[TabVisibilityMonitor] Tab became hidden');
        }
      } else {
        // Tab became visible
        setIsHidden(false);
        setLastVisibleTime(now);

        const hiddenDuration = lastHiddenTime
          ? now.getTime() - lastHiddenTime.getTime()
          : 0;

        window.dispatchEvent(new CustomEvent('tab:visible', {
          detail: {
            timestamp: now.toISOString(),
            hiddenDuration: hiddenDuration,
            hiddenDurationSeconds: Math.floor(hiddenDuration / 1000)
          }
        }));

        if (debug) {
          console.log('[TabVisibilityMonitor] Tab became visible (was hidden for',
            Math.floor(hiddenDuration / 1000), 'seconds)');
        }
      }
    };

    // Set initial state
    setIsHidden(document.hidden);

    // Add event listener
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [debug, hiddenCount, lastHiddenTime]);

  // Don't render anything in production
  if (!debug) {
    return null;
  }

  // Debug UI
  return (
    <div className="fixed bottom-4 right-4 bg-base-200 p-3 rounded-lg shadow-lg text-xs z-50 max-w-xs">
      <div className="font-bold mb-2 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isHidden ? 'bg-warning' : 'bg-success'}`}></div>
        Tab Visibility Monitor
      </div>
      <div className="space-y-1 text-base-content/70">
        <div>Status: <span className="font-semibold">{isHidden ? 'Hidden' : 'Visible'}</span></div>
        <div>Hidden Count: <span className="font-semibold">{hiddenCount}</span></div>
        {lastHiddenTime && (
          <div>Last Hidden: <span className="font-semibold">{lastHiddenTime.toLocaleTimeString()}</span></div>
        )}
        <div>Last Visible: <span className="font-semibold">{lastVisibleTime.toLocaleTimeString()}</span></div>
      </div>
    </div>
  );
}
