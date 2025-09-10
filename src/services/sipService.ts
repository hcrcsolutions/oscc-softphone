import { 
  UserAgent, 
  Registerer, 
  Inviter, 
  SessionState, 
  UserAgentOptions,
  URI
} from 'sip.js';

export interface SipConfig {
  server: string;
  username: string;
  password: string;
  domain?: string;
  protocol: 'ws' | 'wss';
}

export interface CallState {
  status: 'idle' | 'connecting' | 'connected' | 'ringing' | 'disconnected' | 'failed';
  remoteNumber?: string;
  duration?: number;
  direction?: 'incoming' | 'outgoing';
  errorMessage?: string;
  errorCode?: string;
  isOnHold?: boolean;
  sessionId?: string;
  activeCalls?: CallInfo[];
}

export interface CallInfo {
  sessionId: string;
  remoteNumber: string;
  isOnHold: boolean;
  direction: 'incoming' | 'outgoing';
  startTime?: Date;
}

export class SipService {
  private userAgent?: UserAgent;
  private registerer?: Registerer;
  private sessions: Map<string, any> = new Map(); // sessionId -> session
  private callInfos: Map<string, CallInfo> = new Map(); // sessionId -> call info
  private activeSessionId?: string; // Currently active session
  private config?: SipConfig;
  private onCallStateChanged?: (state: CallState) => void;
  private onRegistrationStateChanged?: (registered: boolean) => void;
  private sessionAudioElements: Map<string, HTMLAudioElement> = new Map(); // Per-session audio elements
  private dialToneAudio?: HTMLAudioElement;
  private ringtoneAudio?: HTMLAudioElement;
  private audioContext?: AudioContext;
  private ringbackOscillators: OscillatorNode[] = [];
  private ringbackInterval?: NodeJS.Timeout;
  private ringtoneInterval?: NodeJS.Timeout;

  setCallStateCallback(callback: (state: CallState) => void) {
    this.onCallStateChanged = callback;
  }

