'use client';

import { useState, useEffect, useCallback } from 'react';
import { TbMicrophone, TbMicrophoneOff, TbPlayerPause, TbPlayerPlay, TbUserMinus, TbPhone, TbUsers, TbPhoneIncoming, TbPhoneOff } from 'react-icons/tb';
import { SipService, CallInfo } from '@/services/sipService';

interface ActiveCallManagerProps {
  sipService: SipService | null;
  isConferenceMode: boolean;
  conferenceRoomId?: string;
  activeCalls: CallInfo[];
  callDurations: Map<string, number>;
  onAnswerCall: () => Promise<void>;
  onEndCall: (sessionId?: string) => Promise<void>;
  onSwitchToCall: (sessionId: string) => void;
  formatElapsedTime: (elapsed: number) => string;
}

interface ConferenceParticipant {
  sessionId: string;
  remoteNumber: string;
  direction: 'incoming' | 'outgoing';
  isMuted: boolean;
  isOnHold: boolean;
}

export default function ActiveCallManager({ 
  sipService, 
  isConferenceMode, 
  conferenceRoomId, 
  activeCalls, 
  callDurations, 
  onAnswerCall, 
  onEndCall, 
  onSwitchToCall,
  formatElapsedTime 
}: ActiveCallManagerProps) {
  const [participants, setParticipants] = useState<ConferenceParticipant[]>([]);
  const [mutedParticipants, setMutedParticipants] = useState<Set<string>>(new Set());
  const [isConferenceProcessing, setIsConferenceProcessing] = useState(false);

  const updateParticipants = useCallback(() => {
    if (sipService && isConferenceMode) {
      console.log('🔄 ActiveCallManager: Updating conference participants...');
      const participantDetails = sipService.getConferenceParticipantDetails();
      setParticipants(participantDetails);
    } else {
      // Clear participants when not in conference mode
      if (participants.length > 0) {
        console.log('🔄 ActiveCallManager: Clearing participants (not in conference)');
        setParticipants([]);
      }
    }
  }, [sipService, isConferenceMode, conferenceRoomId, participants.length]);

  useEffect(() => {
    // Only log when state actually changes, not on every render
    if (isConferenceMode) {
      console.log('ActiveCallManager: Conference mode enabled', { 
        conferenceRoomId,
        activeCallsCount: activeCalls.length
      });
    }
    
    if (sipService && isConferenceMode) {
      updateParticipants();
      // Update participants every 2 seconds while in conference
      const interval = setInterval(updateParticipants, 2000);
      return () => {
        console.log('🔄 ActiveCallManager: Stopping conference participant polling');
        clearInterval(interval);
      };
    } else {
      // Clear participants when not in conference
      updateParticipants();
    }
  }, [sipService, isConferenceMode, conferenceRoomId, activeCalls, updateParticipants]);

  const handleMuteParticipant = async (sessionId: string) => {
    if (!sipService) return;

    try {
      const success = await sipService.muteConferenceParticipant(sessionId);
      if (success) {
        setMutedParticipants(prev => new Set(prev).add(sessionId));
        updateParticipants();
      }
    } catch (error) {
      console.error('Failed to mute participant:', error);
    }
  };

  const handleUnmuteParticipant = async (sessionId: string) => {
    if (!sipService) return;

    try {
      const success = await sipService.unmuteConferenceParticipant(sessionId);
      if (success) {
        setMutedParticipants(prev => {
          const newSet = new Set(prev);
          newSet.delete(sessionId);
          return newSet;
        });
        updateParticipants();
      }
    } catch (error) {
      console.error('Failed to unmute participant:', error);
    }
  };

  const handleHoldParticipant = async (sessionId: string) => {
    if (!sipService) return;

    try {
      await sipService.holdCallBySessionId(sessionId);
      updateParticipants();
    } catch (error) {
      console.error('Failed to hold participant:', error);
    }
  };

  const handleUnholdParticipant = async (sessionId: string) => {
    if (!sipService) return;

    try {
      await sipService.unholdCallBySessionId(sessionId);
      updateParticipants();
    } catch (error) {
      console.error('Failed to unhold participant:', error);
    }
  };

  const handleKickParticipant = async (sessionId: string) => {
    if (!sipService) return;

    try {
      const success = await sipService.kickConferenceParticipant(sessionId);
      if (success) {
        updateParticipants();
      }
    } catch (error) {
      console.error('Failed to kick participant:', error);
    }
  };

  const handleEndCall = async (sessionId: string) => {
    if (!sipService) return;

    try {
      await sipService.endCall(sessionId);
      updateParticipants();
    } catch (error) {
      console.error('Failed to end call:', error);
    }
  };

  // Show nothing if no active calls and not in conference mode
  if (!isConferenceMode && activeCalls.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Active Calls / Conference Participants */}
      <div className={`card shadow-xl ${isConferenceMode ? 'bg-success/10 border border-success/20' : 'bg-base-100'}`}>
        <div className="card-body p-4">
          <div className="flex items-center gap-3 mb-4">
            {isConferenceMode ? (
              <>
                <TbUsers className="w-6 h-6 text-success" />
                <div>
                  <h3 className="card-title text-lg text-success">
                    Manage Participants ({participants.length})
                  </h3>
                  <div className="text-sm opacity-70">
                    Conference Room {conferenceRoomId}
                  </div>
                </div>
              </>
            ) : (
              <>
                <TbPhone className="w-6 h-6 text-primary" />
                <h3 className="card-title text-lg">
                  Active Calls ({activeCalls.length})
                </h3>
              </>
            )}
          </div>

        <div className="space-y-3">
          {isConferenceMode ? (
            // Conference mode: Show participants
            participants.map(participant => {
              const isMuted = mutedParticipants.has(participant.sessionId);
              
              return (
                <div key={participant.sessionId} className="flex items-center justify-between p-3 bg-base-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      participant.isOnHold ? 'bg-warning' : 'bg-success'
                    }`}></div>
                    
                    <div className="flex items-center gap-2">
                      {isMuted && <TbMicrophoneOff className="w-4 h-4 text-error" />}
                      <div>
                        <div className="font-semibold">{participant.remoteNumber}</div>
                        <div className="text-sm opacity-70 flex items-center gap-1">
                          <span className={`badge badge-xs ${
                            participant.direction === 'incoming' ? 'badge-info' : 'badge-warning'
                          }`}>
                            {participant.direction}
                          </span>
                          {participant.isOnHold && (
                            <span className="text-warning">On Hold</span>
                          )}
                          {isMuted && (
                            <span className="text-error">Muted</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-1">
                    {/* Conference-specific controls */}
                    <button
                      onClick={() => isMuted ? handleUnmuteParticipant(participant.sessionId) : handleMuteParticipant(participant.sessionId)}
                      className={`btn btn-sm ${isMuted ? 'btn-success' : 'btn-warning'}`}
                      title={isMuted ? 'Unmute participant' : 'Mute participant'}
                    >
                      {isMuted ? <TbMicrophone className="w-4 h-4" /> : <TbMicrophoneOff className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => participant.isOnHold ? handleUnholdParticipant(participant.sessionId) : handleHoldParticipant(participant.sessionId)}
                      className={`btn btn-sm ${participant.isOnHold ? 'btn-info' : 'btn-secondary'}`}
                      title={participant.isOnHold ? 'Resume participant' : 'Hold participant'}
                    >
                      {participant.isOnHold ? <TbPlayerPlay className="w-4 h-4" /> : <TbPlayerPause className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => handleKickParticipant(participant.sessionId)}
                      className="btn btn-sm btn-outline btn-error"
                      title="Remove from conference"
                    >
                      <TbUserMinus className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleEndCall(participant.sessionId)}
                      className="btn btn-sm btn-error"
                      title="Hang up call"
                    >
                      <TbPhone className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            // Individual calls mode: Show active calls
            activeCalls.map((call) => {
              const elapsedTime = callDurations.get(call.sessionId) || 0;
              const isInConference = sipService?.isInConference(call.sessionId);
              const isActiveCall = sipService?.getActiveSessionId() === call.sessionId;
              
              return (
                <div key={call.sessionId} className="flex items-center justify-between p-3 bg-base-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      call.status === 'ringing' ? 'bg-warning animate-pulse' :
                      call.status === 'connecting' ? 'bg-warning animate-pulse' :
                      call.isOnHold ? 'bg-warning' : 'bg-success'
                    }`}></div>
                    
                    <div>
                      <div className="font-semibold">{call.remoteNumber}</div>
                      <div className="text-sm opacity-70">
                        {call.direction === 'incoming' ? 'Incoming' : 'Outgoing'} • {
                          call.isOnHold ? 'On Hold' : 
                          call.status === 'ringing' ? 'Ringing' : 
                          call.status === 'connecting' ? 'Connecting' : 
                          'Active'
                        }
                        {isInConference && <span className="ml-2 badge badge-sm badge-info">Conference</span>}
                        {elapsedTime > 0 && <span className="ml-2 font-mono">({formatElapsedTime(elapsedTime)})</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-1">
                    {/* Answer button for incoming calls */}
                    {call.status === 'ringing' && call.direction === 'incoming' && (
                      <button
                        onClick={onAnswerCall}
                        className="btn btn-sm btn-success"
                        title="Answer call"
                      >
                        <TbPhoneIncoming className="w-4 h-4" />
                      </button>
                    )}
                    
                    {/* Switch to call button - only show for non-active calls when there are multiple calls */}
                    {call.status === 'connected' && activeCalls.length > 1 && !isActiveCall && (
                      <button
                        onClick={() => onSwitchToCall(call.sessionId)}
                        className="btn btn-sm btn-primary"
                        title="Switch to this call"
                      >
                        <TbPhone className="w-4 h-4" />
                      </button>
                    )}

                    {/* Hold/Resume controls */}
                    {call.status === 'connected' && (
                      call.isOnHold ? (
                        <button
                          onClick={() => sipService?.unholdCallBySessionId(call.sessionId)}
                          className="btn btn-sm btn-info"
                          title="Resume call"
                        >
                          <TbPlayerPlay className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => sipService?.holdCallBySessionId(call.sessionId)}
                          className="btn btn-sm btn-secondary"
                          title="Hold call"
                        >
                          <TbPlayerPause className="w-4 h-4" />
                        </button>
                      )
                    )}

                    {/* End call button */}
                    <button
                      onClick={() => onEndCall(call.sessionId)}
                      className="btn btn-sm btn-error"
                      title="End call"
                    >
                      <TbPhoneOff className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-between items-start mt-4">
          <div className="text-xs text-base-content/60 space-y-1">
            {isConferenceMode ? (
              <>
                <p>• Use mute/unmute to control individual participant audio</p>
                <p>• Hold places participant on FreeSWITCH hold music</p>
                <p>• Remove disconnects participant from conference</p>
                <p>• Hang up ends the individual call entirely</p>
              </>
            ) : (
              <>
                <p>• Answer incoming calls with the green button</p>
                <p>• Switch between calls to manage multiple conversations</p>
                <p>• Hold calls to place them on hold music</p>
                <p>• End calls to disconnect completely</p>
              </>
            )}
          </div>
          
          {/* Conference controls or multi-call actions */}
          <div className="flex gap-2">
            {isConferenceMode ? (
              <>
                {/* Subscribe to Conference Events button */}
                <button
                  onClick={async () => {
                    if (!sipService) return;
                    
                    try {
                      console.log('📺 Manual conference subscription requested from UI');
                      await sipService.subscribeToConferenceEventsManually();
                    } catch (error) {
                      console.error('Failed to subscribe to conference events:', error);
                    }
                  }}
                  className="btn btn-sm btn-info"
                  title="Subscribe to conference event notifications"
                >
                  🔔 Subscribe Events
                </button>
                
                {/* End Conference button */}
                <button
                  onClick={async () => {
                    if (!sipService || isConferenceProcessing) return;
                    
                    try {
                      setIsConferenceProcessing(true);
                      await sipService.disableConferenceMode();
                    } catch (error) {
                      console.error('Failed to end conference:', error);
                    } finally {
                      setIsConferenceProcessing(false);
                    }
                  }}
                  disabled={isConferenceProcessing}
                  className={`btn btn-sm btn-error ${isConferenceProcessing ? 'loading' : ''}`}
                  title={isConferenceProcessing ? 'Ending conference...' : 'End conference for all participants'}
                >
                  {isConferenceProcessing ? 'Ending...' : '🔚 End Conference'}
                </button>
              </>
            ) : (
              // Conference All button for multiple calls
              activeCalls.length > 1 && (
                <button
                  onClick={async () => {
                    if (isConferenceProcessing) return; // Prevent double-click
                    
                    try {
                      setIsConferenceProcessing(true);
                      await sipService?.enableConferenceMode();
                    } catch (error) {
                      console.error('Conference operation failed:', error);
                    } finally {
                      setIsConferenceProcessing(false);
                    }
                  }}
                  disabled={isConferenceProcessing}
                  className={`btn btn-sm btn-success ${isConferenceProcessing ? 'loading' : ''}`}
                  title={isConferenceProcessing ? 'Starting conference...' : 'Start Conference with all active calls'}
                >
                  {isConferenceProcessing ? 'Starting...' : '🎯 Conference All'}
                </button>
              )
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}