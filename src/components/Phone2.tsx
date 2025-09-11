'use client';

import { useState, useEffect, useRef } from 'react';
import { TbPhone, TbPhoneOff, TbPhoneIncoming, TbPlayerPause, TbPlayerPlay, TbUsers, TbUserPlus } from 'react-icons/tb';
import { SipML5Service, CallState, SipML5Config, CallInfo } from '@/services/sipml5Service';

interface Phone2Props {
  theme: string;
}

export default function Phone2({ theme }: Phone2Props) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callState, setCallState] = useState<CallState>({ status: 'idle' });
  const [activeCalls, setActiveCalls] = useState<CallInfo[]>([]);
  const [isRegistered, setIsRegistered] = useState(false);
  const [callHistory, setCallHistory] = useState<Array<{number: string, time: string, type: 'outgoing' | 'incoming' | 'failed', duration?: string}>>([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [callDurations, setCallDurations] = useState<Map<string, number>>(new Map());
  const [isConferenceMode, setIsConferenceMode] = useState(false);
  const [extension, setExtension] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showErrorAlert, setShowErrorAlert] = useState(false);
  const callStartTime = useRef<Date | null>(null);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const callTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const sipService = useRef<SipML5Service>(new SipML5Service());

  useEffect(() => {
    const service = sipService.current;
    
    service.setCallStateCallback((state: CallState) => {
      console.log('Phone2 (SipML5) - Call state changed:', state);
      setCallState(state);
      
      // Update active calls list
      setActiveCalls(service.getAllActiveCalls());
      
      // Update conference mode state
      setIsConferenceMode(service.isInConferenceMode());
      
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
          console.log('SipML5 Timer started for call:', sessionId, 'connected at:', connectedTime);
        }
      }
      
      // Legacy single call timer (kept for backward compatibility)
      if (state.status === 'connected' && !callStartTime.current && state.sessionId) {
        // Use the actual connected time from CallInfo
        const callInfo = service.getCallInfo(state.sessionId);
        callStartTime.current = callInfo?.connectedTime || new Date();
        console.log('SipML5 Legacy timer - Call started at:', callStartTime.current);
        
        // Start the timer
        timerInterval.current = setInterval(() => {
          if (callStartTime.current) {
            const now = new Date();
            const elapsed = Math.floor((now.getTime() - callStartTime.current.getTime()) / 1000);
            setCallDuration(elapsed);
          }
        }, 1000);
      }
      
      // Handle failed calls
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
      
      // Clean up per-call timer and add to call history when call ends
      if (state.status === 'idle' && state.remoteNumber) {
        console.log('Phone2 (SipML5) - Adding call to history:', state.remoteNumber);
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
            console.log('SipML5 Final duration calculated from connectedTime:', duration);
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
              console.log('SipML5 Fallback: duration from connectedTime:', duration);
            }
          }
          
          // Ultimate fallback to legacy timer
          if (!duration && callStartTime.current) {
            const endTime = new Date();
            const durationMs = endTime.getTime() - callStartTime.current.getTime();
            const totalSeconds = Math.floor(durationMs / 1000);
            duration = formatElapsedTime(totalSeconds);
            console.log('SipML5 Ultimate fallback: duration from legacy timer:', duration);
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

    // Load SIP configuration from localStorage
    const initializeSipML5 = async () => {
      try {
        setIsLoading(true);
        
        const savedConfig = localStorage.getItem('sipConfig');
        if (savedConfig) {
          const config: SipML5Config = JSON.parse(savedConfig);
          console.log('Phone2: Loading saved config for SipML5:', { ...config, password: config.password ? '***' : 'EMPTY' });
          setExtension(config.username);
          
          // Only configure if we have a password
          if (config.password && config.password.trim() !== '') {
            console.log('Phone2: Auto-connecting to SIP server via SipML5...');
            
            // Initialize audio context early
            service.enableAudio();
            
            await service.configure(config);
            console.log('Phone2: SipML5 auto-connection successful');
          } else {
            console.warn('Phone2: No password configured for SipML5, skipping connection');
          }
        } else {
          console.log('Phone2: No saved SIP configuration found for SipML5');
        }
      } catch (error) {
        console.error('Failed to load SipML5 configuration:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeSipML5();

    return () => {
      service.disconnect();
      // Clear timer on unmount
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
    };
  }, []);

  const handleDigitClick = (digit: string | number) => {
    // Enable audio on first user interaction
    sipService.current.enableAudio();
    setPhoneNumber(prev => prev + digit);
  };

  const handleClearNumber = () => {
    setPhoneNumber('');
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    setShowErrorAlert(true);
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setShowErrorAlert(false);
    }, 5000);
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
    audio.play().catch(() => {});
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
    if (isLoading) return 'Loading SipML5...';
    
    switch (callState.status) {
      case 'idle': return isRegistered ? 'Ready (SipML5)' : 'Not Registered (SipML5)';
      case 'connecting': return 'Connecting...';
      case 'connected': {
        const timer = callDuration > 0 ? ` (${formatDuration(callDuration)})` : '';
        const holdStatus = callState.isOnHold ? ' - On Hold' : '';
        return `Connected to ${callState.remoteNumber}${timer}${holdStatus}`;
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
      
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold">Phone (SipML5){extension ? ` - ${extension}` : ''}</h2>
        <div className="flex gap-2">
          <div className={`badge ${getStatusColor()}`}>
            {getStatusText()}
          </div>
          <div className="badge badge-outline">
            Theme: {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
          </div>
        </div>
      </div>
      
      {/* Multi-call management panel */}
      {activeCalls.length > 0 && (
        <div className="card bg-base-100 shadow-xl max-w-2xl mx-auto mb-6">
          <div className="card-body">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="card-title">Active Calls ({activeCalls.length})</h3>
                {isConferenceMode && (
                  <div className="text-sm text-info mt-1">
                    Conference Mode • {sipService.current.getConferenceSize()} participants
                  </div>
                )}
              </div>
              {activeCalls.length > 1 && (
                <button
                  onClick={() => {
                    if (isConferenceMode) {
                      sipService.current.disableConferenceMode();
                    } else {
                      sipService.current.enableConferenceMode();
                    }
                  }}
                  className={`btn btn-sm ${isConferenceMode ? 'btn-warning' : 'btn-success'}`}
                  title={isConferenceMode ? 'Exit Conference (keep incoming call, disconnect outgoing calls)' : 'Start Conference'}
                >
                  {isConferenceMode ? 'Exit Conference' : 'Conference All'}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {activeCalls.map((call) => {
                const elapsedTime = callDurations.get(call.sessionId) || 0;
                const isInConference = sipService.current.isInConference(call.sessionId);
                return (
                  <div key={call.sessionId} className="flex items-center justify-between p-3 bg-base-200 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${call.isOnHold ? 'bg-warning' : 'bg-success'}`}></div>
                      <div>
                        <div className="font-semibold">{call.remoteNumber}</div>
                        <div className="text-sm opacity-70">
                          {call.direction === 'incoming' ? 'Incoming' : 'Outgoing'} • {call.isOnHold ? 'On Hold' : 'Active'}
                          {isInConference && <span className="ml-2 badge badge-sm badge-info">Conference</span>}
                          {elapsedTime > 0 && <span className="ml-2 font-mono">({formatElapsedTime(elapsedTime)})</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {/* Accept call control - only show for ringing incoming calls */}
                      {call.status === 'ringing' && call.direction === 'incoming' && (
                        <button
                          onClick={handleAnswer}
                          className="btn btn-sm btn-success"
                          title="Answer call"
                        >
                          <TbPhoneIncoming className="w-4 h-4" />
                        </button>
                      )}
                      
                      {/* Conference participation controls */}
                      {isConferenceMode && activeCalls.length > 1 && (
                        isInConference ? (
                          <button
                            onClick={() => sipService.current.removeFromConference(call.sessionId)}
                            className="btn btn-sm btn-outline btn-warning"
                            title="Remove from conference"
                          >
                            <TbUsers className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => sipService.current.addToConference(call.sessionId)}
                            className="btn btn-sm btn-outline btn-info"
                            title={call.isOnHold ? "Add to conference (will resume call)" : "Add to conference"}
                          >
                            <TbUserPlus className="w-4 h-4" />
                          </button>
                        )
                      )}
                      
                      {/* Hold/Resume controls - only show when call is connected */}
                      {call.status === 'connected' && (
                        call.isOnHold ? (
                          <button
                            onClick={() => sipService.current.unholdCallBySessionId(call.sessionId)}
                            className="btn btn-sm btn-success"
                            title="Resume call"
                          >
                            <TbPlayerPlay className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => sipService.current.holdCallBySessionId(call.sessionId)}
                            className="btn btn-sm btn-info"
                            title="Hold call"
                          >
                            <TbPlayerPause className="w-4 h-4" />
                          </button>
                        )
                      )}
                      
                      {/* End call control */}
                      <button
                        onClick={() => sipService.current.endCall(call.sessionId)}
                        className="btn btn-sm btn-error"
                        title="End call"
                      >
                        <TbPhoneOff className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      
        <div className="card bg-base-100 shadow-xl max-w-md mx-auto">
          <div className="card-body">
            <h3 className="card-title mb-4 text-center">Dialer</h3>
            
            {isLoading ? (
              <div className="flex justify-center items-center py-8">
                <div className="loading loading-spinner loading-md"></div>
                <span className="ml-2">Loading SipML5...</span>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    placeholder="Enter phone number" 
                    className="input input-bordered flex-1"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
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
                    >
                      <TbPhoneIncoming className="w-5 h-5" />
                      Answer
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

                {(callState.status === 'connected' || callState.status === 'connecting') && activeCalls.length === 1 && (
                  <div className="flex gap-2">
                    {callState.status === 'connected' && (
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
                    <button 
                      onClick={handleHangup}
                      className={`btn btn-error ${callState.status === 'connected' ? 'flex-1' : 'w-full'}`}
                    >
                      <TbPhoneOff className="w-5 h-5" />
                      Hang Up
                    </button>
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
              </>
            )}
          </div>
        </div>
        
        <div className="card bg-base-100 shadow-xl mt-6">
          <div className="card-body">
            <h3 className="card-title">Call History</h3>
            <div className="badge badge-secondary badge-sm mb-2">Using SipML5 Library</div>
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