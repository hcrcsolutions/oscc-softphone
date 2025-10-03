# Activity & Visibility Monitoring

This guide explains how to use the activity monitoring components to track user inactivity and tab visibility in your application.

## Components

### 1. InactivityMonitor
Monitors user activity (mouse moves, clicks, key presses, touches) and broadcasts events when the user becomes inactive or active.

### 2. TabVisibilityMonitor
Monitors browser tab visibility and broadcasts events when the tab is hidden or visible.

## Setup

Add the monitor components to your root layout or main app component:

```tsx
import InactivityMonitor from '@/components/InactivityMonitor';
import TabVisibilityMonitor from '@/components/TabVisibilityMonitor';

export default function App() {
  return (
    <>
      {/* Add monitors - they render nothing in production */}
      <InactivityMonitor inactivityTimeout={300000} /> {/* 5 minutes */}
      <TabVisibilityMonitor />

      {/* Or with debug UI visible */}
      <InactivityMonitor inactivityTimeout={60000} debug={true} /> {/* 1 minute with debug */}
      <TabVisibilityMonitor debug={true} />

      {/* Your app components */}
      <YourAppContent />
    </>
  );
}
```

## Usage

### Method 1: Using the Custom Hook (Recommended)

```tsx
import { useUserActivity } from '@/hooks/useUserActivity';

function MyComponent() {
  const {
    isInactive,
    isTabHidden,
    lastActiveTime,
    lastInactiveTime,
    lastTabVisibleTime,
    lastTabHiddenTime
  } = useUserActivity();

  // React to inactivity
  useEffect(() => {
    if (isInactive) {
      console.log('User is inactive - pause API polling');
      // Stop unnecessary API calls, pause animations, etc.
    } else {
      console.log('User is active - resume API polling');
    }
  }, [isInactive]);

  // React to tab visibility
  useEffect(() => {
    if (isTabHidden) {
      console.log('Tab is hidden - reduce background activity');
      // Reduce polling frequency, pause videos, etc.
    } else {
      console.log('Tab is visible - resume normal activity');
    }
  }, [isTabHidden]);

  // Combined logic
  const shouldPauseUpdates = isInactive || isTabHidden;

  return (
    <div>
      <p>User Status: {isInactive ? 'Inactive' : 'Active'}</p>
      <p>Tab Status: {isTabHidden ? 'Hidden' : 'Visible'}</p>
      <p>Should Pause: {shouldPauseUpdates ? 'Yes' : 'No'}</p>
    </div>
  );
}
```

### Method 2: Using Direct Event Listeners

```tsx
import { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    // User inactivity handlers
    const handleUserInactive = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('User inactive at:', customEvent.detail.timestamp);
      console.log('Last activity:', customEvent.detail.lastActivity);
      // Pause updates, stop polling, etc.
    };

    const handleUserActive = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('User active at:', customEvent.detail.timestamp);
      // Resume updates, start polling, etc.
    };

    // Tab visibility handlers
    const handleTabHidden = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('Tab hidden at:', customEvent.detail.timestamp);
      console.log('Hidden count:', customEvent.detail.hiddenCount);
      // Reduce background activity
    };

    const handleTabVisible = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('Tab visible at:', customEvent.detail.timestamp);
      console.log('Was hidden for (ms):', customEvent.detail.hiddenDuration);
      console.log('Was hidden for (s):', customEvent.detail.hiddenDurationSeconds);
      // Resume normal activity
    };

    // Register listeners
    window.addEventListener('user:inactive', handleUserInactive);
    window.addEventListener('user:active', handleUserActive);
    window.addEventListener('tab:hidden', handleTabHidden);
    window.addEventListener('tab:visible', handleTabVisible);

    // Cleanup
    return () => {
      window.removeEventListener('user:inactive', handleUserInactive);
      window.removeEventListener('user:active', handleUserActive);
      window.removeEventListener('tab:hidden', handleTabHidden);
      window.removeEventListener('tab:visible', handleTabVisible);
    };
  }, []);

  return <div>Listening to activity events...</div>;
}
```

## Events Reference

### User Inactivity Events

#### `user:inactive`
Dispatched when user has been inactive for the specified timeout.

**Event Detail:**
```typescript
{
  timestamp: string;        // ISO timestamp when user became inactive
  lastActivity: string;     // ISO timestamp of last activity
}
```

#### `user:active`
Dispatched when user becomes active again after being inactive.

**Event Detail:**
```typescript
{
  timestamp: string;        // ISO timestamp when user became active
}
```

### Tab Visibility Events

#### `tab:hidden`
Dispatched when the browser tab becomes hidden (user switches tabs or minimizes window).

**Event Detail:**
```typescript
{
  timestamp: string;        // ISO timestamp when tab became hidden
  hiddenCount: number;      // Total number of times tab has been hidden
}
```

#### `tab:visible`
Dispatched when the browser tab becomes visible again.

**Event Detail:**
```typescript
{
  timestamp: string;              // ISO timestamp when tab became visible
  hiddenDuration: number;         // Duration tab was hidden (milliseconds)
  hiddenDurationSeconds: number;  // Duration tab was hidden (seconds)
}
```

## Use Cases

### Pause API Polling When Inactive
```tsx
function DataPollingComponent() {
  const { isInactive, isTabHidden } = useUserActivity();
  const shouldPoll = !isInactive && !isTabHidden;

  useEffect(() => {
    if (!shouldPoll) {
      console.log('Pausing polling - user inactive or tab hidden');
      return;
    }

    const interval = setInterval(() => {
      fetchLatestData();
    }, 5000);

    return () => clearInterval(interval);
  }, [shouldPoll]);

  return <div>Polling: {shouldPoll ? 'Active' : 'Paused'}</div>;
}
```

### Reduce Update Frequency When Tab Hidden
```tsx
function LiveUpdatesComponent() {
  const { isTabHidden } = useUserActivity();
  const updateInterval = isTabHidden ? 60000 : 5000; // 1 min vs 5 sec

  useEffect(() => {
    const interval = setInterval(() => {
      updateData();
    }, updateInterval);

    return () => clearInterval(interval);
  }, [updateInterval]);

  return <div>Updates every {updateInterval / 1000}s</div>;
}
```

### Pause Video/Audio When Inactive
```tsx
function MediaPlayerComponent() {
  const { isInactive, isTabHidden } = useUserActivity();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    if (isInactive || isTabHidden) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  }, [isInactive, isTabHidden]);

  return <video ref={videoRef} src="..." />;
}
```

### Show Warning Before Session Timeout
```tsx
function SessionWarningComponent() {
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    const handleInactive = () => {
      // Show warning that session will expire soon
      setShowWarning(true);
    };

    const handleActive = () => {
      setShowWarning(false);
    };

    window.addEventListener('user:inactive', handleInactive);
    window.addEventListener('user:active', handleActive);

    return () => {
      window.removeEventListener('user:inactive', handleInactive);
      window.removeEventListener('user:active', handleActive);
    };
  }, []);

  if (!showWarning) return null;

  return (
    <div className="alert alert-warning">
      You've been inactive. Your session will expire soon.
    </div>
  );
}
```

## Configuration

### InactivityMonitor Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `inactivityTimeout` | `number` | `300000` (5 min) | Time in milliseconds before user is considered inactive |
| `debug` | `boolean` | `false` | Show debug UI with current status |

### TabVisibilityMonitor Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `debug` | `boolean` | `false` | Show debug UI with current status |

## Example Component

See `ActivityListenerExample.tsx` for a complete working example demonstrating both approaches.
