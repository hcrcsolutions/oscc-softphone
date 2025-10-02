'use client';

import { useState, useEffect, useRef } from 'react';
import { TbPhone, TbPhoneOff, TbPhoneIncoming, TbPlayerPause, TbPlayerPlay, TbUsers, TbUserPlus, TbMicrophone, TbMicrophoneOff } from 'react-icons/tb';
import { SipService, CallState, SipConfig, CallInfo } from '@/services/sipService';
import ActiveCallManager from '@/components/ActiveCallManager';
import AudioDeviceSelector from '@/components/AudioDeviceSelector';
import { useTabStorage } from '@/utils/tabStorage';

interface PhoneProps {
  theme: string;
}

export default function Phone({ theme }: PhoneProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callState, setCallState] = useState<CallState>({ status: 'idle' });
  const [activeCalls, setActiveCalls] = useState<CallInfo[]>([]);
  const [isRegistered, setIsRegistered] = useState(false);
  const [callHistory, setCallHistory] = useState<Array<{ number: string, time: string, type: 'outgoing' | 'incoming' | 'failed', duration?: string }>>([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callDurations, setCallDurations] = useState<Map<string, number>>(new Map());
  const { getObject } = useTabStorage();
  const [isConferenceMode, setIsConferenceMode] = useState(false);
  const [isConferenceProcessing, setIsConferenceProcessing] = useState(false);
  const [extension, setExtension] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showErrorAlert, setShowErrorAlert] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const callStartTime = useRef<Date | null>(null);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const callTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const preInitializedMedia = useRef<MediaStream | null>(null);
  const sipService = useRef<SipService>(new SipService());

  useEffect(() => {
    const service = sipService.current;
    service.setCallStateCallback((state: CallState) => {
      console.log('Phone (SIP.js) - Call state changed:', state);
      setCallState(state);
      // Update active calls list
      setActiveCalls(service.getAllActiveCalls());
      // Update conference mode state
      setIsConferenceMode(service.isInConferenceMode());
      // Pre-initialize media for incoming calls to speed up answering
      if (state.status === 'ringing' && !preInitializedMedia.current) {
        console.log('Pre-initializing media for incoming call...');
        service.preInitializeMedia().then(stream => {
          preInitializedMedia.current = stream;
          console.log('Media pre-initialized for faster call answering');
        }).catch(error => {
          console.warn('Failed to pre-initialize media:', error);
        });
      }
      // Clean up pre-initialized media when call ends
      if (state.status === 'idle' && preInitializedMedia.current) {
        preInitializedMedia.current.getTracks().forEach(track => track.stop());
        preInitializedMedia.current = null;
        console.log('Cleaned up pre-initialized media');
      }
      
      // Auto-unmute when call ends (idle, disconnected, or failed states)
      if (state.status === 'idle' || state.status === 'disconnected' || state.status === 'failed') {
        // Check both UI state and service state to handle all cases
        const serviceIsMuted = sipService.current?.isMicMuted() || false;
        if (isMicMuted || serviceIsMuted) {
          console.log('Call ended while muted (UI or Service), automatically unmuting microphone');
          console.log(`  UI muted: ${isMicMuted}, Service muted: ${serviceIsMuted}`);
          
          // Always set UI to unmuted
          setIsMicMuted(false);
          
          // Unmute in service if needed
          if (sipService.current && serviceIsMuted) {
            sipService.current.unmuteMicrophone().then(() => {
              console.log('✅ Successfully unmuted microphone in service');
            }).catch((error) => {
              console.warn('Failed to unmute microphone in service:', error);
            });
          }
        }
      }
      
      // Sync UI state when call connects or is connecting
      if ((state.status === 'connected' || state.status === 'connecting') && sipService.current) {
        const serviceIsMuted = sipService.current.isMicMuted();
        if (serviceIsMuted !== isMicMuted) {
          console.log(`Syncing mute state on call ${state.status}: UI=${isMicMuted}, Service=${serviceIsMuted}`);
          setIsMicMuted(serviceIsMuted);
        }
      }
      // Handle per-call timers
      if (state.status === 'connected' && state.sessionId) {
        const sessionId = state.sessionId;
        // Start timer for this specific call if not already started
        if (!callTimers.current.has(sessionId)) {
          // Get the call info to use the actual connected time
          const callInfo = service.getCallInfo(sessionId);
          const connectedTime = callInfo?.connectedTime || new Date();
          const timer = setInterval(() => {
            const now = new Date();
            const elapsed = Math.floor((now.getTime() - connectedTime.getTime()) / 1000);
            setCallDurations(prev => new Map(prev.set(sessionId, elapsed)));
          }, 1000);
          callTimers.current.set(sessionId, timer);
          console.log('Timer started for call:', sessionId, 'connected at:', connectedTime);
        }
      }
      // Legacy single call timer (kept for backward compatibility)
      if (state.status === 'connected' && !callStartTime.current && state.sessionId) {
        // Use the actual connected time from CallInfo
        const callInfo = service.getCallInfo(state.sessionId);
        callStartTime.current = callInfo?.connectedTime || new Date();
        console.log('Legacy timer - Call started at:', callStartTime.current);
        // Start the timer
        timerInterval.current = setInterval(() => {
          if (callStartTime.current) {
            const now = new Date();
            const elapsed = Math.floor((now.getTime() - callStartTime.current.getTime()) / 1000);
            setCallDuration(elapsed);
          }
        }, 1000);
      }
      // Clean up per-call timer and add to call history when call ends
      if (state.status === 'idle' && state.remoteNumber) {
        console.log('Phone (SIP.js) - Adding call to history:', state.remoteNumber);
        let duration: string | undefined;
        // Clean up per-call timer if available
        if (state.sessionId && callTimers.current.has(state.sessionId)) {
          const timer = callTimers.current.get(state.sessionId);
          if (timer) {
            clearInterval(timer);
            callTimers.current.delete(state.sessionId);
          }
          // Calculate final duration directly from connectedTime instead of timer value
          const callInfo = service.getCallInfo(state.sessionId);
          if (callInfo?.connectedTime) {
            const endTime = new Date();
            const durationMs = endTime.getTime() - callInfo.connectedTime.getTime();
            const totalSeconds = Math.floor(durationMs / 1000);
            duration = formatElapsedTime(totalSeconds);
            console.log('Final duration calculated from connectedTime:', duration);
          }
          // Clean up duration tracking
          setCallDurations(prev => {
            const newMap = new Map(prev);
            newMap.delete(state.sessionId!);
            return newMap;
          });
        }
        // Fallback if no timer was running or no sessionId
        if (!duration) {
          if (state.sessionId) {
            // Try to get duration from CallInfo connectedTime
            const callInfo = service.getCallInfo(state.sessionId);
            if (callInfo?.connectedTime) {
              const endTime = new Date();
              const durationMs = endTime.getTime() - callInfo.connectedTime.getTime();
              const totalSeconds = Math.floor(durationMs / 1000);
              duration = formatElapsedTime(totalSeconds);
              console.log('Fallback: duration from connectedTime:', duration);
            }
          }
          // Ultimate fallback to legacy timer
          if (!duration && callStartTime.current) {
            const endTime = new Date();
            const durationMs = endTime.getTime() - callStartTime.current.getTime();
            const totalSeconds = Math.floor(durationMs / 1000);
            duration = formatElapsedTime(totalSeconds);
            console.log('Ultimate fallback: duration from legacy timer:', duration);
          }
          callStartTime.current = null;
        }
        const historyEntry = {
          number: state.remoteNumber,
          time: new Date().toLocaleTimeString(),
          type: (state.direction || 'outgoing') as 'outgoing' | 'incoming',
          duration
        };
        setCallHistory(prev => [historyEntry, ...prev.slice(0, 9)]); // Keep last 10 calls
      }
      // Reset call start time on failed calls
      if (state.status === 'failed') {
        callStartTime.current = null;
        if (timerInterval.current) {
          clearInterval(timerInterval.current);
          timerInterval.current = null;
        }
        setCallDuration(0);
        // Add failed call to history
        if (state.remoteNumber) {
          const historyEntry = {
            number: state.remoteNumber,
            time: new Date().toLocaleTimeString(),
            type: 'failed' as const,
            duration: undefined
          };
          setCallHistory(prev => [historyEntry, ...prev.slice(0, 9)]);
        }
        // Show error alert
        const errorMsg = state.errorMessage || 'Call failed. Please check your connection and try again.';
        showError(errorMsg);
      }
      // Clear timer when call ends normally
      if (state.status === 'idle') {
        if (timerInterval.current) {
          clearInterval(timerInterval.current);
          timerInterval.current = null;
        }
        setCallDuration(0);
      }
    });

    service.setRegistrationStateCallback(setIsRegistered);

    // Listen for conference state changes to maintain UI controls after REFER
    service.on('conferenceStateChanged', (data: any) => {
      console.log('📡 Phone: Conference state changed:', data);
      
      // Update active calls to reflect conference status
      const activeCalls = service.getAllActiveCalls();
      console.log('📡 Phone: Updated active calls:', activeCalls.map(c => ({ sessionId: c.sessionId, remoteNumber: c.remoteNumber, isInConference: c.isInConference })));
      setActiveCalls(activeCalls);
      
      // Update conference mode state
      const conferenceMode = service.isInConferenceMode();
      console.log('📡 Phone: Updated conference mode:', conferenceMode);
      setIsConferenceMode(conferenceMode);
      
      // Refresh participant list if in conference mode
      if (conferenceMode) {
        console.log('🔄 Phone: In conference mode, participant details should refresh automatically');
      }
    });
    
    // Listen for participant left events
    service.on('participantLeft', (data: any) => {
      console.log('🚪 Phone: Participant left conference:', data);
      
      // Show notification alert
      const message = data.message || `${data.displayText || 'A participant'} has left the conference`;
      showError(message);
      
      // Optionally, you could also update the UI to reflect the participant leaving
      setActiveCalls(service.getAllActiveCalls());
    });

    // Auto-connect to SIP on application load
    const autoConnect = async () => {
      const config = getObject<SipConfig>('sipConfig');
      if (config) {
        try {
          setExtension(config.username);
          console.log('Auto-connecting to SIP server...');
          // Initialize audio context early (requires user interaction in some browsers)
          service.enableAudio();
          // Configure and connect
          await service.configure(config);
          console.log('SIP auto-connection successful');
        } catch (error) {
          console.error('Failed to auto-connect to SIP:', error);
          showError('Failed to connect to phone system. Please check your settings.');
        }
      } else {
        console.log('No saved SIP configuration found');
      }
    };
    // Initiate auto-connection
    autoConnect();

    return () => {
      service.disconnect();
      // Clear timer on unmount
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
    };
  }, []);

  // Sync mute state with sipService
  useEffect(() => {
    const checkMuteState = () => {
      if (sipService.current) {
        const serviceIsMuted = sipService.current.isMicMuted();
        if (serviceIsMuted !== isMicMuted) {
          setIsMicMuted(serviceIsMuted);
        }
      }
    };

    // Check mute state periodically
    const interval = setInterval(checkMuteState, 1000);
    
    // Initial check
    checkMuteState();

    return () => clearInterval(interval);
  }, [isMicMuted]);

  const showError = (message: string) => {
    setErrorMessage(message);
    setShowErrorAlert(true);
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setShowErrorAlert(false);
    }, 5000);
  };

  const handleDigitClick = (digit: string | number) => {
    // Enable audio on first user interaction
    sipService.current.enableAudio();
    setPhoneNumber(prev => prev + digit);
  };

  const handleClearNumber = () => {
    setPhoneNumber('');
  };

  const handlePresenceChange = async (newStatus: 'available' | 'away' | 'unavailable', event?: React.MouseEvent) => {
    // Close dropdown if event is provided
    if (event) {
      const dropdown = event.currentTarget.closest('.dropdown') as HTMLElement;
      dropdown?.removeAttribute('open');
      (document.activeElement as HTMLElement)?.blur();
    }
    
    try {
      console.log(`Setting presence to ${newStatus}...`);
      let success = false;
      
      switch (newStatus) {
        case 'available':
          success = await sipService.current.setPresenceOnline();
          break;
        case 'away':
          success = await sipService.current.setPresenceAway();
          break;
        case 'unavailable':
          success = await sipService.current.setPresenceUnavailable();
          break;
      }
      
      if (success) {
        console.log(`✅ Presence set to ${newStatus}`);
      } else {
        setErrorMessage(`Failed to set presence to ${newStatus}`);
        setShowErrorAlert(true);
      }
    } catch (error) {
      console.error(`Failed to set presence to ${newStatus}:`, error);
      setErrorMessage('Failed to set presence status');
      setShowErrorAlert(true);
    }
  };

  const getPresenceDisplayInfo = (status: 'available' | 'away' | 'unavailable') => {
    switch (status) {
      case 'available':
        return {
          label: 'Available',
          description: 'Ready to receive calls',
          bubbleClass: 'bg-success',
          animate: true
        };
      case 'away':
        return {
          label: 'Away',
          description: 'Calls go to voicemail',
          bubbleClass: 'bg-warning',
          animate: false
        };
      case 'unavailable':
        return {
          label: 'Unavailable',
          description: 'Do not disturb',
          bubbleClass: 'bg-error',
          animate: false
        };
      default:
        return {
          label: 'Unknown',
          description: '',
          bubbleClass: 'bg-base-300',
          animate: false
        };
    }
  };

  const handleCall = async () => {
    if (!phoneNumber.trim()) return;
    // Enable audio on user interaction
    sipService.current.enableAudio();
    try {
      // Check if we're in a secure context (HTTPS)
      if (!window.isSecureContext) {
        showError('Microphone access requires a secure connection (HTTPS). Please access this application using HTTPS.');
        return;
      }
      // Check for microphone permissions first
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (permError: any) {
          console.error('Microphone permission error:', permError);
          if (permError.name === 'NotAllowedError' || permError.name === 'PermissionDeniedError') {
            showError('Microphone access denied. Please allow microphone access to make calls.');
            return;
          } else if (permError.name === 'NotFoundError') {
            showError('No microphone found. Please connect a microphone to make calls.');
            return;
          } else if (permError.name === 'TypeError' && !window.isSecureContext) {
            showError('Microphone access requires a secure connection (HTTPS). Please access this application using HTTPS.');
            return;
          } else {
            showError('Failed to access microphone. Please check your audio settings.');
            return;
          }
        }
      }
      await sipService.current.makeCall(phoneNumber);
    } catch (error: any) {
      console.error('Failed to make call:', error);
      const errorMsg = error.message || 'Failed to make call. Please try again.';
      showError(errorMsg);
    }
  };

  const handleHangup = async () => {
    try {
      // Get the session ID of the current call
      const currentCall = activeCalls.find(call => !call.isOnHold) || activeCalls[0];
      if (!currentCall) {
        showError('No active call to end.');
        return;
      }

      await sipService.current.endCall(currentCall.sessionId);
    } catch (error: any) {
      console.error('Failed to hangup:', error);
      showError('Failed to end call. Please try again.');
    }
  };

  const handleReject = async () => {
    try {
      await sipService.current.rejectCall();
    } catch (error: any) {
      console.error('Failed to reject call:', error);
      showError('Failed to reject call. Please try again.');
    }
  };

  const handleAnswer = async () => {
    // Prevent multiple clicks
    if (isAnswering) return;
    setIsAnswering(true);
    try {
      // Enable audio on user interaction
      sipService.current.enableAudio();
      // Check if we're in a secure context (HTTPS)
      if (!window.isSecureContext) {
        showError('Microphone access requires a secure connection (HTTPS). Please access this application using HTTPS.');
        return;
      }
      // Check for microphone permissions (skip if already pre-initialized)
      if (!preInitializedMedia.current && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Clean up this test stream since we only needed it for permission check
          stream.getTracks().forEach(track => track.stop());
        } catch (permError: any) {
          console.error('Microphone permission error:', permError);
          if (permError.name === 'NotAllowedError' || permError.name === 'PermissionDeniedError') {
            showError('Microphone access denied. Please allow microphone access to answer calls.');
            return;
          } else if (permError.name === 'NotFoundError') {
            showError('No microphone found. Please connect a microphone to answer calls.');
            return;
          } else if (permError.name === 'TypeError' && !window.isSecureContext) {
            showError('Microphone access requires a secure connection (HTTPS). Please access this application using HTTPS.');
            return;
          } else {
            showError('Failed to access microphone. Please check your audio settings.');
            return;
          }
        }
      }
      await sipService.current.answerCall();
    } catch (error: any) {
      console.error('Failed to answer call:', error);
      showError('Failed to answer call. Please try again.');
    } finally {
      setIsAnswering(false);
    }
  };

  const handleEndCall = async (sessionId?: string) => {
    try {
      await sipService.current.endCall(sessionId);
      console.log('Call ended successfully');
    } catch (error) {
      console.error('Failed to end call:', error);
      showError('Failed to end call. Please try again.');
    }
  };

  const handleSwitchToCall = async (sessionId: string) => {
    try {
      const switched = await sipService.current.switchToCall(sessionId);
      if (switched) {
        console.log('Switched to call:', sessionId);
      } else {
        console.warn('Failed to switch to call:', sessionId);
        showError('Failed to switch to call.');
      }
    } catch (error: any) {
      console.error('Failed to switch to call:', error);
      if (error.message && error.message.includes('Reinvite in progress')) {
        showError('Call switching in progress. Please wait a moment and try again.');
      } else {
        showError('Failed to switch to call. Please try again.');
      }
    }
  };

  const handleHold = async () => {
    try {
      // Get the session ID of the current call
      const currentCall = activeCalls.find(call => !call.isOnHold) || activeCalls[0];
      if (!currentCall) {
        showError('No active call to hold/resume.');
        return;
      }

      if (currentCall.isOnHold) {
        await sipService.current.unholdCallBySessionId(currentCall.sessionId);
      } else {
        await sipService.current.holdCallBySessionId(currentCall.sessionId);
      }
    } catch (error: any) {
      console.error('Failed to toggle hold:', error);
      showError('Failed to toggle hold. Please try again.');
    }
  };

  const handleMute = async () => {
    try {
      if (isMicMuted) {
        await sipService.current.unmuteMicrophone();
        setIsMicMuted(false);
      } else {
        await sipService.current.muteMicrophone();
        setIsMicMuted(true);
      }
    } catch (error: any) {
      console.error('Failed to toggle mute:', error);
      showError('Failed to toggle mute. Please try again.');
    }
  };

  const enableAudio = () => {
    // This function helps with browser autoplay policies
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContext.resume().then(() => {
      console.log('Audio context resumed');
      setAudioEnabled(true);
    });
    // Also try to play silence to enable audio
    const audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWT' +
      'AkPU6zk67RlHgU8k9j1wHkiBSh+zPPTgjQIHWu/8+OVTQoQUqvj67RkHwU9k9f1wHkiBSh+zPPTgzQIHmm98OScTgwOUqzl7bllHgQ8k9j1wHgiBCh+zPLTgzUIF2u+8OScTgwOUqzl7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTAkPU6zk67RlHgU8k9j1wHkiBSh+zPPTgjQIHWu/8+OVTQoQUqvj67RkHwU9k9f1wHkiBSh+zPPTgzQIHmm98OScTgwOU' +
      'qzl7bllHgQ8k9j1wHgiBCh+zPLTgzUIF2u+8OScTgwOUqzl7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTAkPU6zk67RlHgU8k9j1wHkiBSh+zPPTgjQIHWu/8+OVTQoQUqvj67RkHwU9k9f1wHkiBSh+zPPTgzQIHmm98OScTgwOUqzl7bllHgQ8k9j1wHgiBCh+zPLTgzUIF2u+8OScTgwOUqzl7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTAkPU6zk67RlHwU8k9j1wHkiBSh+zPPTgjQIHWu/8+OVTQoQUqvj67RkHwU9k9f1wHkiBSh+zPPTgzQIHmm98OScTgwOUqzl7bllHgQ8k9j1wHgiBCh+zPLTgzUIF2u+8OScTgwOUqzl7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTAkPU6zk67RkFAU8k9f0wHgiBCh+zPLTgzUIHWq+8+OWT';
    audio.play().catch(() => { });
  };

  const getStatusColor = () => {
    switch (callState.status) {
      case 'connected': return 'badge-success';
      case 'connecting': return 'badge-warning';
      case 'ringing': return 'badge-info';
      case 'failed': return 'badge-error';
      default: return 'badge-outline';
    }
  };

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getStatusText = () => {
    // Include presence status when idle
    if (callState.status === 'idle' && isRegistered) {
      const presence = callState.presenceStatus === 'away' ? ' (Away)' : 
                       callState.presenceStatus === 'unavailable' ? ' (Unavailable)' : '';
      return `Ready${presence}`;
    }
    
    switch (callState.status) {
      case 'idle': return 'Not Registered';
      case 'connecting': return 'Connecting...';
      case 'connected': {
        const timer = callDuration > 0 ? ` (${formatDuration(callDuration)})` : '';
        const holdStatus = callState.isOnHold ? ' - On Hold' : '';
        // Handle conference mode where remoteNumber might not be set yet
        const remoteName = callState.remoteNumber || 
          (isConferenceMode && callState.conferenceRoomId ? `Conference ${callState.conferenceRoomId}` : 'Unknown');
        return `Connected to ${remoteName}${timer}${holdStatus}`;
      }
      case 'ringing': return `Incoming call from ${callState.remoteNumber}`;
      case 'failed': return 'Call Failed';
      default: return 'Unknown';
    }
  };

  const formatElapsedTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Calculate if we're in an active call for AudioDeviceSelector
  const isInActiveCall = activeCalls.length > 0 && (callState.status === 'connected' || callState.status === 'connecting');

  return (
    <div className="p-8">
      {/* Error Alert */}
      {showErrorAlert && errorMessage && (
        <div className="alert alert-error mb-4 max-w-2xl mx-auto">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{errorMessage}</span>
          <button
            onClick={() => setShowErrorAlert(false)}
            className="btn btn-sm btn-ghost"
          >
            ✕
          </button>
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold">Phone{extension ? ` (${extension})` : ''}</h2>
          <div className="flex gap-2 items-center">
            {/* Presence control dropdown - only show when registered and not in a call */}
            {isRegistered && callState.status === 'idle' && (
              <div className="dropdown dropdown-end">
                <div tabIndex={0} role="button" className="btn btn-sm btn-ghost">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 ${getPresenceDisplayInfo(callState.presenceStatus || 'available').bubbleClass} rounded-full ${getPresenceDisplayInfo(callState.presenceStatus || 'available').animate ? 'animate-pulse' : ''}`}></div>
                    <span>{getPresenceDisplayInfo(callState.presenceStatus || 'available').label}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-[1] w-56 p-2 shadow border border-base-300">
                  <li>
                    <button 
                      onClick={(e) => handlePresenceChange('available', e)}
                      className={`${callState.presenceStatus === 'available' ? 'active' : ''}`}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="w-2 h-2 bg-success rounded-full animate-pulse flex-shrink-0"></div>
                        <div className="flex-1 text-left">
                          <div className="font-medium">Available</div>
                          <div className="text-xs opacity-60 whitespace-nowrap">Ready to receive calls</div>
                        </div>
                      </div>
                    </button>
                  </li>
                  <li>
                    <button 
                      onClick={(e) => handlePresenceChange('away', e)}
                      className={`${callState.presenceStatus === 'away' ? 'active' : ''}`}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="w-2 h-2 bg-warning rounded-full flex-shrink-0"></div>
                        <div className="flex-1 text-left">
                          <div className="font-medium">Away</div>
                          <div className="text-xs opacity-60 whitespace-nowrap">Calls go to voicemail</div>
                        </div>
                      </div>
                    </button>
                  </li>
                  <li>
                    <button 
                      onClick={(e) => handlePresenceChange('unavailable', e)}
                      className={`${callState.presenceStatus === 'unavailable' ? 'active' : ''}`}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="w-2 h-2 bg-error rounded-full flex-shrink-0"></div>
                        <div className="flex-1 text-left">
                          <div className="font-medium">Unavailable</div>
                          <div className="text-xs opacity-60 whitespace-nowrap">Do not disturb</div>
                        </div>
                      </div>
                    </button>
                  </li>
                </ul>
              </div>
            )}
            <div className={`badge ${getStatusColor()}`}>
              {getStatusText()}
            </div>
            <div className="badge badge-outline">
              Theme: {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
            </div>
          </div>
        </div>
        
        {/* Main content area with side-by-side layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: Active Call Management and Audio Devices */}
          <div className="space-y-4">
            <ActiveCallManager 
              sipService={sipService.current} 
              isConferenceMode={isConferenceMode}
              conferenceRoomId={sipService.current.getConferenceRoomId()}
              activeCalls={activeCalls}
              callDurations={callDurations}
              onAnswerCall={handleAnswer}
              onEndCall={handleEndCall}
              onSwitchToCall={handleSwitchToCall}
              formatElapsedTime={formatElapsedTime}
            />
            
            {/* Audio Device Selector */}
            <AudioDeviceSelector
              sipService={sipService.current}
              isMicrophoneMuted={isMicMuted}
              isInActiveCall={isInActiveCall}
              onMicrophoneChange={(deviceId) => {
                console.log('Microphone changed to:', deviceId);
              }}
              onSpeakerChange={(deviceId) => {
                console.log('Speaker changed to:', deviceId);
              }}
            />
          </div>
          
          {/* Right column: Dialer */}
          <div>
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title mb-4 text-center">Dialer</h3>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    placeholder="Enter phone number"
                    className="input input-bordered flex-1"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && isRegistered && phoneNumber.trim() !== '') {
                        handleCall();
                      }
                    }}
                  />
                  <button
                    onClick={handleClearNumber}
                    className="btn btn-outline"
                  >
                    Clear
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4 justify-items-center">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, '*', 0, '#'].map((digit) => (
                    <button
                      key={digit}
                      className="btn btn-circle btn-outline rounded-full text-6xl font-bold"
                      style={{ width: '4rem', height: '4rem', fontSize: '2rem', borderRadius: '9999px' }}
                      onClick={() => handleDigitClick(digit)}
                    >
                      {digit}
                    </button>
                  ))}
                </div>
                {/* Always show the call button for making new calls */}
                <button
                  onClick={handleCall}
                  disabled={!isRegistered || phoneNumber.trim() === ''}
                  className="btn btn-primary w-full mb-4"
                >
                  <TbPhone className="w-5 h-5" />
                  Call {phoneNumber}
                </button>

                {/* Call state specific controls */}
                {callState.status === 'ringing' && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleAnswer}
                      className="btn btn-success flex-1"
                      disabled={isAnswering}
                    >
                      <TbPhoneIncoming className="w-5 h-5" />
                      {isAnswering ? 'Connecting...' : 'Answer'}
                    </button>
                    <button
                      onClick={handleReject}
                      className="btn btn-error flex-1"
                    >
                      <TbPhoneOff className="w-5 h-5" />
                      Decline
                    </button>
                  </div>
                )}

                {(callState.status === 'connected' || callState.status === 'connecting') && activeCalls.length > 0 && (
                  <div className="flex gap-2">
                    {callState.status === 'connected' && activeCalls.length === 1 && (
                      <button
                        onClick={handleHold}
                        className={`btn flex-1 ${callState.isOnHold ? 'btn-success' : 'btn-info'}`}
                      >
                        {callState.isOnHold ? (
                          <>
                            <TbPlayerPlay className="w-5 h-5" />
                            Resume
                          </>
                        ) : (
                          <>
                            <TbPlayerPause className="w-5 h-5" />
                            Hold
                          </>
                        )}
                      </button>
                    )}
                    {callState.status === 'connected' && (
                      <button
                        onClick={handleMute}
                        className={`btn flex-1 ${isMicMuted ? 'btn-warning' : 'btn-secondary'}`}
                      >
                        {isMicMuted ? (
                          <>
                            <TbMicrophoneOff className="w-5 h-5" />
                            Unmute
                          </>
                        ) : (
                          <>
                            <TbMicrophone className="w-5 h-5" />
                            Mute
                          </>
                        )}
                      </button>
                    )}
                    {activeCalls.length === 1 && (
                      <button
                        onClick={handleHangup}
                        className={`btn btn-error ${callState.status === 'connected' ? 'flex-1' : 'w-full'}`}
                      >
                        <TbPhoneOff className="w-5 h-5" />
                        Hang Up
                      </button>
                    )}
                  </div>
                )}
                {activeCalls.length > 1 && (
                  <div className="text-center text-sm opacity-70 mt-2">
                    Use individual controls above to manage multiple calls
                  </div>
                )}

                {callState.status === 'idle' && (
                  <div className="text-center text-sm opacity-70 mt-2">
                    Ready to make calls
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Call History - full width below the grid */}
        <div className="card bg-base-100 shadow-xl mt-6">
          <div className="card-body">
            <h3 className="card-title">Call History</h3>
            <div className="divider"></div>
            {callHistory.length > 0 ? (
              <div className="space-y-2">
                {callHistory.map((call, index) => (
                  <div key={index} className="flex justify-between items-center p-2 bg-base-200 rounded">
                    <span className="font-medium">{call.number}</span>
                    <div className="text-sm text-base-content/60">
                      <span className={`badge badge-xs ${call.type === 'outgoing' ? 'badge-success' : call.type === 'incoming' ? 'badge-info' : 'badge-error'} mr-2`}>
                        {call.type}
                      </span>
                      {call.time}
                      {call.duration && <span className="ml-2 text-xs">({call.duration})</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-base-content/60 py-8">
                No call history available
              </div>
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
}
