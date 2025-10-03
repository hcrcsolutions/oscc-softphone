'use client';

import { useEffect, useState } from 'react';
import { useUserActivity } from '@/hooks/useUserActivity';

/**
 * Example component demonstrating how to listen to user activity events
 *
 * Shows two approaches:
 * 1. Using the custom hook (recommended)
 * 2. Using direct event listeners
 */
export default function ActivityListenerExample() {
  // Approach 1: Using custom hook (recommended - simpler)
  const { isInactive, isTabHidden, lastActiveTime, lastTabVisibleTime } = useUserActivity();

  // Approach 2: Using direct event listeners
  const [eventLog, setEventLog] = useState<string[]>([]);

  useEffect(() => {
    const handleUserInactive = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('User became inactive at:', customEvent.detail.timestamp);
      setEventLog(prev => [...prev.slice(-9), `[${new Date().toLocaleTimeString()}] User inactive`]);
    };

    const handleUserActive = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('User became active at:', customEvent.detail.timestamp);
      setEventLog(prev => [...prev.slice(-9), `[${new Date().toLocaleTimeString()}] User active`]);
    };

    const handleTabHidden = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('Tab hidden at:', customEvent.detail.timestamp);
      setEventLog(prev => [...prev.slice(-9), `[${new Date().toLocaleTimeString()}] Tab hidden`]);
    };

    const handleTabVisible = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('Tab visible at:', customEvent.detail.timestamp,
        'Hidden for:', customEvent.detail.hiddenDurationSeconds, 'seconds');
      setEventLog(prev => [...prev.slice(-9),
        `[${new Date().toLocaleTimeString()}] Tab visible (was hidden for ${customEvent.detail.hiddenDurationSeconds}s)`
      ]);
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

  // React to state changes from custom hook
  useEffect(() => {
    if (isInactive) {
      console.log('[Hook] User is now inactive - could pause API polling here');
    } else {
      console.log('[Hook] User is now active - could resume API polling here');
    }
  }, [isInactive]);

  useEffect(() => {
    if (isTabHidden) {
      console.log('[Hook] Tab is now hidden - could reduce background activity here');
    } else {
      console.log('[Hook] Tab is now visible - could resume normal activity here');
    }
  }, [isTabHidden]);

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Activity Listener Example</h2>

        <div className="grid grid-cols-2 gap-4 my-4">
          {/* Status from custom hook */}
          <div className="stats shadow">
            <div className="stat">
              <div className="stat-title">User Status (Hook)</div>
              <div className="stat-value text-lg">
                {isInactive ? (
                  <span className="text-error">Inactive</span>
                ) : (
                  <span className="text-success">Active</span>
                )}
              </div>
              {lastActiveTime && (
                <div className="stat-desc">Last active: {new Date(lastActiveTime).toLocaleTimeString()}</div>
              )}
            </div>
          </div>

          <div className="stats shadow">
            <div className="stat">
              <div className="stat-title">Tab Status (Hook)</div>
              <div className="stat-value text-lg">
                {isTabHidden ? (
                  <span className="text-warning">Hidden</span>
                ) : (
                  <span className="text-success">Visible</span>
                )}
              </div>
              {lastTabVisibleTime && (
                <div className="stat-desc">Last visible: {new Date(lastTabVisibleTime).toLocaleTimeString()}</div>
              )}
            </div>
          </div>
        </div>

        {/* Event log from direct listeners */}
        <div className="mt-4">
          <h3 className="font-bold mb-2">Event Log (Direct Listeners)</h3>
          <div className="bg-base-200 p-3 rounded-lg max-h-48 overflow-y-auto">
            {eventLog.length === 0 ? (
              <p className="text-base-content/50 text-sm">No events yet. Try being inactive or switching tabs.</p>
            ) : (
              <ul className="text-xs font-mono space-y-1">
                {eventLog.map((event, index) => (
                  <li key={index} className="text-base-content/70">{event}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Usage instructions */}
        <div className="alert alert-info mt-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div className="text-sm">
            <p className="font-bold">Test Instructions:</p>
            <ul className="list-disc list-inside mt-1">
              <li>Stop moving mouse/clicking for 5 minutes to see inactive state</li>
              <li>Switch to another browser tab to see tab hidden state</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
