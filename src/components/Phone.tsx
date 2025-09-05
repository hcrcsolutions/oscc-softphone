'use client';

import { useState, useEffect, useRef } from 'react';
import { TbPhone, TbPhoneOff, TbPhoneIncoming } from 'react-icons/tb';
import { SipService, CallState, SipConfig } from '@/services/sipService';

interface PhoneProps {
  theme: string;
}

export default function Phone({ theme }: PhoneProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callState, setCallState] = useState<CallState>({ status: 'idle' });
  const [isRegistered, setIsRegistered] = useState(false);
  const [callHistory, setCallHistory] = useState<Array<{number: string, time: string, type: 'outgoing' | 'incoming', duration?: string}>>([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [extension, setExtension] = useState<string>('');
  const callStartTime = useRef<Date | null>(null);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const sipService = useRef<SipService>(new SipService());

  useEffect(() => {
    const service = sipService.current;
    
    service.setCallStateCallback((state: CallState) => {
      console.log('Phone (SIP.js) - Call state changed:', state);
      setCallState(state);
      
      // Track call start time when connected
      if (state.status === 'connected' && !callStartTime.current) {
        callStartTime.current = new Date();
        console.log('Call started at:', callStartTime.current);
        
        // Start the timer
        timerInterval.current = setInterval(() => {
          if (callStartTime.current) {
            const now = new Date();
            const elapsed = Math.floor((now.getTime() - callStartTime.current.getTime()) / 1000);
            setCallDuration(elapsed);
          }
        }, 1000);
      }
      
      // Add to call history when call ends
      if (state.status === 'idle' && state.remoteNumber) {
        console.log('Phone (SIP.js) - Adding call to history:', state.remoteNumber);
        let duration: string | undefined;
        if (callStartTime.current) {
          const endTime = new Date();
          const durationMs = endTime.getTime() - callStartTime.current.getTime();
          const seconds = Math.floor(durationMs / 1000);
          const minutes = Math.floor(seconds / 60);
          const remainingSeconds = seconds % 60;
          duration = minutes > 0 ? `${minutes}:${remainingSeconds.toString().padStart(2, '0')}` : `${seconds}s`;
          console.log('Call ended, duration:', duration);
          callStartTime.current = null;
        } else {
          console.log('No call start time recorded');
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
    const savedConfig = localStorage.getItem('sipConfig');
    if (savedConfig) {
      try {
        const config: SipConfig = JSON.parse(savedConfig);
        setExtension(config.username);
        service.configure(config).catch(console.error);
      } catch (error) {
        console.error('Failed to load SIP configuration:', error);
      }
    }

    return () => {
      service.disconnect();
      // Clear timer on unmount
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
    };
  }, []);

  const handleDigitClick = (digit: string | number) => {
    setPhoneNumber(prev => prev + digit);
  };

  const handleClearNumber = () => {
    setPhoneNumber('');
  };

  const handleCall = async () => {
    if (!phoneNumber.trim()) return;
    
    try {
      await sipService.current.makeCall(phoneNumber);
    } catch (error) {
      console.error('Failed to make call:', error);
    }
  };

  const handleHangup = async () => {
    try {
      await sipService.current.hangup();
    } catch (error) {
      console.error('Failed to hangup:', error);
    }
  };

  const handleAnswer = async () => {
    try {
      await sipService.current.answerCall();
    } catch (error) {
      console.error('Failed to answer call:', error);
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
    switch (callState.status) {
      case 'idle': return isRegistered ? 'Ready (SIP.js)' : 'Not Registered (SIP.js)';
      case 'connecting': return 'Connecting...';
      case 'connected': {
        const timer = callDuration > 0 ? ` (${formatDuration(callDuration)})` : '';
        return `Connected to ${callState.remoteNumber}${timer}`;
      }
      case 'ringing': return `Incoming call from ${callState.remoteNumber}`;
      case 'failed': return 'Call Failed';
      default: return 'Unknown';
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold">Phone{extension ? ` (${extension})` : ''}</h2>
        <div className="flex gap-2">
          <div className={`badge ${getStatusColor()}`}>
            {getStatusText()}
          </div>
          <div className="badge badge-outline">
            Theme: {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
          </div>
        </div>
      </div>
      
        <div className="card bg-base-100 shadow-xl max-w-md mx-auto">
          <div className="card-body">
            <h3 className="card-title mb-4 text-center">Dialer</h3>
          
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
                  className="btn btn-circle btn-outline text-6xl font-bold"
                  style={{ width: '4rem', height: '4rem', fontSize: '2rem' }}
                  onClick={() => handleDigitClick(digit)}
                >
                  {digit}
                </button>
              ))}
          </div>
          
          {callState.status === 'ringing' ? (
            <div className="flex gap-2">
              <button 
                onClick={handleAnswer}
                className="btn btn-success flex-1"
              >
                <TbPhoneIncoming className="w-5 h-5" />
                Answer
              </button>
              <button 
                onClick={handleHangup}
                className="btn btn-error flex-1"
              >
                <TbPhoneOff className="w-5 h-5" />
                Decline
              </button>
            </div>
          ) : callState.status === 'connected' || callState.status === 'connecting' ? (
            <button 
              onClick={handleHangup}
              className="btn btn-error w-full"
            >
              <TbPhoneOff className="w-5 h-5" />
              Hang Up
            </button>
          ) : (
            <button 
              onClick={handleCall}
              className={`btn w-full ${!isRegistered || !phoneNumber.trim() ? 'btn-disabled' : 'btn-success'}`}
              disabled={!isRegistered || !phoneNumber.trim()}
            >
              <TbPhone className="w-5 h-5" />
              Call
            </button>
          )}
          </div>
        </div>
        
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
                    <span className={`badge badge-xs ${call.type === 'outgoing' ? 'badge-success' : 'badge-info'} mr-2`}>
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