  setRegistrationStateCallback(callback: (registered: boolean) => void) {
    this.onRegistrationStateChanged = callback;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getActiveSession(): any {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  private getActiveCallInfo(): CallInfo | undefined {
    return this.activeSessionId ? this.callInfos.get(this.activeSessionId) : undefined;
  }


  private getCallInfosArray(): CallInfo[] {
    return Array.from(this.callInfos.values());
  }

  private updateCallState(sessionId?: string, status?: CallState['status']) {
    const activeCalls = this.getCallInfosArray();
    
    if (activeCalls.length === 0) {
      this.onCallStateChanged?.({ 
        status: 'idle',
        activeCalls: []
      });
      return;
    }

    // If no specific session, use active session or first available
    const targetSessionId = sessionId || this.activeSessionId || activeCalls[0].sessionId;
    const callInfo = this.callInfos.get(targetSessionId);
    const session = this.sessions.get(targetSessionId);

    if (!callInfo || !session) return;

    // Use provided status or determine from session state
    let finalStatus: CallState['status'] = status || 'connected';
    if (!status) {
      if (session.state === SessionState.Initial || session.state === SessionState.Establishing) {
        finalStatus = 'connecting';
      } else if (session.state === SessionState.Terminated) {
        finalStatus = 'idle';
      }
    }

    this.onCallStateChanged?.({
      status: finalStatus,
      remoteNumber: callInfo.remoteNumber,
      direction: callInfo.direction,
      isOnHold: callInfo.isOnHold,
      sessionId: targetSessionId,
      activeCalls
    });
  }

  private createAudioElementForSession(sessionId: string): HTMLAudioElement {
    if (this.sessionAudioElements.has(sessionId)) {
      return this.sessionAudioElements.get(sessionId)!;
    }

    const audio = new Audio();
    audio.autoplay = true;
    audio.controls = false;
    audio.muted = false;
    audio.volume = 1.0;

    // Add event listeners for debugging
    audio.addEventListener('loadstart', () => console.log(`Audio (${sessionId}): loadstart`));
    audio.addEventListener('loadeddata', () => console.log(`Audio (${sessionId}): loadeddata`));
    audio.addEventListener('canplay', () => console.log(`Audio (${sessionId}): canplay`));
    audio.addEventListener('playing', () => console.log(`Audio (${sessionId}): playing`));
    audio.addEventListener('error', (e) => console.error(`Audio error (${sessionId}):`, e));

    document.body.appendChild(audio);
    this.sessionAudioElements.set(sessionId, audio);
    
    return audio;
  }

  private cleanupAudioForSession(sessionId: string) {
    const audio = this.sessionAudioElements.get(sessionId);
    if (audio) {
      audio.srcObject = null;
      audio.pause();
      if (audio.parentNode) {
        audio.parentNode.removeChild(audio);
      }
      this.sessionAudioElements.delete(sessionId);
      console.log(`Audio cleanup completed for session: ${sessionId}`);
    }
  }

  async configure(config: SipConfig): Promise<void> {
    this.config = config;
    await this.disconnect();
    await this.connect();
  }


  private setupAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  private generateRingbackTone() {
    try {
      this.setupAudioContext();
      if (!this.audioContext) return;

      // Stop any existing ringback tone
      this.stopRingbackTone();

      // Create ringback tone pattern (350Hz + 440Hz, 2s on, 4s off)
      const playRingback = () => {
        if (!this.audioContext) return;
        
        const oscillator1 = this.audioContext.createOscillator();
        const oscillator2 = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        // Outgoing ringback: 350Hz + 440Hz (lower pitch, different from incoming)
        oscillator1.frequency.setValueAtTime(350, this.audioContext.currentTime);
        oscillator2.frequency.setValueAtTime(440, this.audioContext.currentTime);
        
        gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime); // Moderate volume

        oscillator1.connect(gainNode);
        oscillator2.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator1.start();
        oscillator2.start();

        // Store oscillators for this ring cycle
        this.ringbackOscillators.push(oscillator1, oscillator2);

        // Stop after 2 seconds
        setTimeout(() => {
          try {
            oscillator1.stop();
            oscillator2.stop();
            // Remove from array
            const index1 = this.ringbackOscillators.indexOf(oscillator1);
            const index2 = this.ringbackOscillators.indexOf(oscillator2);
            if (index1 > -1) this.ringbackOscillators.splice(index1, 1);
            if (index2 > -1) this.ringbackOscillators.splice(index2, 1);
          } catch (error) {
            // Already stopped
          }
        }, 2000);
      };

      // Play initial ringback
      playRingback();

      // Set up interval for repeated ringback (every 6 seconds: 2s ring + 4s silence)
      this.ringbackInterval = setInterval(playRingback, 6000);

      console.log('Ringback tone started');
    } catch (error) {
      console.error('Failed to generate ringback tone:', error);
    }
  }

  private stopRingbackTone() {
    if (this.ringbackInterval) {
      clearInterval(this.ringbackInterval);
      this.ringbackInterval = undefined;
    }
    if (this.ringbackOscillators.length > 0) {
      this.ringbackOscillators.forEach(oscillator => {
        try {
          oscillator.stop();
          oscillator.disconnect();
        } catch (error) {
          // Oscillator might already be stopped
        }
      });
      this.ringbackOscillators = [];
      console.log('Ringback tone stopped');
    }
  }

  private generateRingtone() {
    try {
      this.setupAudioContext();
      if (!this.audioContext) return;

      // Stop any existing ringtone
      this.stopRingtone();

      // Create ringtone pattern (440Hz + 480Hz, 2s on, 4s off)
      const playRing = () => {
        if (!this.audioContext) return;
        
        const oscillator1 = this.audioContext.createOscillator();
        const oscillator2 = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        // Incoming ringtone: 440Hz + 480Hz (traditional phone ring)
        oscillator1.frequency.setValueAtTime(440, this.audioContext.currentTime);
        oscillator2.frequency.setValueAtTime(480, this.audioContext.currentTime);
        
        gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime); // Moderate volume

        oscillator1.connect(gainNode);
        oscillator2.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator1.start();
        oscillator2.start();

        // Stop after 2 seconds
        setTimeout(() => {
          try {
            oscillator1.stop();
            oscillator2.stop();
          } catch (error) {
            // Already stopped
          }
        }, 2000);
      };

      // Play initial ring
      playRing();

      // Set up interval for repeated ringing (every 6 seconds: 2s ring + 4s silence)
      this.ringtoneInterval = setInterval(playRing, 6000);

      console.log('Ringtone started');
    } catch (error) {
      console.error('Failed to generate ringtone:', error);
    }
  }

