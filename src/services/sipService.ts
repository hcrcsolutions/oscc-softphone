import {
  UserAgent,
  Registerer,
  Inviter,
  SessionState,
  UserAgentOptions,
  URI,
  Session
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
  status: 'connecting' | 'ringing' | 'connected';
  startTime?: Date;
  connectedTime?: Date;
}

export class SipService {
  private userAgent?: UserAgent;
  private registerer?: Registerer;
  private sessions: Map<string, any> = new Map(); // sessionId -> session
  private callInfos: Map<string, CallInfo> = new Map(); // sessionId -> call info
  private activeSessionId?: string; // Currently active session
  private isConferenceMode: boolean = false; // Whether multiple calls are in conference
  private conferenceParticipants: Set<string> = new Set(); // Session IDs in conference
  private conferenceMixer?: GainNode; // Audio mixer for conference
  private conferenceRoomId?: string; // FreeSWITCH conference room ID
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

    // Update the CallInfo status to match
    if (finalStatus === 'connecting') {
      callInfo.status = 'connecting';
    } else if (finalStatus === 'connected') {
      callInfo.status = 'connected';
      // Set connected time when call first becomes connected
      if (!callInfo.connectedTime) {
        callInfo.connectedTime = new Date();
        console.log('Call connected at:', callInfo.connectedTime, 'for session:', targetSessionId);
      }
    } else if (finalStatus === 'ringing') {
      callInfo.status = 'ringing';
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
    // Resume AudioContext if it's suspended (required by browsers for auto-play)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        console.log('SIP.js: AudioContext resumed successfully');
      }).catch(error => {
        console.warn('SIP.js: Failed to resume AudioContext:', error);
      });
    }
  }

  // Method to ensure audio context is ready for user-initiated actions
  enableAudio() {
    this.setupAudioContext();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(error => {
        console.warn('SIP.js: Failed to enable audio:', error);
      });
    }
  }

  // Pre-initialize media devices for faster call answering
  async preInitializeMedia(): Promise<MediaStream | null> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.warn('getUserMedia not supported');
        return null;
      }

      // Get media stream early to speed up call answering
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log('Media pre-initialized successfully');
      return stream;
    } catch (error) {
      console.warn('Failed to pre-initialize media:', error);
      return null;
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
      console.log('SIP.js: Starting ringtone generation');
      this.setupAudioContext();
      if (!this.audioContext) {
        console.error('SIP.js: AudioContext not available for ringtone');
        return;
      }
      console.log('SIP.js: AudioContext state:', this.audioContext.state);

      // Stop any existing ringtone
      this.stopRingtone();

      // Create distinctive double-ring pattern for incoming calls
      const playDoubleRing = () => {
        if (!this.audioContext) return;
        const audioCtx = this.audioContext; // Capture context reference
        // First ring burst
        const createRingBurst = (delay: number) => {
          const oscillator1 = audioCtx.createOscillator();
          const oscillator2 = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();

          // Incoming ringtone: 523Hz + 659Hz (higher pitched, more urgent)
          oscillator1.frequency.setValueAtTime(523, audioCtx.currentTime); // C5
          oscillator2.frequency.setValueAtTime(659, audioCtx.currentTime); // E5
          // Create envelope for ring burst
          gainNode.gain.setValueAtTime(0, audioCtx.currentTime + delay);
          gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + delay + 0.01);
          gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime + delay + 0.4);
          gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + delay + 0.5);

          oscillator1.connect(gainNode);
          oscillator2.connect(gainNode);
          gainNode.connect(audioCtx.destination);

          oscillator1.start(audioCtx.currentTime + delay);
          oscillator2.start(audioCtx.currentTime + delay);
          oscillator1.stop(audioCtx.currentTime + delay + 0.5);
          oscillator2.stop(audioCtx.currentTime + delay + 0.5);
        };
        // Create double ring pattern: ring-ring-silence
        createRingBurst(0); // First ring at 0ms
        createRingBurst(0.7); // Second ring at 700ms
        // Total pattern duration: 1.2s, then 2.8s silence
      };

      // Play initial double ring
      playDoubleRing();

      // Set up interval for repeated double-ring pattern (every 4 seconds)
      this.ringtoneInterval = setInterval(playDoubleRing, 4000);

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
    if (this.isConferenceMode) {
      // In conference mode, unmute all non-held calls
      for (const [sessionId, audio] of this.sessionAudioElements.entries()) {
        const callInfo = this.callInfos.get(sessionId);
        if (callInfo) {
          // Only mute if call is explicitly on hold
          const shouldMute = callInfo.isOnHold;
          audio.muted = shouldMute;
          console.log(`Conference mode: Audio ${shouldMute ? 'muted' : 'unmuted'} for session ${sessionId} (onHold: ${callInfo.isOnHold})`);
        }
      }
    } else {
      // Normal mode: mute all calls except the active one
      for (const [sessionId, audio] of this.sessionAudioElements.entries()) {
        const callInfo = this.callInfos.get(sessionId);
        if (callInfo) {
          // Mute if: not active session OR call is on hold
          const shouldMute = sessionId !== this.activeSessionId || callInfo.isOnHold;
          audio.muted = shouldMute;
          console.log(`Normal mode: Audio ${shouldMute ? 'muted' : 'unmuted'} for session ${sessionId} (active: ${sessionId === this.activeSessionId}, onHold: ${callInfo.isOnHold})`);
        }
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
              rtcpMuxPolicy: 'require',
              iceTransportPolicy: 'all'
            }
          },
          // Pre-acquire media for faster connection
          alwaysAcquireMediaFirst: true
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
        transport.send = function (message) {
          console.log('🔴 SIP.js SENT:', message);
          return originalSend.call(this, message);
        };
        // Trace incoming messages
        transport.onMessage = function (message) {
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
    
    // Send 180 Ringing response to indicate the phone is ringing
    try {
      invitation.progress();
      console.log('✅ Sent 180 Ringing response for incoming call from:', remoteUser);
    } catch (error) {
      console.error('Failed to send 180 Ringing response:', error);
    }
    
    // Store session and call info
    this.sessions.set(sessionId, invitation);
    this.callInfos.set(sessionId, {
      sessionId,
      remoteNumber: remoteUser,
      isOnHold: false,
      direction: 'incoming',
      status: 'ringing',
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
          this.stopRingtone(); // Stop ringtone if call was declined/terminated
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
        status: 'connecting',
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
        // Check the current session state
        const currentState = activeSession.state;
        console.log('Answering call, current state:', currentState);
        // If session is already establishing or established, don't try to accept again
        if (currentState === SessionState.Established) {
          console.log('Session already established');
          return;
        }
        // If session is in Establishing state, wait for it to be ready
        if (currentState === SessionState.Establishing) {
          console.log('Session is establishing, waiting for Initial state...');
          let attempts = 0;
          const maxAttempts = 5; // Reduced attempts for faster response
          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 50)); // Reduced wait time from 100ms to 50ms
            attempts++;
            const newState = activeSession.state;
            console.log(`Attempt ${attempts}: Session state is ${newState}`);
            // Check if session was terminated while waiting
            if (newState === SessionState.Terminated) {
              throw new Error('Call was terminated before it could be answered');
            }
            // If state changed to established, we're done
            if (newState === SessionState.Established) {
              console.log('Session became established while waiting');
              return;
            }
            // If state is Initial, try to accept
            if (newState === SessionState.Initial) {
              console.log('Session is ready to accept');
              await activeSession.accept();
              return;
            }
          }
          // If we're still in Establishing after all attempts, try to accept anyway
          console.warn('Session still establishing after waiting, attempting accept anyway');
        }
        // Try to accept the session
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
    // Stop ringtone and ringback when hanging up
    this.stopRingtone();
    this.stopRingbackTone();
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

  async rejectCall(): Promise<void> {
    // Stop ringtone immediately when rejecting
    this.stopRingtone();
    const activeSession = this.getActiveSession();
    if (activeSession) {
      try {
        // For incoming calls (invitations), use reject method
        if (activeSession.reject) {
          await activeSession.reject();
          console.log('Call rejected');
        } else {
          // Fallback to terminate if reject is not available
          await activeSession.terminate();
          console.log('Call terminated (no reject method available)');
        }
      } catch (error: any) {
        console.error('Failed to reject call:', error);
        // Don't throw here, just log - reject should always succeed from user perspective
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
          console.log('Call placed on hold (FreeSWITCH will handle hold music)');
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

  async holdCallBySessionId(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const callInfo = this.callInfos.get(sessionId);
    if (session && session.state === SessionState.Established && callInfo && !callInfo.isOnHold) {
      try {
        // Send hold using SIP.js's built-in re-INVITE mechanism (like Zoiper)
        try {
          // Use sessionDescriptionHandlerModifiers to change SDP to inactive for hold
          const holdModifier = (description: RTCSessionDescriptionInit) => {
            if (description.sdp) {
              // Replace all media directions with inactive (like Zoiper does)
              description.sdp = description.sdp.replace(/a=sendrecv/g, 'a=inactive');
              description.sdp = description.sdp.replace(/a=sendonly/g, 'a=inactive');
              description.sdp = description.sdp.replace(/a=recvonly/g, 'a=inactive');
              console.log('Modified SDP for hold: set a=inactive');
            }
            return Promise.resolve(description);
          };

          // Send re-INVITE with hold SDP using SIP.js's invite method
          await (session as any).invite({
            sessionDescriptionHandlerModifiers: [holdModifier],
            requestOptions: {
              extraHeaders: [
                'Allow: INVITE, ACK, CANCEL, BYE, NOTIFY, REFER, MESSAGE, OPTIONS, INFO, SUBSCRIBE',
                'Supported: replaces, norefersub, extended-refer, timer, outbound, path',
                'Allow-Events: presence, kpml, talk'
              ]
            }
          });
          
          console.log('✅ Sent SIP hold INVITE with a=inactive (Zoiper-style) - FreeSWITCH will play hold music');
          
          // Also mute local tracks as a safety measure
          const sessionDescriptionHandler = session.sessionDescriptionHandler;
          if (sessionDescriptionHandler) {
            const pc = sessionDescriptionHandler.peerConnection;
            if (pc) {
              const senders = pc.getSenders();
              senders.forEach((sender: RTCRtpSender) => {
                if (sender.track && sender.track.kind === 'audio') {
                  sender.track.enabled = false;
                }
              });
            }
          }
        } catch (error) {
          console.error('Failed to send hold INVITE, falling back to track muting:', error);
          // Fallback to just muting tracks
          const sessionDescriptionHandler = session.sessionDescriptionHandler;
          if (sessionDescriptionHandler) {
            const pc = sessionDescriptionHandler.peerConnection;
            if (pc) {
              const senders = pc.getSenders();
              senders.forEach((sender: RTCRtpSender) => {
                if (sender.track && sender.track.kind === 'audio') {
                  sender.track.enabled = false;
                }
              });
            }
          }
        }
        
        // Update call info
        callInfo.isOnHold = true;
        // Mute local audio as additional measure
        this.setAudioForSession(sessionId, true);
        
        // Switch to another active call if available
        const activeCalls = this.getCallInfosArray().filter(c => !c.isOnHold);
        if (activeCalls.length > 0) {
          this.activeSessionId = activeCalls[0].sessionId;
        }
        this.updateCallState();
        console.log('Call placed on hold (server-side):', sessionId);
      } catch (error: any) {
        console.error('Failed to hold call:', error);
        throw new Error('Failed to place call on hold');
      }
    } else {
      throw new Error('Call not found or cannot be held');
    }
  }

  async unholdCallBySessionId(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const callInfo = this.callInfos.get(sessionId);
    if (session && session.state === SessionState.Established && callInfo && callInfo.isOnHold) {
      try {
        // Hold all other calls first (only in normal mode, not in conference mode)
        if (!this.isConferenceMode) {
          for (const [otherSessionId, otherCallInfo] of this.callInfos.entries()) {
            if (otherSessionId !== sessionId && !otherCallInfo.isOnHold) {
              await this.holdCallBySessionId(otherSessionId);
            }
          }
        }
        
        // Resume call with proper SIP unhold
        const sessionDescriptionHandler = session.sessionDescriptionHandler;
        if (sessionDescriptionHandler) {
          const pc = sessionDescriptionHandler.peerConnection;
          if (pc) {
            // Unmute both sending and receiving tracks
            const senders = pc.getSenders();
            senders.forEach((sender: RTCRtpSender) => {
              if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = true;
                console.log('Unmuted outgoing audio track');
              }
            });
            
            // Also ensure receivers are properly handling audio
            const receivers = pc.getReceivers();
            receivers.forEach((receiver: RTCRtpReceiver) => {
              if (receiver.track && receiver.track.kind === 'audio') {
                receiver.track.enabled = true;
                console.log('Ensured incoming audio track is enabled');
              }
            });
            
            // Send unhold using SIP.js's built-in re-INVITE mechanism
            try {
              // Use sessionDescriptionHandlerModifiers to change SDP back to sendrecv for unhold
              const unholdModifier = (description: RTCSessionDescriptionInit) => {
                if (description.sdp) {
                  // Replace inactive with sendrecv to resume media
                  description.sdp = description.sdp.replace(/a=inactive/g, 'a=sendrecv');
                  // Also replace sendonly with sendrecv if present
                  description.sdp = description.sdp.replace(/a=sendonly/g, 'a=sendrecv');
                  console.log('Modified SDP for unhold: set a=sendrecv');
                }
                return Promise.resolve(description);
              };

              // Send re-INVITE with unhold SDP using SIP.js's invite method
              await (session as any).invite({
                sessionDescriptionHandlerModifiers: [unholdModifier],
                requestOptions: {
                  extraHeaders: [
                    'Allow: INVITE, ACK, CANCEL, BYE, NOTIFY, REFER, MESSAGE, OPTIONS, INFO, SUBSCRIBE',
                    'Supported: replaces, norefersub, extended-refer, timer, outbound, path',
                    'Allow-Events: presence, kpml, talk'
                  ]
                }
              });
              
              console.log('✅ Sent SIP unhold INVITE with a=sendrecv - FreeSWITCH will stop hold music');
            } catch (error) {
              console.error('Failed to send unhold INVITE:', error);
            }
          }
        }
        
        // Update call info
        callInfo.isOnHold = false;
        this.activeSessionId = sessionId;
        
        // Explicitly unmute the audio element for this session
        this.setAudioForSession(sessionId, false);
        
        // Manage audio: unmute this call, mute others
        this.muteAllInactiveCalls();
        this.updateCallState();
        console.log('Call resumed from hold (server-side):', sessionId);
      } catch (error: any) {
        console.error('Failed to unhold call:', error);
        throw new Error('Failed to resume call');
      }
    } else {
      throw new Error('Call not found or not on hold');
    }
  }

  async enableConferenceMode(): Promise<void> {
    this.isConferenceMode = true;
    // Generate unique conference room ID
    this.conferenceRoomId = `conf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    // Get all active calls
    const allCalls = this.getCallInfosArray();
    if (allCalls.length < 2) {
      console.warn('Need at least 2 calls to start conference');
      return;
    }

    console.log(`Starting FreeSWITCH conference room: ${this.conferenceRoomId}`);
    try {
      // Send INVITE to FreeSWITCH to establish conference (Zoiper-style)
      for (const call of allCalls) {
        const session = this.sessions.get(call.sessionId);
        if (session && session.state === SessionState.Established) {
          // Send re-INVITE to move call into conference mode
          await this.inviteToConference(session, call);
          this.conferenceParticipants.add(call.sessionId);
          
          // Resume held calls for conference
          if (call.isOnHold) {
            call.isOnHold = false;
            this.setAudioForSession(call.sessionId, false);
            console.log('Resumed held call for conference:', call.sessionId);
          }
        }
      }
      
      // Setup local audio mixing as additional support
      this.setupConferenceMixer();
      this.muteAllInactiveCalls();
      console.log('FreeSWITCH conference started with participants:', Array.from(this.conferenceParticipants));
      this.updateCallState();
    } catch (error) {
      console.error('Failed to start FreeSWITCH conference:', error);
      // Fallback to client-side mixing
      this.setupConferenceMixer();
      this.muteAllInactiveCalls();
      console.log('Falling back to client-side conference mixing');
    }
  }

  disableConferenceMode(): void {
    this.isConferenceMode = false;
    // Smart conference exit: prioritize incoming calls, disconnect outgoing calls
    const allCalls = this.getCallInfosArray();
    const incomingCalls = allCalls.filter(call => call.direction === 'incoming');
    const outgoingCalls = allCalls.filter(call => call.direction === 'outgoing');
    // If there are incoming calls, keep the first one active and disconnect outgoing calls
    if (incomingCalls.length > 0 && outgoingCalls.length > 0) {
      const primaryCall = incomingCalls[0]; // Prioritize first incoming call
      // Disconnect all outgoing calls
      outgoingCalls.forEach(call => {
        console.log('Disconnecting outgoing call on conference exit:', call.sessionId);
        this.endCall(call.sessionId);
      });
      // Ensure the primary incoming call is active (not on hold)
      if (primaryCall.isOnHold) {
        try {
          this.unholdCallBySessionId(primaryCall.sessionId);
          console.log('Resumed primary incoming call on conference exit:', primaryCall.sessionId);
        } catch (error) {
          console.error('Failed to resume primary call on conference exit:', primaryCall.sessionId, error);
        }
      }
      // Set the primary call as active
      this.activeSessionId = primaryCall.sessionId;
    } else if (allCalls.length > 1) {
      // If no incoming calls or mixed scenario, keep the first call and disconnect others
      const primaryCall = allCalls[0];
      const otherCalls = allCalls.slice(1);
      otherCalls.forEach(call => {
        console.log('Disconnecting secondary call on conference exit:', call.sessionId);
        this.endCall(call.sessionId);
      });
      // Ensure the primary call is active
      if (primaryCall.isOnHold) {
        try {
          this.unholdCallBySessionId(primaryCall.sessionId);
          console.log('Resumed primary call on conference exit:', primaryCall.sessionId);
        } catch (error) {
          console.error('Failed to resume primary call on conference exit:', primaryCall.sessionId, error);
        }
      }
      this.activeSessionId = primaryCall.sessionId;
    }
    // Clear conference participants and room
    this.conferenceParticipants.clear();
    this.conferenceRoomId = undefined;
    // Cleanup conference mixer
    this.cleanupConferenceMixer();
    // Revert to normal mode - only active call unmuted
    this.muteAllInactiveCalls();
    console.log('FreeSWITCH conference ended with smart call management');
    this.updateCallState();
  }

  private setupConferenceMixer(): void {
    try {
      this.setupAudioContext();
      if (!this.audioContext) return;

      // Create conference mixer
      this.conferenceMixer = this.audioContext.createGain();
      this.conferenceMixer.gain.setValueAtTime(1.0, this.audioContext.currentTime);
      this.conferenceMixer.connect(this.audioContext.destination);

      console.log('Conference mixer setup complete');
    } catch (error) {
      console.error('Failed to setup conference mixer:', error);
    }
  }

  private cleanupConferenceMixer(): void {
    if (this.conferenceMixer) {
      try {
        this.conferenceMixer.disconnect();
        this.conferenceMixer = undefined;
        console.log('Conference mixer cleaned up');
      } catch (error) {
        console.error('Error cleaning up conference mixer:', error);
      }
    }
  }

  addToConference(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) {
      console.warn('Cannot add non-existent session to conference:', sessionId);
      return false;
    }

    if (this.conferenceParticipants.has(sessionId)) {
      console.warn('Session already in conference:', sessionId);
      return false;
    }

    // Add to conference
    this.conferenceParticipants.add(sessionId);
    // Enable conference mode if not already enabled
    if (!this.isConferenceMode) {
      this.isConferenceMode = true;
      this.setupConferenceMixer();
    }

    // Resume call if it was on hold and unmute the participant
    const callInfo = this.callInfos.get(sessionId);
    if (callInfo) {
      if (callInfo.isOnHold) {
        try {
          this.unholdCallBySessionId(sessionId);
          console.log('Resumed held call for conference addition:', sessionId);
        } catch (error) {
          console.error('Failed to resume held call for conference addition:', sessionId, error);
        }
      }
      callInfo.isOnHold = false;
      this.setAudioForSession(sessionId, false);
    }

    console.log('Added to conference:', sessionId);
    this.updateCallState();
    return true;
  }

  removeFromConference(sessionId: string): boolean {
    if (!this.conferenceParticipants.has(sessionId)) {
      console.warn('Session not in conference:', sessionId);
      return false;
    }

    // Remove from conference
    this.conferenceParticipants.delete(sessionId);
    // Mute the participant
    this.setAudioForSession(sessionId, true);

    // If no participants left, disable conference mode
    if (this.conferenceParticipants.size === 0) {
      this.disableConferenceMode();
    }

    console.log('Removed from conference:', sessionId);
    this.updateCallState();
    return true;
  }

  isInConference(sessionId: string): boolean {
    return this.conferenceParticipants.has(sessionId);
  }

  getConferenceParticipants(): string[] {
    return Array.from(this.conferenceParticipants);
  }

  getConferenceSize(): number {
    return this.conferenceParticipants.size;
  }

  isInConferenceMode(): boolean {
    return this.isConferenceMode;
  }

  // Send INVITE to establish conference bridge (Zoiper-style)
  private async inviteToConference(session: any, callInfo: CallInfo): Promise<void> {
    try {
      // Use sessionDescriptionHandlerModifiers to maintain current SDP settings
      const conferenceModifier = (description: RTCSessionDescriptionInit) => {
        if (description.sdp) {
          // Keep sendrecv for conference mode
          description.sdp = description.sdp.replace(/a=inactive/g, 'a=sendrecv');
          description.sdp = description.sdp.replace(/a=sendonly/g, 'a=sendrecv');
          description.sdp = description.sdp.replace(/a=recvonly/g, 'a=sendrecv');
          console.log('Modified SDP for conference: set a=sendrecv');
        }
        return Promise.resolve(description);
      };

      // Send re-INVITE with conference headers (similar to Zoiper)
      await session.invite({
        sessionDescriptionHandlerModifiers: [conferenceModifier],
        requestOptions: {
          extraHeaders: [
            'Allow: INVITE, ACK, CANCEL, BYE, NOTIFY, REFER, MESSAGE, OPTIONS, INFO, SUBSCRIBE',
            'Supported: replaces, norefersub, extended-refer, timer, outbound, path',
            'Allow-Events: presence, kpml, talk, as-feature-event',
            `X-Conference-Id: ${this.conferenceRoomId}`
          ]
        }
      });
      
      console.log(`✅ Sent conference INVITE for session ${callInfo.sessionId} to join conference ${this.conferenceRoomId}`);
    } catch (error) {
      console.error(`Failed to send conference INVITE for session ${callInfo.sessionId}:`, error);
      throw error;
    }
  }

  // Transfer a call to FreeSWITCH conference room using SIP REFER (legacy method)
  private async transferToConference(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state !== SessionState.Established) {
      throw new Error(`Session ${sessionId} is not established (state: ${session.state})`);
    }

    if (!this.config?.server || !this.conferenceRoomId) {
      console.warn('Missing config server or conference room ID, skipping REFER');
      return;
    }

    const conferenceUri = `sip:${this.conferenceRoomId}@${this.config.server}`;
    try {
      // Send REFER to transfer the call to conference
      console.log(`Transferring session ${sessionId} to conference: ${conferenceUri}`);
      // Check if session has the request method
      if (typeof session.request !== 'function') {
        console.warn(`Session ${sessionId} does not support REFER requests, using client-side mixing`);
        return;
      }
      // Create REFER request manually using session's request method
      const referToURI = new URI('sip', this.conferenceRoomId, this.config.server);
      const referRequest = session.request('REFER', {
        extraHeaders: [
          `Refer-To: ${referToURI.toString()}`,
          'Referred-By: ' + session.remoteIdentity?.uri?.toString() || 'unknown'
        ],
        requestDelegate: {
          onAccept: () => {
            console.log(`Conference REFER accepted for session: ${sessionId}`);
          },
          onReject: (response: any) => {
            console.error(`Conference REFER rejected for session: ${sessionId}`, response);
          }
        }
      });
      console.log(`Successfully sent REFER for ${sessionId} to conference room ${this.conferenceRoomId}`);
    } catch (error) {
      console.error(`Failed to send REFER for session ${sessionId} to conference:`, error);
      // Don't throw here - fallback to client-side mixing
      console.warn('Falling back to client-side audio mixing for conference');
    }
  }

  // Alternative method using attended transfer for conference
  async createAttendedConference(sessionId1: string, sessionId2: string): Promise<void> {
    const session1 = this.sessions.get(sessionId1);
    const session2 = this.sessions.get(sessionId2);
    if (!session1 || !session2) {
      throw new Error('One or both sessions not found for attended conference');
    }

    try {
      console.log(`Creating attended conference between ${sessionId1} and ${sessionId2}`);
      // Generate conference room ID
      this.conferenceRoomId = `conf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const conferenceUri = `sip:${this.conferenceRoomId}@${this.config?.server}`;
      // Hold both calls first
      await Promise.all([
        this.holdCallBySessionId(sessionId1),
        this.holdCallBySessionId(sessionId2)
      ]);
      // Transfer both to conference
      await Promise.all([
        this.transferToConference(sessionId1),
        this.transferToConference(sessionId2)
      ]);
      // Enable conference mode
      this.isConferenceMode = true;
      this.conferenceParticipants.add(sessionId1);
      this.conferenceParticipants.add(sessionId2);
      console.log(`Attended conference created: ${this.conferenceRoomId}`);
      this.updateCallState();
    } catch (error) {
      console.error('Failed to create attended conference:', error);
      throw error;
    }
  }

  getActiveCalls(): CallInfo[] {
    return this.getCallInfosArray().filter(call => !call.isOnHold);
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
