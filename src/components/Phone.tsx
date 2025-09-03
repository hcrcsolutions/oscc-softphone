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
  const [callHistory, setCallHistory] = useState<Array<{number: string, time: string, type: 'outgoing' | 'incoming'}>>([]);
  const sipService = useRef<SipService>(new SipService());

  useEffect(() => {
    const service = sipService.current;
    
    service.setCallStateCallback((state: CallState) => {
      setCallState(state);
      
      // Add to call history when call ends
      if (state.status === 'idle' && state.remoteNumber) {
        const historyEntry = {
          number: state.remoteNumber,
          time: new Date().toLocaleTimeString(),
          type: 'outgoing' as const
        };
        setCallHistory(prev => [historyEntry, ...prev.slice(0, 9)]); // Keep last 10 calls
      }
    });

    service.setRegistrationStateCallback(setIsRegistered);

    // Load SIP configuration from localStorage
    const savedConfig = localStorage.getItem('sipConfig');
    if (savedConfig) {
      try {
        const config: SipConfig = JSON.parse(savedConfig);
        service.configure(config).catch(console.error);
      } catch (error) {
        console.error('Failed to load SIP configuration:', error);
      }
    }

    return () => {
      service.disconnect();
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

  const getStatusColor = () => {
    switch (callState.status) {
      case 'connected': return 'badge-success';
      case 'connecting': return 'badge-warning';
      case 'ringing': return 'badge-info';
      case 'failed': return 'badge-error';
      default: return 'badge-outline';
    }
  };

  const getStatusText = () => {
    switch (callState.status) {
      case 'idle': return isRegistered ? 'Ready' : 'Not Registered';
      case 'connecting': return 'Connecting...';
      case 'connected': return `Connected to ${callState.remoteNumber}`;
      case 'ringing': return `Incoming call from ${callState.remoteNumber}`;
      case 'failed': return 'Call Failed';
      default: return 'Unknown';
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold">Phone</h2>
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
                  className="btn btn-circle btn-outline w-20 h-20 text-2xl font-bold"
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
              className={`btn flex-1 w-full ${!isRegistered || !phoneNumber.trim() ? 'btn-disabled' : 'btn-success'}`}
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