  private stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = undefined;
    }
  }

  private setupAudioStreams(session: any, sessionId: string) {
    try {
      console.log('Setting up audio streams for session:', sessionId);
      
      // Create audio element for this specific session
      const remoteAudio = this.createAudioElementForSession(sessionId);
      
      // Get the session description handler
      const pc = session.sessionDescriptionHandler?.peerConnection;
      
      if (!pc) {
        console.warn('No peer connection available yet');
        return;
      }
      
      console.log('Found peer connection, setting up ontrack handler');
      
      // Set up ontrack event handler for incoming media
      pc.ontrack = (event: RTCTrackEvent) => {
        console.log(`Track received for session ${sessionId}:`, event.track.kind, 'streams:', event.streams.length);
        
        if (event.track.kind === 'audio') {
          let remoteStream: MediaStream;
          
          if (event.streams && event.streams.length > 0) {
            remoteStream = event.streams[0];
            console.log('Using provided stream');
          } else {
            remoteStream = new MediaStream([event.track]);
            console.log('Creating new stream from track');
          }
          
          console.log(`Setting remote stream to audio element for session ${sessionId}`);
          remoteAudio.srcObject = remoteStream;
          
          // Ensure volume is up
          remoteAudio.volume = 1.0;
          remoteAudio.muted = false;
          
          // Try to play
          remoteAudio.play().then(() => {
            console.log(`✓ Remote audio playback started successfully for session ${sessionId}`);
          }).catch((error) => {
            console.error(`Failed to start audio playback for session ${sessionId}:`, error);
            // On error, we might need user interaction
            console.log('Audio may require user interaction to start');
            
            // Try to inform about audio issues
            const activeSession = this.getActiveSession();
            if (this.onCallStateChanged && activeSession?.state === SessionState.Established) {
              // Don't fail the call, but log the audio issue
              console.warn('Audio playback requires user interaction. User may need to click to enable audio.');
            }
          });
        }
      };
      
      // Also check if there are already tracks available
      const receivers = pc.getReceivers();
      console.log('Checking existing receivers:', receivers.length);
      
      receivers.forEach((receiver: RTCRtpReceiver) => {
        if (receiver.track && receiver.track.kind === 'audio') {
          console.log(`Found existing audio track for session ${sessionId}, setting up stream`);
          const remoteStream = new MediaStream([receiver.track]);
          remoteAudio.srcObject = remoteStream;
          remoteAudio.volume = 1.0;
          remoteAudio.muted = false;
          
          remoteAudio.play().then(() => {
            console.log(`✓ Remote audio playback started from existing track for session ${sessionId}`);
          }).catch((error) => {
            console.error(`Failed to start audio from existing track for session ${sessionId}:`, error);
            console.warn('Audio playback requires user interaction. User may need to click to enable audio.');
          });
        }
      });
      
    } catch (error) {
      console.error('Failed to setup audio streams:', error);
    }
  }

  private cleanupAllAudioStreams() {
    // Clean up all session audio elements
    for (const sessionId of this.sessionAudioElements.keys()) {
      this.cleanupAudioForSession(sessionId);
    }
  }

  private muteAllInactiveCalls() {
    // Mute all calls except the active one
    for (const [sessionId, audio] of this.sessionAudioElements.entries()) {
      const callInfo = this.callInfos.get(sessionId);
      if (callInfo) {
        // Mute if: not active session OR call is on hold
        const shouldMute = sessionId !== this.activeSessionId || callInfo.isOnHold;
        audio.muted = shouldMute;
        console.log(`Audio ${shouldMute ? 'muted' : 'unmuted'} for session ${sessionId} (active: ${sessionId === this.activeSessionId}, onHold: ${callInfo.isOnHold})`);
      }
    }
  }

  private setAudioForSession(sessionId: string, muted: boolean) {
    const audio = this.sessionAudioElements.get(sessionId);
    if (audio) {
      audio.muted = muted;
      console.log(`Audio ${muted ? 'muted' : 'unmuted'} for session ${sessionId}`);
    }
  }

  private async connect(): Promise<void> {
    if (!this.config) {
      const error = new Error('SIP configuration not set');
      this.onCallStateChanged?.({ 
        status: 'failed', 
        errorMessage: 'Phone system not configured. Please check your settings.',
        errorCode: 'CONFIG_MISSING'
      });
      throw error;
    }

    try {
      // Ensure remote audio is set up
      
      const domain = this.config.domain || this.config.server;
      
      const port = this.config.protocol === 'wss' ? '7443' : '5066';
      const serverUrl = `${this.config.protocol}://${this.config.server}:${port}`;
      
      const userAgentOptions: UserAgentOptions = {
        uri: new URI('sip', this.config.username, domain),
        transportOptions: {
          server: serverUrl,
          traceSip: true,
          hackViaTcp: true,
          reconnectionAttempts: 2
        },
        authorizationUsername: this.config.username,
        authorizationPassword: this.config.password,
        logLevel: 'debug' as any,
        sessionDescriptionHandlerFactoryOptions: {
          constraints: {
            audio: true,
            video: false
          },
          peerConnectionOptions: {
            rtcConfiguration: {
              iceServers: [],
              iceCandidatePoolSize: 0, // Reduce ICE gathering time
              bundlePolicy: 'max-bundle',
              rtcpMuxPolicy: 'require'
            }
          }
        }
      };

      this.userAgent = new UserAgent(userAgentOptions);

      this.userAgent.delegate = {
        onInvite: (invitation) => {
          this.handleIncomingCall(invitation);
        }
      };

      // Enable SIP message tracing after UserAgent is started
      await this.userAgent.start();
      
      // Add SIP message tracing
      if (this.userAgent.transport) {
        const transport = this.userAgent.transport;
        const originalSend = transport.send;
        const originalOnMessage = transport.onMessage;
        
        // Trace outgoing messages
        transport.send = function(message) {
          console.log('🔴 SIP.js SENT:', message);
          return originalSend.call(this, message);
        };
        
        // Trace incoming messages  
        transport.onMessage = function(message) {
          console.log('🔵 SIP.js RECEIVED:', message);
          if (originalOnMessage) {
            return originalOnMessage.call(this, message);
          }
        };
      }

      this.registerer = new Registerer(this.userAgent);
      
      this.registerer.stateChange.addListener((state) => {
        const isRegistered = state === 'Registered';
        this.onRegistrationStateChanged?.(isRegistered);
        console.log('Registration state:', state);
      });

      await this.registerer.register();
    } catch (error: any) {
      console.error('Failed to connect to SIP server:', error);
      this.onRegistrationStateChanged?.(false);
      
      let errorMessage = 'Failed to connect to phone system.';
      let errorCode = 'CONNECTION_FAILED';
      
      if (error.message?.includes('WebSocket')) {
        errorMessage = 'Cannot connect to phone server. Please check your network connection.';
        errorCode = 'WEBSOCKET_ERROR';
      } else if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        errorMessage = 'Invalid phone credentials. Please check your username and password.';
        errorCode = 'AUTH_FAILED';
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'Connection timeout. The phone server may be unavailable.';
        errorCode = 'TIMEOUT';
      }
      
      this.onCallStateChanged?.({ 
        status: 'failed', 
        errorMessage,
        errorCode
      });
      
      throw error;
    }
  }

  private handleIncomingCall(invitation: any) {
    const sessionId = this.generateSessionId();
    const remoteUser = invitation.remoteIdentity?.uri?.user || 'Unknown';
    
    // Store session and call info
    this.sessions.set(sessionId, invitation);
    this.callInfos.set(sessionId, {
      sessionId,
      remoteNumber: remoteUser,
      isOnHold: false,
      direction: 'incoming',
      startTime: new Date()
    });
    
    // Set as active session
    this.activeSessionId = sessionId;
    
    // Start ringtone for incoming call
    this.generateRingtone();
    
    this.updateCallState(sessionId, 'ringing');

    invitation.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Established:
          this.stopRingbackTone(); // Stop ringback tone if any
          this.stopRingtone(); // Stop ringtone when call is answered
          this.setupAudioStreams(invitation, sessionId);
          // Manage audio: mute all other calls, unmute this one
          this.muteAllInactiveCalls();
          this.updateCallState(sessionId, 'connected');
          break;
        case SessionState.Terminated:
          this.cleanupAudioForSession(sessionId);
          
          // Send terminated callback with call info before cleanup
          const callInfo = this.callInfos.get(sessionId);
          if (callInfo) {
            this.onCallStateChanged?.({
              status: 'idle',
              remoteNumber: callInfo.remoteNumber,
              direction: callInfo.direction,
              sessionId: sessionId,
              activeCalls: this.getCallInfosArray().filter(c => c.sessionId !== sessionId)
            });
          }
          
          this.sessions.delete(sessionId);
          this.callInfos.delete(sessionId);
          if (this.activeSessionId === sessionId) {
            this.activeSessionId = undefined;
          }
          
          // Send updated state for remaining calls
          this.updateCallState();
          break;
      }
    });
  }

  // Multi-call management methods
  switchToCall(sessionId: string): boolean {
    if (this.sessions.has(sessionId) && this.callInfos.has(sessionId)) {
      this.activeSessionId = sessionId;
      const callInfo = this.callInfos.get(sessionId)!;
      
      // Manage audio: mute all calls except the new active one
      this.muteAllInactiveCalls();
      
      this.updateCallState(sessionId, 'connected');
      return true;
    }
    return false;
  }

  getAllActiveCalls(): CallInfo[] {
    return Array.from(this.callInfos.values());
  }

  getCallInfo(sessionId: string): CallInfo | undefined {
    return this.callInfos.get(sessionId);
  }

  async endCall(sessionId?: string): Promise<void> {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) return;
    
    const session = this.sessions.get(targetSessionId);
    if (session) {
      try {
        await session.bye();
      } catch (error) {
        console.warn('Error ending call:', error);
      }
      
      // Cleanup will be handled by the session state listener
    }
  }

  async makeCall(number: string): Promise<void> {
    if (!this.userAgent || !this.config) {
      const errorMessage = 'Phone system not ready. Please wait for registration to complete.';
      this.onCallStateChanged?.({ 
        status: 'failed', 
        errorMessage,
        errorCode: 'NOT_REGISTERED'
      });
      throw new Error(errorMessage);
    }

    try {
      const domain = this.config.domain || this.config.server;
      const target = new URI('sip', number, domain);
      const sessionId = this.generateSessionId();
      
      const session = new Inviter(this.userAgent, target);
      
      // Store session and call info
      this.sessions.set(sessionId, session);
      this.callInfos.set(sessionId, {
        sessionId,
        remoteNumber: number,
        isOnHold: false,
        direction: 'outgoing',
        startTime: new Date()
      });

      // Set as active session
      this.activeSessionId = sessionId;

      // Start ringback tone for outgoing call
      this.generateRingbackTone();

      // Update UI with connecting state
      this.updateCallState(sessionId);
      
      session.stateChange.addListener((state: SessionState) => {
        switch (state) {
          case SessionState.Establishing:
            this.updateCallState(sessionId, 'connecting');
            break;
          case SessionState.Established:
            this.stopRingbackTone(); // Stop ringback tone when call is connected
            this.setupAudioStreams(session, sessionId);
            // Manage audio: mute all other calls, unmute this one
            this.muteAllInactiveCalls();
            this.updateCallState(sessionId, 'connected');
            break;
          case SessionState.Terminated:
            this.stopRingbackTone(); // Stop any audio feedback
            this.stopRingtone();
            this.cleanupAudioForSession(sessionId);
            
            // Send terminated callback with call info before cleanup
            const callInfo = this.callInfos.get(sessionId);
            if (callInfo) {
              this.onCallStateChanged?.({
                status: 'idle',
                remoteNumber: callInfo.remoteNumber,
                direction: callInfo.direction,
                sessionId: sessionId,
                activeCalls: this.getCallInfosArray().filter(c => c.sessionId !== sessionId)
              });
            }
            
            this.sessions.delete(sessionId);
            this.callInfos.delete(sessionId);
            if (this.activeSessionId === sessionId) {
              this.activeSessionId = undefined;
            }
            
            // Send updated state for remaining calls
            this.updateCallState();
            break;
        }
      });

      await session.invite();
    } catch (error: any) {
      let errorMessage = 'Failed to make call.';
      let errorCode = 'CALL_FAILED';
      
      if (error.message?.includes('486') || error.message?.includes('Busy')) {
        errorMessage = 'The number is busy. Please try again later.';
        errorCode = 'BUSY';
      } else if (error.message?.includes('404') || error.message?.includes('Not Found')) {
        errorMessage = 'Invalid number or extension not found.';
        errorCode = 'NOT_FOUND';
      } else if (error.message?.includes('503') || error.message?.includes('Service Unavailable')) {
        errorMessage = 'Phone service temporarily unavailable. Please try again later.';
        errorCode = 'SERVICE_UNAVAILABLE';
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'Call timeout. The number may be unreachable.';
        errorCode = 'TIMEOUT';
      } else if (error.message?.includes('insecure context') || error.message?.includes('Media devices not available')) {
        errorMessage = 'Microphone access requires a secure connection (HTTPS). Please access this application using HTTPS.';
        errorCode = 'INSECURE_CONTEXT';
      } else if (error.message?.includes('media') || error.message?.includes('getUserMedia')) {
        errorMessage = 'Microphone access denied or not available.';
        errorCode = 'MEDIA_ERROR';
      }
      
      this.onCallStateChanged?.({ 
        status: 'failed', 
        remoteNumber: number,
        errorMessage,
        errorCode
      });
      console.error('Failed to make call:', error);
      throw new Error(errorMessage);
    }
  }

  async answerCall(): Promise<void> {
    const activeSession = this.getActiveSession();
    if (activeSession && activeSession.accept) {
      try {
        // Stop any audio feedback when answering
        this.stopRingbackTone();
        this.stopRingtone();
        
        // Try immediate accept first, only wait if it fails
        try {
          await activeSession.accept();
          return; // Success, exit early
        } catch (immediateError: any) {
          if (!immediateError.message?.includes('Invalid session state')) {
            throw immediateError; // If it's not a state error, rethrow
          }
          console.log('Immediate accept failed due to state, will wait and retry...');
        }
        
        // If immediate accept failed due to state, wait a bit
        if (activeSession.state === SessionState.Establishing) {
          console.log('Session is establishing, waiting briefly...');
          
          // Much shorter wait with linear progression
          let attempts = 0;
          const maxAttempts = 3; // Further reduced
          
          while (activeSession.state === SessionState.Establishing && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 30 + (attempts * 20))); // 30ms, 50ms, 70ms
            attempts++;
            console.log(`Attempt ${attempts}: Session state is ${activeSession.state}`);
            
            // Check if session was terminated while waiting
            if (activeSession.state === SessionState.Terminated) {
              throw new Error('Call was terminated before it could be answered');
            }
            
            // Try accepting after each wait
            try {
              await activeSession.accept();
              return; // Success, exit
            } catch (retryError: any) {
              if (attempts === maxAttempts || !retryError.message?.includes('Invalid session state')) {
                throw retryError;
              }
              console.log(`Retry ${attempts} failed, continuing...`);
            }
          }
        }
        
        // Final attempt
        await activeSession.accept();
      } catch (error: any) {
        console.error('Failed to answer call:', error);
        
        let errorMessage = 'Failed to answer call.';
        let errorCode = 'ANSWER_FAILED';
        
        if (error.message?.includes('Timeout waiting')) {
          errorMessage = 'Call answer timed out. Please try again.';
          errorCode = 'ANSWER_TIMEOUT';
        } else if (error.message?.includes('terminated before')) {
          errorMessage = 'Call was cancelled before it could be answered.';
          errorCode = 'CALL_CANCELLED';
        } else if (error.message?.includes('Invalid session state')) {
          errorMessage = 'Cannot answer call in current state. Please try again.';
          errorCode = 'INVALID_STATE';
        } else if (error.message?.includes('media') || error.message?.includes('getUserMedia')) {
          errorMessage = 'Microphone access denied or not available.';
          errorCode = 'MEDIA_ERROR';
        }
        
        const activeCallInfo = this.getActiveCallInfo();
        this.onCallStateChanged?.({ 
          status: 'failed',
          remoteNumber: activeCallInfo?.remoteNumber,
          errorMessage,
          errorCode
        });
        
        throw new Error(errorMessage);
      }
    }
  }

  async hangup(): Promise<void> {
    const activeSession = this.getActiveSession();
    if (activeSession) {
      try {
        switch (activeSession.state) {
          case SessionState.Initial:
          case SessionState.Establishing:
            if (activeSession.cancel) {
              await activeSession.cancel();
            }
            break;
          case SessionState.Established:
            if (activeSession.bye) {
              await activeSession.bye();
            }
            break;
          default:
            if (activeSession.terminate) {
              await activeSession.terminate();
            }
            break;
        }
      } catch (error: any) {
        console.error('Failed to hangup:', error);
        // Don't throw here, just log - hangup should always succeed from user perspective
      }
    }
  }

  async holdCall(): Promise<void> {
    const activeSession = this.getActiveSession();
    const activeCallInfo = this.getActiveCallInfo();
    
    if (activeSession && activeSession.state === SessionState.Established && activeCallInfo) {
      try {
        if (!activeCallInfo.isOnHold) {
          // Mute the microphone to simulate hold
          const pc = activeSession.sessionDescriptionHandler?.peerConnection;
          if (pc) {
            const senders = pc.getSenders();
            senders.forEach((sender: RTCRtpSender) => {
              if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = false;
              }
            });
          }
          
          // Update call info
          activeCallInfo.isOnHold = true;
          this.callInfos.set(activeCallInfo.sessionId, activeCallInfo);
          
          // Mute the audio for this held call
          this.setAudioForSession(activeCallInfo.sessionId, true);
          
          console.log('Call placed on hold');
        }
      } catch (error: any) {
        console.error('Failed to hold call:', error);
        throw new Error('Failed to place call on hold');
      }
    } else {
      throw new Error('No active call to hold');
    }
  }

  async unholdCall(): Promise<void> {
    const activeSession = this.getActiveSession();
    const activeCallInfo = this.getActiveCallInfo();
    
    if (activeSession && activeSession.state === SessionState.Established && activeCallInfo) {
      try {
        if (activeCallInfo.isOnHold) {
          // Unmute the microphone to resume call
          const pc = activeSession.sessionDescriptionHandler?.peerConnection;
          if (pc) {
            const senders = pc.getSenders();
            senders.forEach((sender: RTCRtpSender) => {
              if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = true;
              }
            });
          }
          
          // Update call info
          activeCallInfo.isOnHold = false;
          this.callInfos.set(activeCallInfo.sessionId, activeCallInfo);
          
          // Manage audio: unmute this call and mute all others
          this.muteAllInactiveCalls();
          
          console.log('Call resumed from hold');
        }
      } catch (error: any) {
        console.error('Failed to unhold call:', error);
        throw new Error('Failed to resume call from hold');
      }
    } else {
      throw new Error('No active call to unhold');
    }
  }

  async disconnect(): Promise<void> {
    try {
      const activeSession = this.getActiveSession();
      if (activeSession) {
        await this.hangup();
      }
      if (this.registerer) {
        await this.registerer.unregister();
      }
      if (this.userAgent) {
        await this.userAgent.stop();
      }
      
      // Cleanup all audio
      this.stopRingbackTone();
      this.stopRingtone();
      this.cleanupAllAudioStreams();
      
      // Close audio context
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = undefined;
      }
    } catch (error) {
      console.error('Failed to disconnect:', error);
    } finally {
      this.userAgent = undefined;
      this.registerer = undefined;
      
      // Clear all sessions and call info
      this.sessions.clear();
      this.callInfos.clear();
      this.activeSessionId = undefined;
    }
  }

  isRegistered(): boolean {
    return this.registerer?.state === 'Registered';
  }

  getCurrentCallState(): CallState {
    const activeSession = this.getActiveSession();
    const activeCallInfo = this.getActiveCallInfo();
    
    if (!activeSession || !activeCallInfo) {
      return { status: 'idle' };
    }
    
    switch (activeSession.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        return { 
          status: 'connecting',
          remoteNumber: activeCallInfo.remoteNumber,
          direction: activeCallInfo.direction
        };
      case SessionState.Established:
        return { 
          status: 'connected',
          remoteNumber: activeCallInfo.remoteNumber,
          direction: activeCallInfo.direction,
          isOnHold: activeCallInfo.isOnHold
        };
      default:
        return { status: 'idle' };
    }
  }
}