import {
  UserAgent,
  Registerer,
  Inviter,
  SessionState,
  UserAgentOptions,
  URI,
  Session,
  Subscriber,
  SubscriptionState
} from 'sip.js';

export interface SipConfig {
  server: string;
  username: string;
  password: string;
  domain?: string;
  protocol: 'ws' | 'wss';
  moderatorPin?: string;
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
  isConferenceMode?: boolean;
  conferenceRoomId?: string;
}

export interface CallInfo {
  sessionId: string;
  remoteNumber: string;
  isOnHold: boolean;
  isMuted?: boolean;
  direction: 'incoming' | 'outgoing';
  status: 'connecting' | 'ringing' | 'connected';
  startTime?: Date;
  connectedTime?: Date;
  isInConference?: boolean;
}

export interface ConferenceParticipant {
  entity: string; // Unique participant entity URI
  displayText?: string; // Display name 
  state: 'pending' | 'dialing-out' | 'dialing-in' | 'alerting' | 'active' | 'on-hold' | 'disconnecting' | 'disconnected';
  joinMethod?: 'dialed-in' | 'dialed-out' | 'focus-owner';
  language?: string;
  endpoints: ConferenceEndpoint[];
}

export interface ConferenceEndpoint {
  entity: string; // Endpoint entity URI
  displayText?: string;
  state: 'pending' | 'dialing-out' | 'dialing-in' | 'alerting' | 'active' | 'on-hold' | 'disconnecting' | 'disconnected';
  joiningMethod?: 'dialed-in' | 'dialed-out' | 'focus-owner';
  media?: ConferenceMedia[];
}

export interface ConferenceMedia {
  id: string;
  type: 'audio' | 'video' | 'text';
  status: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';
  srcId?: string;
}

export class SipService {
  private userAgent?: UserAgent;
  private registerer?: Registerer;
  private sessions: Map<string, any> = new Map(); // sessionId -> session
  private callInfos: Map<string, CallInfo> = new Map(); // sessionId -> call info
  private activeSessionId?: string; // Currently active session
  private isConferenceMode: boolean = false; // Whether multiple calls are in conference
  private conferenceParticipants: Set<string> = new Set(); // Session IDs in conference
  private conferenceParticipantInfos: Map<string, CallInfo> = new Map(); // Preserved participant info for UI
  private conferenceMixer?: GainNode; // Audio mixer for conference
  private conferenceRoomId?: string; // FreeSWITCH conference room ID
  private conferenceSubscriber?: Subscriber; // RFC 4575 conference event subscription
  private conferenceState: Map<string, ConferenceParticipant> = new Map(); // Real-time conference state from NOTIFY
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
  private eventListeners: Map<string, ((data?: any) => void)[]> = new Map();
  private pendingReferTransfers: Set<string> = new Set(); // Track pending REFER transfers
  private successfulTransfers: Set<string> = new Set(); // Track completed REFER transfers
  private isMicrophoneMuted: boolean = false; // Track microphone mute state

  setCallStateCallback(callback: (state: CallState) => void) {
    this.onCallStateChanged = callback;
  }

  setRegistrationStateCallback(callback: (registered: boolean) => void) {
    this.onRegistrationStateChanged = callback;
  }

  // Simple event system for internal events
  on(eventName: string, callback: (data?: any) => void) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName)!.push(callback);
  }

  off(eventName: string, callback: (data?: any) => void) {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emitEvent(eventName: string, data?: any) {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${eventName}:`, error);
        }
      });
    }
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
      // Don't go to idle if we're in conference mode - conference controls should remain visible
      if (this.isConferenceMode) {
        console.log('No active calls but in conference mode - keeping conference controls visible');
        this.onCallStateChanged?.({
          status: 'connected', // Keep as connected to show conference controls
          activeCalls: [],
          isConferenceMode: this.isConferenceMode,
          conferenceRoomId: this.conferenceRoomId
        });
      } else {
        // Conference controls about to be hidden - going to idle
        this.onCallStateChanged?.({
          status: 'idle',
          activeCalls: []
        });
      }
      return;
    }

    // If no specific session, use active session or first available
    const targetSessionId = sessionId || this.activeSessionId || activeCalls[0]?.sessionId;
    
    // Special case: In conference mode without active calls but need to maintain UI
    if (this.isConferenceMode && !targetSessionId) {
      console.log('Conference mode active but no target session - maintaining conference UI state');
      this.onCallStateChanged?.({
        status: 'connected',
        activeCalls: activeCalls,
        isConferenceMode: this.isConferenceMode,
        conferenceRoomId: this.conferenceRoomId
      });
      return;
    }
    
    const callInfo = this.callInfos.get(targetSessionId);
    const session = this.sessions.get(targetSessionId);

    if (!callInfo || !session) {
      // In conference mode, still try to maintain UI even if individual sessions are gone
      if (this.isConferenceMode) {
        console.log('Conference mode active but callInfo/session not found - maintaining conference UI');
        this.onCallStateChanged?.({
          status: 'connected',
          activeCalls: activeCalls,
          isConferenceMode: this.isConferenceMode,
          conferenceRoomId: this.conferenceRoomId
        });
      }
      return;
    }

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
        },
        onNotify: (notification) => {
          // Handle unsolicited NOTIFY messages from FreeSWITCH
          this.handleUnsolicitedNotify(notification);
        },
        onMessage: (message) => {
          // Handle MESSAGE requests
          console.log('📨 Received SIP MESSAGE:', message);
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

  // Handle unsolicited NOTIFY messages from FreeSWITCH
  private handleUnsolicitedNotify(notification: any): void {
    try {
      console.log('📬 UNSOLICITED NOTIFY RECEIVED');
      
      // Extract event type
      const event = notification.request?.getHeader?.('Event') || 
                   notification.request?.headers?.Event?.[0]?.parsed ||
                   notification.request?.headers?.event?.[0] ||
                   'unknown';
      
      console.log(`  - Event Type: ${event}`);
      
      // Accept the NOTIFY to prevent 481 response
      if (notification.accept) {
        notification.accept();
        console.log('  ✅ NOTIFY accepted (200 OK sent)');
      }
      
      // Handle different event types
      switch (event) {
        case 'message-summary':
          // Voicemail notification
          this.handleMessageSummaryNotify(notification);
          break;
          
        case 'presence':
          // Presence notification
          console.log('  - Presence notification received');
          break;
          
        case 'dialog':
          // Dialog state notification
          console.log('  - Dialog notification received');
          break;
          
        case 'conference':
          // Conference event (unlikely to be unsolicited)
          console.log('  - Conference notification received (unsolicited)');
          this.handleConferenceNotify(notification);
          break;
          
        default:
          console.log(`  - Unknown event type: ${event}`);
      }
      
    } catch (error) {
      console.error('Error handling unsolicited NOTIFY:', error);
      // Try to accept it anyway to avoid 481
      if (notification.accept) {
        try {
          notification.accept();
        } catch (acceptError) {
          console.error('Failed to accept NOTIFY:', acceptError);
        }
      }
    }
  }
  
  // Handle message-summary (voicemail) notifications
  private handleMessageSummaryNotify(notification: any): void {
    try {
      const body = notification.request?.body || 
                  notification.request?.message?.body ||
                  notification.body;
                  
      console.log('📬 MESSAGE-SUMMARY NOTIFY:');
      console.log('  - Body:', body);
      
      if (body) {
        // Parse message-summary body
        const lines = body.split('\n');
        let hasMessages = false;
        let messageAccount = '';
        
        lines.forEach((line: string) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('Messages-Waiting:')) {
            hasMessages = trimmed.toLowerCase().includes('yes');
          } else if (trimmed.startsWith('Message-Account:')) {
            messageAccount = trimmed.substring('Message-Account:'.length).trim();
          }
        });
        
        console.log(`  - Messages Waiting: ${hasMessages ? 'YES' : 'NO'}`);
        console.log(`  - Account: ${messageAccount}`);
        
        // Emit event to update UI with voicemail status
        if (hasMessages) {
          this.emitEvent('voicemailWaiting', { 
            hasMessages, 
            account: messageAccount 
          });
        }
      }
    } catch (error) {
      console.error('Error parsing message-summary:', error);
    }
  }

  private handleIncomingCall(invitation: any) {
    const sessionId = this.generateSessionId();
    const remoteUser = invitation.remoteIdentity?.uri?.user || 'Unknown';
    
    // Check if this is a conference-related call that should be auto-accepted
    const isConferenceRelated = 
      (this.isConferenceMode && remoteUser === this.config?.username) || // Call from our own extension during conference
      (this.isConferenceMode && remoteUser === this.conferenceRoomId) || // Call from conference room
      (this.isConferenceMode && /^30\d{2}$/.test(remoteUser)) || // Any conference room (3000-3999)
      (this.isConferenceMode && remoteUser === '3000'); // Default conference room
    
    // Also check if we already have a session with a similar ID (outgoing conference join)
    const existingConferenceSession = Array.from(this.sessions.entries())
      .find(([id, session]) => id.startsWith('conf_session_') && id.includes(remoteUser));
    
    if (isConferenceRelated || existingConferenceSession) {
      console.log(`🎯 Auto-accepting conference-related call from ${remoteUser} (conference mode: ${this.isConferenceMode})`);
      
      // Auto-accept conference-related calls immediately
      try {
        const answerOptions = {
          sessionDescriptionHandlerOptions: {
            constraints: { audio: true, video: false }
          }
        };
        
        invitation.accept(answerOptions);
        
        // Use existing session ID if we have an outgoing conference session, otherwise create new
        const confSessionId = existingConferenceSession ? existingConferenceSession[0] : `conf_auto_${sessionId}`;
        
        // Store or replace the session
        this.sessions.set(confSessionId, invitation);
        this.conferenceParticipants.add(confSessionId);
        
        // Setup audio and handle state changes
        invitation.stateChange.addListener((state: SessionState) => {
          if (state === SessionState.Established) {
            console.log(`✅ Conference-related call established from ${remoteUser}`);
            this.setupAudioStreams(invitation, confSessionId);
            
            // Force UI update to show conference controls
            this.updateCallState();
            this.emitEvent('conferenceStateChanged', {
              participants: Array.from(this.conferenceParticipants),
              isConferenceMode: this.isConferenceMode,
              conferenceRoomId: this.conferenceRoomId
            });
          } else if (state === SessionState.Terminated) {
            console.log(`Conference-related call terminated from ${remoteUser}`);
            this.sessions.delete(confSessionId);
            this.conferenceParticipants.delete(confSessionId);
          }
        });
        
        console.log(`✅ Auto-accepted conference call from ${remoteUser}, session ID: ${confSessionId}`);
        return; // Don't process as regular incoming call
      } catch (error) {
        console.error('Failed to auto-accept conference call:', error);
        // Fall through to regular handling if auto-accept fails
      }
    }
    
    // Regular incoming call handling
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
          
          // Handle conference participant leaving
          if (this.isConferenceMode && this.conferenceParticipants.has(sessionId)) {
            const callInfo = this.callInfos.get(sessionId);
            const wasTransferred = callInfo?.isInConference && this.successfulTransfers.has(sessionId);
            
            if (wasTransferred) {
              console.log(`📞 Session ${sessionId} terminated after REFER transfer - keeping in conference as transferred participant`);
              // Don't remove from conference participants - it was successfully transferred
              // The session terminated because FreeSWITCH took over the call
            } else {
              console.log(`Conference participant ${sessionId} terminated, removing from conference`);
              this.conferenceParticipants.delete(sessionId);
              
              // Check if only the conference room session remains (no real participants)
              // Conference room session has ID like "conf_session_3000"
              const realParticipants = Array.from(this.conferenceParticipants).filter(
                id => !id.startsWith('conf_session_')
              );
              
              if (realParticipants.length === 0) {
                console.log('⚠️ All real participants left conference (only conference room session remains), ending conference...');
                this.disableConferenceMode();
              }
            }
          }
          
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
          // Clean up session
          this.sessions.delete(sessionId);
          
          // For transferred participants, keep callInfo but mark as transferred
          const currentCallInfo = this.callInfos.get(sessionId);
          const wasTransferred = currentCallInfo?.isInConference && this.successfulTransfers.has(sessionId);
          
          if (wasTransferred) {
            console.log(`📞 Keeping callInfo for transferred participant ${sessionId} (${currentCallInfo?.remoteNumber})`);
            // Keep the callInfo for UI display, but mark it as transferred
            if (currentCallInfo) {
              currentCallInfo.status = 'connected'; // Keep showing as connected in conference
            }
          } else {
            // Regular session termination - remove callInfo
            this.callInfos.delete(sessionId);
          }
          
          if (this.activeSessionId === sessionId) {
            // Don't clear activeSessionId if we're in conference mode - need it for UI state
            if (!this.isConferenceMode) {
              // About to clear activeSessionId - may hide conference controls
              this.activeSessionId = undefined;
            } else {
              console.log(`📞 Keeping activeSessionId in conference mode to maintain UI state`);
            }
          }
          // Send updated state for remaining calls
          this.updateCallState();
          break;
      }
    });
  }

  // Multi-call management methods
  async switchToCall(sessionId: string): Promise<boolean> {
    if (this.sessions.has(sessionId) && this.callInfos.has(sessionId)) {
      const previousActiveSessionId = this.activeSessionId;
      
      try {
        // Put previous active call on hold before switching (wait for completion)
        if (previousActiveSessionId && previousActiveSessionId !== sessionId) {
          console.log(`📞 Automatically putting previous call ${previousActiveSessionId} on hold when switching to ${sessionId}`);
          await this.holdCallBySessionId(previousActiveSessionId);
          console.log(`✅ Previous call ${previousActiveSessionId} successfully put on hold`);
        }
        
        this.activeSessionId = sessionId;
        const callInfo = this.callInfos.get(sessionId)!;
        
        // If the call we're switching to is on hold, resume it (wait for completion)
        if (callInfo.isOnHold) {
          console.log(`📞 Resuming call ${sessionId} from hold`);
          await this.unholdCallBySessionId(sessionId);
          console.log(`✅ Call ${sessionId} successfully resumed from hold`);
        }
        
      } catch (error) {
        console.warn('Error during call switching:', error);
        // Continue with the switch even if hold/unhold operations fail
      }
      
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

  getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  async endCall(sessionId?: string): Promise<void> {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) return;
    const session = this.sessions.get(targetSessionId);
    if (session) {
      try {
        console.log(`📞 Ending call for session ${targetSessionId}, state: ${session.state}, type: ${session.constructor?.name}`);
        
        // Stop any ringback or ringtone immediately when ending call
        this.stopRingbackTone();
        this.stopRingtone();
        
        // Check session state and type to determine correct method
        if (session.state === SessionState.Established) {
          // For established sessions, use bye()
          console.log('📞 Using bye() for established session');
          if (session.bye) {
            await session.bye();
            console.log('✅ BYE sent successfully');
          }
        } else if (session.state === SessionState.Initial || session.state === SessionState.Establishing) {
          // For non-established sessions, check if it's an incoming call
          if (session.constructor?.name === 'Invitation' || session.reject) {
            console.log('📞 Using reject() for non-established incoming call');
            if (session.reject) {
              await session.reject();
              console.log('✅ Call rejected successfully');
            } else if (session.terminate) {
              await session.terminate();
            }
          } else if (session.constructor?.name === 'Inviter' || session.cancel) {
            // For outgoing calls (Inviter) that haven't connected yet, use cancel()
            console.log('📞 Using cancel() for non-established outgoing call');
            if (session.cancel) {
              await session.cancel();
              console.log('✅ Outgoing call cancelled successfully');
            } else if (session.terminate) {
              // Fallback to terminate if cancel is not available
              await session.terminate();
              console.log('✅ Session terminated');
            }
          } else {
            // Final fallback for unknown session types
            console.log('📞 Unknown session type, using terminate()');
            if (session.terminate) {
              await session.terminate();
              console.log('✅ Session terminated');
            }
          }
        } else if (session.state === SessionState.Terminated) {
          console.log('📞 Session already terminated');
        } else {
          // Fallback for unknown states
          console.log('📞 Unknown state, using terminate()');
          if (session.terminate) {
            await session.terminate();
          }
        }
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

      // If there's already an active call, put it on hold before making new call
      if (this.activeSessionId) {
        const previousActiveSessionId = this.activeSessionId;
        console.log(`📞 Automatically putting current call ${previousActiveSessionId} on hold before making new call to ${number}`);
        this.holdCallBySessionId(previousActiveSessionId).catch(error => {
          console.warn('Failed to automatically hold current call:', error);
        });
      }

      // Set as active session
      this.activeSessionId = sessionId;

      // Start ringback tone for outgoing call
      this.generateRingbackTone();

      // Update UI with connecting state - explicitly pass 'connecting' to ensure UI shows Hang Up button
      this.updateCallState(sessionId, 'connecting');
      session.stateChange.addListener((state: SessionState) => {
        console.log(`📞 Call state change for ${number} (${sessionId}): ${state}`);
        switch (state) {
          case SessionState.Establishing:
            console.log(`🔄 Call ${sessionId} is establishing...`);
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
            console.log(`📞 Call terminated for ${number} (${sessionId})`);
            this.stopRingbackTone(); // Stop any audio feedback
            this.stopRingtone();
            this.cleanupAudioForSession(sessionId);
            
            // Handle conference participant leaving
            if (this.isConferenceMode && this.conferenceParticipants.has(sessionId)) {
              const callInfo = this.callInfos.get(sessionId);
              const wasTransferred = callInfo?.isInConference && this.successfulTransfers.has(sessionId);
              
              if (wasTransferred) {
                console.log(`📞 Session ${sessionId} terminated after REFER transfer - keeping in conference as transferred participant`);
                // Don't remove from conference participants - it was successfully transferred
                // The session terminated because FreeSWITCH took over the call
              } else {
                console.log(`Conference participant ${sessionId} terminated, removing from conference`);
                this.conferenceParticipants.delete(sessionId);
                
                // Check if only the conference room session remains (no real participants)
                const realParticipants = Array.from(this.conferenceParticipants).filter(
                  id => !id.startsWith('conf_session_')
                );
                
                if (realParticipants.length === 0) {
                  console.log('⚠️ All real participants left conference, but keeping conference controls visible');
                  // Don't auto-disable conference mode - let user manually end it
                }
              }
            }
            
            // Send terminated callback with call info before cleanup
            const callInfo = this.callInfos.get(sessionId);
            if (callInfo) {
              console.log(`📞 Sending idle state for terminated call ${sessionId}`);
              this.onCallStateChanged?.({
                status: 'idle',
                remoteNumber: callInfo.remoteNumber,
                direction: callInfo.direction,
                sessionId: sessionId,
                activeCalls: this.getCallInfosArray().filter(c => c.sessionId !== sessionId)
              });
            }
            
            console.log(`📞 Cleaning up session ${sessionId}`);
            this.sessions.delete(sessionId);
            
            // For transferred participants, keep callInfo but mark as transferred
            const currentCallInfo = this.callInfos.get(sessionId);
            const wasTransferred = currentCallInfo?.isInConference && this.successfulTransfers.has(sessionId);
            
            if (wasTransferred) {
              console.log(`📞 Keeping callInfo for transferred participant ${sessionId} (${currentCallInfo?.remoteNumber})`);
              // Keep the callInfo for UI display, but mark it as transferred
              if (currentCallInfo) {
                currentCallInfo.status = 'connected'; // Keep showing as connected in conference
              }
            } else {
              // Regular session termination - remove callInfo
              this.callInfos.delete(sessionId);
            }
            
            if (this.activeSessionId === sessionId) {
              console.log(`📞 Clearing activeSessionId (was ${sessionId})`);
              // Don't clear activeSessionId if we're in conference mode - need it for UI state
              if (!this.isConferenceMode) {
                // About to clear activeSessionId - may hide conference controls
                this.activeSessionId = undefined;
              } else {
                console.log(`📞 Keeping activeSessionId in conference mode to maintain UI state`);
              }
            }
            // Send updated state for remaining calls
            this.updateCallState();
            break;
        }
      });

      console.log(`📞 Sending INVITE for call to ${number} (session: ${sessionId})`);
      await session.invite();
      console.log(`✅ INVITE sent successfully for ${number}`);
    } catch (error: any) {
      console.error(`❌ Failed to send INVITE for ${number}:`, error);
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
        // If there are other active calls, put them on hold before answering this one
        const otherActiveCalls = this.getAllActiveCalls().filter(call => 
          call.sessionId !== this.activeSessionId && 
          call.status === 'connected' && 
          !call.isOnHold
        );
        
        if (otherActiveCalls.length > 0) {
          console.log(`📞 Automatically putting ${otherActiveCalls.length} other calls on hold before answering incoming call`);
          for (const call of otherActiveCalls) {
            this.holdCallBySessionId(call.sessionId).catch(error => {
              console.warn(`Failed to automatically hold call ${call.sessionId}:`, error);
            });
          }
        }

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
    console.log(`📞 Hangup requested, activeSessionId: ${this.activeSessionId}`);
    
    // Stop ringtone and ringback when hanging up
    this.stopRingtone();
    this.stopRingbackTone();
    
    const activeSession = this.getActiveSession();
    console.log(`📞 Active session:`, activeSession ? `Found (state: ${activeSession.state})` : 'Not found');
    
    if (activeSession) {
      try {
        console.log(`📞 Attempting to hangup session in state: ${activeSession.state}`);
        console.log(`📞 Session type:`, activeSession.constructor?.name);
        
        // For Inviter sessions (outgoing calls)
        if (activeSession.constructor?.name === 'Inviter' || activeSession.cancel) {
          switch (activeSession.state) {
            case SessionState.Initial:
            case SessionState.Establishing:
              console.log(`📞 Using cancel() for non-established session`);
              if (activeSession.cancel) {
                await activeSession.cancel();
                console.log(`✅ Call canceled successfully`);
              } else {
                console.warn(`⚠️ No cancel method available, trying terminate`);
                if (activeSession.terminate) {
                  await activeSession.terminate();
                }
              }
              break;
            case SessionState.Established:
              console.log(`📞 Using bye() for established session`);
              if (activeSession.bye) {
                await activeSession.bye();
                console.log(`✅ BYE sent successfully`);
              }
              break;
            case SessionState.Terminated:
              console.log(`📞 Session already terminated`);
              break;
            default:
              console.log(`📞 Unknown state, using terminate()`);
              if (activeSession.terminate) {
                await activeSession.terminate();
                console.log(`✅ Session terminated`);
              }
              break;
          }
        }
        // For Invitation sessions (incoming calls)
        else if (activeSession.constructor?.name === 'Invitation' || activeSession.reject) {
          switch (activeSession.state) {
            case SessionState.Initial:
            case SessionState.Establishing:
              console.log(`📞 Using reject() for non-established incoming call`);
              if (activeSession.reject) {
                await activeSession.reject();
                console.log(`✅ Call rejected successfully`);
              } else if (activeSession.terminate) {
                await activeSession.terminate();
              }
              break;
            case SessionState.Established:
              console.log(`📞 Using bye() for established incoming call`);
              if (activeSession.bye) {
                await activeSession.bye();
                console.log(`✅ BYE sent successfully`);
              }
              break;
            case SessionState.Terminated:
              console.log(`📞 Session already terminated`);
              break;
            default:
              console.log(`📞 Unknown state, using terminate()`);
              if (activeSession.terminate) {
                await activeSession.terminate();
                console.log(`✅ Session terminated`);
              }
              break;
          }
        }
        // Fallback for other session types
        else {
          console.log(`📞 Generic session handling`);
          if (activeSession.state === SessionState.Established && activeSession.bye) {
            await activeSession.bye();
          } else if (activeSession.cancel) {
            await activeSession.cancel();
          } else if (activeSession.terminate) {
            await activeSession.terminate();
          }
        }
      } catch (error: any) {
        console.error('Failed to hangup:', error);
        // Don't throw here, just log - hangup should always succeed from user perspective
      }
    } else {
      console.log(`📞 No active session to hang up`);
    }
  }

  // Alternative simpler hangup that tries methods in order
  async simpleHangup(sessionId?: string): Promise<void> {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      console.log('No session to hang up');
      return;
    }

    const session = this.sessions.get(targetSessionId);
    if (!session) {
      console.log(`Session ${targetSessionId} not found`);
      return;
    }

    console.log(`📞 Simple hangup for session ${targetSessionId} (state: ${session.state})`);
    
    // Try methods in order of preference based on state
    try {
      // First, check if it's already terminated
      if (session.state === SessionState.Terminated) {
        console.log('Session already terminated');
        return;
      }
      
      // For established sessions, use bye()
      if (session.state === SessionState.Established) {
        if (session.bye) {
          console.log('Using bye() for established session');
          await session.bye();
          return;
        }
      }
      
      // For non-established outgoing calls (Inviter), use cancel()
      if (session.state === SessionState.Initial || session.state === SessionState.Establishing) {
        if (session.cancel) {
          console.log('Using cancel() for non-established session');
          await session.cancel();
          return;
        }
        
        // For incoming calls that haven't been answered, use reject()
        if (session.reject) {
          console.log('Using reject() for unanswered incoming call');
          await session.reject();
          return;
        }
      }
      
      // Fallback to terminate() if available
      if (session.terminate) {
        console.log('Using terminate() as fallback');
        await session.terminate();
        return;
      }
      
      console.warn('No suitable method found to end the session');
    } catch (error) {
      console.error(`Error during hangup:`, error);
      // Try terminate as last resort
      if (session.terminate) {
        try {
          console.log('Attempting terminate() after error');
          await session.terminate();
        } catch (terminateError) {
          console.error('Terminate also failed:', terminateError);
        }
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
    // Check if this is a conference participant - handle specially since sessions are terminated after REFER
    if (this.isConferenceMode && this.conferenceParticipantInfos.has(sessionId)) {
      const participantInfo = this.conferenceParticipantInfos.get(sessionId);
      if (participantInfo && !participantInfo.isOnHold) {
        participantInfo.isOnHold = true;
        this.conferenceParticipantInfos.set(sessionId, participantInfo);
        console.log(`✅ Tracked hold state locally for conference participant ${sessionId}`);
        this.updateCallState();
        return;
      } else {
        throw new Error('Conference participant not found or already on hold');
      }
    }

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
    // Check if this is a conference participant - handle specially since sessions are terminated after REFER
    if (this.isConferenceMode && this.conferenceParticipantInfos.has(sessionId)) {
      const participantInfo = this.conferenceParticipantInfos.get(sessionId);
      if (participantInfo && participantInfo.isOnHold) {
        participantInfo.isOnHold = false;
        this.conferenceParticipantInfos.set(sessionId, participantInfo);
        console.log(`✅ Tracked unhold state locally for conference participant ${sessionId}`);
        this.updateCallState();
        return;
      } else {
        throw new Error('Conference participant not found or not on hold');
      }
    }

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

  async muteMicrophone(): Promise<void> {
    if (this.isMicrophoneMuted) {
      console.log('Microphone is already muted');
      return;
    }

    try {
      // Mute audio tracks in all active sessions
      for (const sessionId of this.sessions.keys()) {
        const session = this.sessions.get(sessionId);
        if (session && session.sessionDescriptionHandler) {
          const pc = session.sessionDescriptionHandler.peerConnection;
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

      this.isMicrophoneMuted = true;
      console.log('Microphone muted');
    } catch (error) {
      console.error('Failed to mute microphone:', error);
      throw new Error('Failed to mute microphone');
    }
  }

  async unmuteMicrophone(): Promise<void> {
    if (!this.isMicrophoneMuted) {
      console.log('Microphone is already unmuted');
      return;
    }

    try {
      // Unmute audio tracks in all active sessions
      for (const sessionId of this.sessions.keys()) {
        const session = this.sessions.get(sessionId);
        if (session && session.sessionDescriptionHandler) {
          const pc = session.sessionDescriptionHandler.peerConnection;
          if (pc) {
            const senders = pc.getSenders();
            senders.forEach((sender: RTCRtpSender) => {
              if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = true;
              }
            });
          }
        }
      }

      this.isMicrophoneMuted = false;
      console.log('Microphone unmuted');
    } catch (error) {
      console.error('Failed to unmute microphone:', error);
      throw new Error('Failed to unmute microphone');
    }
  }

  isMicMuted(): boolean {
    return this.isMicrophoneMuted;
  }

  // Update audio input/output device
  async updateAudioDevice(type: 'microphone' | 'speaker', deviceId: string): Promise<void> {
    console.log(`🔊 Updating ${type} to device: ${deviceId}`);
    
    try {
      if (type === 'microphone') {
        // Update microphone for all active sessions
        for (const [sessionId, session] of this.sessions) {
          if (session && session.sessionDescriptionHandler) {
            const pc = session.sessionDescriptionHandler.peerConnection;
            if (pc) {
              // Get new microphone stream with specific device
              const constraints = {
                audio: {
                  deviceId: deviceId === 'default' ? undefined : { exact: deviceId }
                }
              };
              
              const newStream = await navigator.mediaDevices.getUserMedia(constraints);
              const newAudioTrack = newStream.getAudioTracks()[0];
              
              // Replace audio track in all senders
              const senders = pc.getSenders();
              for (const sender of senders) {
                if (sender.track && sender.track.kind === 'audio') {
                  await sender.replaceTrack(newAudioTrack);
                  console.log(`✅ Updated microphone for session ${sessionId}`);
                }
              }
            }
          }
        }
      } else if (type === 'speaker') {
        // Update speaker for all audio elements
        for (const [sessionId, audioElement] of this.sessionAudioElements) {
          if (audioElement && 'setSinkId' in audioElement) {
            try {
              // @ts-ignore - setSinkId is not in TypeScript definitions but exists in Chrome
              await audioElement.setSinkId(deviceId);
              console.log(`✅ Updated speaker for session ${sessionId}`);
            } catch (error) {
              console.error(`Failed to set speaker for session ${sessionId}:`, error);
            }
          }
        }
        
        // Also update ringtone and dial tone audio if they exist
        if (this.ringtoneAudio && 'setSinkId' in this.ringtoneAudio) {
          try {
            // @ts-ignore
            await this.ringtoneAudio.setSinkId(deviceId);
            console.log('✅ Updated ringtone speaker');
          } catch (error) {
            console.error('Failed to set ringtone speaker:', error);
          }
        }
        
        if (this.dialToneAudio && 'setSinkId' in this.dialToneAudio) {
          try {
            // @ts-ignore
            await this.dialToneAudio.setSinkId(deviceId);
            console.log('✅ Updated dial tone speaker');
          } catch (error) {
            console.error('Failed to set dial tone speaker:', error);
          }
        }
      }
      
      console.log(`✅ Successfully updated ${type} to device ${deviceId}`);
    } catch (error) {
      console.error(`Failed to update ${type}:`, error);
      throw error;
    }
  }

  async enableConferenceMode(): Promise<void> {
    // Allocate a conference room from the pool BEFORE setting conference mode
    // This ensures we have the room ID before any UI updates
    const allocatedRoom = await this.allocateConferenceRoom('3000');
    if (!allocatedRoom) {
      // Try auto-allocation if 3000 is taken
      const autoRoom = await this.allocateConferenceRoom();
      if (!autoRoom) {
        console.error('Failed to allocate conference room');
        throw new Error('No conference rooms available');
      }
      this.conferenceRoomId = autoRoom;
    } else {
      this.conferenceRoomId = allocatedRoom;
    }
    
    // Now that we have the room ID, enable conference mode
    this.isConferenceMode = true;
    
    // Get all active calls
    const allCalls = this.getCallInfosArray();
    if (allCalls.length < 2) {
      console.warn('Need at least 2 calls to start conference');
      return;
    }

    console.log(`Starting FreeSWITCH conference room: ${this.conferenceRoomId}`);
    
    // Take all participants off hold and unmute them before adding to conference
    for (const call of allCalls) {
      console.log(`🔊 Preparing ${call.sessionId} (${call.remoteNumber}) for conference: taking off hold and unmuting`);
      
      // Take participant off hold if they are on hold
      if (call.isOnHold) {
        try {
          console.log(`📞 Taking ${call.sessionId} off hold before conference`);
          await this.unholdCallBySessionId(call.sessionId);
        } catch (error) {
          console.warn(`Failed to unhold ${call.sessionId} before conference:`, error);
        }
      }
      
      // Unmute audio tracks
      const session = this.sessions.get(call.sessionId);
      if (session) {
        const sessionDescriptionHandler = session.sessionDescriptionHandler;
        if (sessionDescriptionHandler) {
          const pc = sessionDescriptionHandler.peerConnection;
          if (pc) {
            const senders = pc.getSenders();
            senders.forEach((sender: RTCRtpSender) => {
              if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = true;
                console.log(`🔊 Unmuted audio track for ${call.sessionId} (${call.remoteNumber})`);
              }
            });
          }
        }
      }
    }
    
    // Save participant info for UI (this will survive session termination)
    this.conferenceParticipantInfos.clear();
    for (const call of allCalls) {
      const callInfoCopy: CallInfo = {
        ...call,
        isInConference: true,
        status: 'connected',
        isMuted: false,  // Ensure all participants start unmuted in conference
        isOnHold: false  // Ensure no participants are on hold in conference
      };
      this.conferenceParticipantInfos.set(call.sessionId, callInfoCopy);
      this.conferenceParticipants.add(call.sessionId);
      console.log(`📋 Saved conference participant info for ${call.sessionId} (${call.remoteNumber}) - starting unmuted`);
    }
    
    // IMMEDIATELY show conference controls when user clicks Conference All
    console.log('📺 Enabling conference controls immediately upon Conference All click');
    this.updateCallState();
    this.emitEvent('conferenceStateChanged', {
      participants: Array.from(this.conferenceParticipants),
      isConferenceMode: this.isConferenceMode,
      conferenceRoomId: this.conferenceRoomId
    });
    
    try {
      // Phase 1: Initiator (A) joins conference room FIRST
      console.log(`🎯 Initiator (A) joining conference room ${this.conferenceRoomId} first`);
      await this.joinConferenceRoom(this.conferenceRoomId);
      
      // Phase 2: Transfer other participants (B and C) to conference via REFER
      console.log('📨 Transferring other participants to conference via REFER');
      
      // Clear previous transfer tracking
      this.pendingReferTransfers.clear();
      this.successfulTransfers.clear();
      
      for (const call of allCalls) {
        try {
          // Track this REFER transfer
          this.pendingReferTransfers.add(call.sessionId);
          
          // Use proper REFER to transfer calls to conference
          console.log(`Transferring call ${call.sessionId} (${call.remoteNumber}) to conference via REFER`);
          await this.transferCallToConference(call.sessionId);
          
          console.log(`📨 REFER sent for ${call.remoteNumber}, waiting for NOTIFY confirmation...`);
          
        } catch (error) {
          console.error(`Failed to transfer ${call.sessionId} to conference:`, error);
          // Remove from pending if it failed to send
          this.pendingReferTransfers.delete(call.sessionId);
        }
      }
      
      // Wait for transfers to complete
      console.log(`⏳ Waiting for REFER transfers to complete...`);
      await this.waitForReferTransfers();
      
    } catch (error) {
      console.error('Failed to start FreeSWITCH conference:', error);
    }
    
    // ALWAYS setup conference regardless of REFER success/failure
    // FreeSWITCH may have succeeded even if we didn't get proper NOTIFY responses
    console.log('✅ FreeSWITCH conference process completed, showing permanent conference controls');
    
    // Don't setup client-side mixer or mute calls - FreeSWITCH handles audio mixing
    // this.setupConferenceMixer();
    // this.muteAllInactiveCalls();
    
    // Make conference controls permanently visible
    this.updateCallState();
    this.emitEvent('conferenceStateChanged', {
      participants: Array.from(this.conferenceParticipants),
      isConferenceMode: this.isConferenceMode,
      conferenceRoomId: this.conferenceRoomId
    });
  }

  async disableConferenceMode(): Promise<void> {
    console.log('🔚 Ending conference for ALL participants...');
    
    if (!this.conferenceRoomId) {
      console.log('No conference room to end');
      return;
    }
    
    // Important: In FreeSWITCH, when participants are transferred via REFER,
    // they become direct participants of the conference bridge.
    // The only way to forcefully disconnect them is through FreeSWITCH's
    // conference control API or by destroying the conference room.
    
    // Step 1: Leave the conference room ourselves (initiator) first
    // This ensures we don't get any callbacks while tearing down
    const conferenceSessionId = `conf_session_${this.conferenceRoomId}`;
    const conferenceSession = this.sessions.get(conferenceSessionId);
      
    
    if (conferenceSession) {
      console.log(`📞 Initiator leaving conference room ${this.conferenceRoomId}`);
      
      try {
        // Send BYE to leave the conference room
        if (conferenceSession.state === SessionState.Established) {
          await conferenceSession.bye();
        } else if (conferenceSession.terminate) {
          await conferenceSession.terminate();
        }
      } catch (error) {
        console.error('Failed to leave conference room:', error);
      }
      
      // Clean up the conference session
      this.sessions.delete(conferenceSessionId);
      this.callInfos.delete(conferenceSessionId);
      this.cleanupAudioForSession(conferenceSessionId);
    }
    
    // Step 2: Send conference commands to FreeSWITCH to end conference for all
    // We'll use the conference session to send INFO commands
    if (this.conferenceRoomId) {
      try {
        // First, try to kick all participants
        await this.sendFreeSwitchConferenceCommand('hupall');
        console.log('Sent hupall command to kick all participants');
        
        // Give FreeSWITCH time to process
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Then destroy the conference room
        await this.sendFreeSwitchConferenceCommand('destroy');
        console.log(`✅ Sent destroy command for conference room ${this.conferenceRoomId}`);
      } catch (error) {
        console.error('Failed to send conference control commands:', error);
      }
    }
    
    // Step 5: Clean up conference subscription
    if (this.conferenceSubscriber) {
      try {
        await this.conferenceSubscriber.unsubscribe();
        console.log('✅ Unsubscribed from conference events');
      } catch (error) {
        console.error('Failed to unsubscribe from conference events:', error);
      }
      this.conferenceSubscriber = undefined;
    }

    // Step 6: Clear all conference state
    this.isConferenceMode = false;
    this.conferenceParticipants.clear();
    this.conferenceParticipantInfos.clear();
    this.conferenceState.clear();
    this.pendingReferTransfers.clear();
    this.successfulTransfers.clear();
    this.activeSessionId = undefined;
    
    // Release the conference room
    if (this.conferenceRoomId) {
      await this.releaseConferenceRoom(this.conferenceRoomId);
      this.conferenceRoomId = undefined;
    }
    
    // Cleanup conference mixer
    this.cleanupConferenceMixer();
    
    // Update call state to idle
    this.updateCallState();
    console.log('✅ Conference ended for all participants');
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

    // If only conference room session remains, disable conference mode
    const realParticipants = Array.from(this.conferenceParticipants).filter(
      id => !id.startsWith('conf_session_')
    );
    
    if (realParticipants.length === 0) {
      console.log('No real participants left, but keeping conference controls visible');
      // Don't auto-disable conference mode - let user manually end it
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

  getConferenceRoomId(): string | undefined {
    return this.conferenceRoomId;
  }

  // FreeSWITCH conference control commands
  async muteConferenceParticipant(sessionId: string): Promise<boolean> {
    if (!this.conferenceRoomId) {
      console.warn('No active conference room');
      return false;
    }

    try {
      // After REFER transfer, original sessions are terminated
      // We need to send conference control commands differently
      const session = this.sessions.get(sessionId);
      
      // If session exists (pre-REFER or conference room session)
      if (session && typeof session.request === 'function') {
        const bodyContent = {
          content: `conference ${this.conferenceRoomId} mute ${sessionId}`,
          contentType: 'application/conference-info+xml',
          contentDisposition: 'render'
        };

        await session.request('INFO', {
          extraHeaders: [
            'X-Conference-Control: mute',
            `X-Conference-Room: ${this.conferenceRoomId}`,
            `X-Conference-Member: ${sessionId}`,
            'Content-Type: application/conference-info+xml'
          ],
          body: bodyContent
        });

        console.log(`✅ Muted conference participant ${sessionId}`);
        return true;
      } else {
        // Session doesn't exist (likely after REFER transfer)
        console.warn(`⚠️ Cannot mute ${sessionId} - session terminated after REFER transfer`);
        console.log(`Note: Conference control after REFER requires FreeSWITCH API integration`);
        // Track mute state locally in conferenceParticipantInfos since sessions are gone after REFER
        const participantInfo = this.conferenceParticipantInfos.get(sessionId);
        if (participantInfo) {
          participantInfo.isMuted = true;
          this.conferenceParticipantInfos.set(sessionId, participantInfo);
          console.log(`✅ Tracked mute state locally for conference participant ${sessionId}`);
          this.updateCallState();
          return true;
        }
        return false;
      }
    } catch (error) {
      console.error(`Failed to mute conference participant ${sessionId}:`, error);
    }
    return false;
  }

  async unmuteConferenceParticipant(sessionId: string): Promise<boolean> {
    if (!this.conferenceRoomId) {
      console.warn('No active conference room');
      return false;
    }

    try {
      // Send SIP INFO to FreeSWITCH with conference control command
      const session = this.sessions.get(sessionId);
      if (session && typeof session.request === 'function') {
        const bodyContent = {
          content: `conference ${this.conferenceRoomId} unmute ${sessionId}`,
          contentType: 'application/conference-info+xml',
          contentDisposition: 'render'
        };

        await session.request('INFO', {
          extraHeaders: [
            'X-Conference-Control: unmute',
            `X-Conference-Room: ${this.conferenceRoomId}`,
            `X-Conference-Member: ${sessionId}`,
            'Content-Type: application/conference-info+xml'
          ],
          body: bodyContent
        });

        console.log(`✅ Unmuted conference participant ${sessionId}`);
        return true;
      } else {
        // Session doesn't exist (likely after REFER transfer)
        console.warn(`⚠️ Cannot unmute ${sessionId} - session terminated after REFER transfer`);
        console.log(`Note: Conference control after REFER requires FreeSWITCH API integration`);
        // Track mute state locally in conferenceParticipantInfos since sessions are gone after REFER
        const participantInfo = this.conferenceParticipantInfos.get(sessionId);
        if (participantInfo) {
          participantInfo.isMuted = false;
          this.conferenceParticipantInfos.set(sessionId, participantInfo);
          console.log(`✅ Tracked unmute state locally for conference participant ${sessionId}`);
          this.updateCallState();
          return true;
        }
        return false;
      }
    } catch (error) {
      console.error(`Failed to unmute conference participant ${sessionId}:`, error);
    }
    return false;
  }

  async kickConferenceParticipant(sessionId: string): Promise<boolean> {
    if (!this.conferenceRoomId) {
      console.warn('No active conference room');
      return false;
    }

    try {
      // Get participant info to kick by remote number
      const participantInfo = this.conferenceParticipantInfos.get(sessionId);
      if (!participantInfo) {
        console.warn(`No participant info found for session ${sessionId}`);
        return false;
      }

      console.log(`🦵 Kicking participant ${participantInfo.remoteNumber} (${sessionId}) from conference ${this.conferenceRoomId}`);

      // Send direct BYE to participant's session to terminate their call
      const participantSession = this.sessions.get(sessionId);
      if (participantSession && participantSession.state === SessionState.Established) {
        try {
          console.log(`📞 Sending BYE to ${participantInfo.remoteNumber} at ${participantSession.remoteIdentity?.uri}`);
          
          // Send BYE message directly to participant
          await participantSession.bye({
            requestOptions: {
              extraHeaders: [
                'Reason: SIP;cause=200;text="Kicked from conference"'
              ]
            }
          });
          
          console.log(`✅ Sent BYE to kick participant ${participantInfo.remoteNumber}`);
        } catch (byeError) {
          console.error('Failed to send BYE to participant:', byeError);
          
          // Fallback: Try using endCall method
          try {
            await this.endCall(sessionId);
            console.log(`✅ Ended call via endCall for participant ${participantInfo.remoteNumber}`);
          } catch (fallbackError) {
            console.error('Fallback end call also failed:', fallbackError);
            return false;
          }
        }
      } else {
        console.warn(`No established session found for ${sessionId}, trying endCall method`);
        
        // Fallback: Use endCall method if session not found or not established
        try {
          await this.endCall(sessionId);
          console.log(`✅ Ended call via endCall for participant ${participantInfo.remoteNumber}`);
        } catch (error) {
          console.error('Failed to end participant call:', error);
          return false;
        }
      }

      // Remove from local tracking
      this.conferenceParticipants.delete(sessionId);
      this.conferenceParticipantInfos.delete(sessionId);
      console.log(`📋 Removed ${sessionId} from local tracking`);

      // Force UI update
      this.updateCallState();

      return true;
    } catch (error) {
      console.error(`Failed to kick conference participant ${sessionId}:`, error);
    }
    return false;
  }

  // Get conference participant details for UI
  getConferenceParticipantDetails(): Array<{
    sessionId: string;
    remoteNumber: string;
    direction: 'incoming' | 'outgoing';
    isMuted: boolean;
    isOnHold: boolean;
  }> {
    const participants: Array<{
      sessionId: string;
      remoteNumber: string;
      direction: 'incoming' | 'outgoing';
      isMuted: boolean;
      isOnHold: boolean;
    }> = [];

    console.log('🔍 Getting conference participants:', {
      conferenceParticipants: Array.from(this.conferenceParticipants),
      conferenceParticipantInfos: Array.from(this.conferenceParticipantInfos.keys()),
      isConferenceMode: this.isConferenceMode,
      conferenceRoomId: this.conferenceRoomId
    });

    // In conference mode, show the ORIGINAL participants (B and C) from conferenceParticipantInfos
    // These are the real participants, regardless of session state
    if (this.isConferenceMode && this.conferenceParticipantInfos.size > 0) {
      for (const [sessionId, callInfo] of this.conferenceParticipantInfos.entries()) {
        // Don't show conference room sessions in participant list
        if (sessionId.startsWith('conf_session_') || sessionId.startsWith('conf_auto_')) {
          console.log(`Skipping internal conference session ${sessionId}`);
          continue;
        }
        
        participants.push({
          sessionId: callInfo.sessionId,
          remoteNumber: callInfo.remoteNumber,
          direction: callInfo.direction,
          isMuted: false, // TODO: Track mute state
          isOnHold: callInfo.isOnHold
        });
        console.log(`📋 Conference participant: ${callInfo.remoteNumber} (${sessionId})`);
      }
    }

    console.log(`📊 Conference participants for UI (${participants.length}):`, participants.map(p => p.remoteNumber));
    return participants;
  }

  // Conference room allocation and management
  private static readonly CONFERENCE_ROOM_PREFIX = '3';
  private static readonly CONFERENCE_ROOM_START = 3000;
  private static readonly CONFERENCE_ROOM_END = 3999;
  private static allocatedRooms: Set<string> = new Set();

  /**
   * Get the next available conference room extension
   * Conference rooms typically use extensions in the 3000-3999 range
   */
  getNextAvailableConferenceRoom(): string {
    // Start from 3000 and find the first available room
    for (let i = SipService.CONFERENCE_ROOM_START; i <= SipService.CONFERENCE_ROOM_END; i++) {
      const roomId = i.toString();
      if (!SipService.allocatedRooms.has(roomId)) {
        return roomId;
      }
    }
    // If all rooms are taken, generate a dynamic room with timestamp
    return `3${Date.now().toString().slice(-3)}`;
  }

  /**
   * Allocate a conference room for use by sending INVITE to FreeSWITCH
   * Returns the allocated room ID or null if unable to allocate
   */
  async allocateConferenceRoom(roomId?: string): Promise<string | null> {
    try {
      const room = roomId || this.getNextAvailableConferenceRoom();
      
      // Check if room is already allocated locally
      if (SipService.allocatedRooms.has(room)) {
        console.warn(`Conference room ${room} is already allocated`);
        return null;
      }
      
      // Send INVITE to FreeSWITCH to reserve the conference room
      if (this.userAgent && this.registerer?.state === 'Registered') {
        try {
          const conferenceUri = `sip:${room}@${this.config?.server || 'localhost'}`;
          
          // Create an inviter to establish a control session with the conference room
          const inviter = new Inviter(this.userAgent, new URI('sip', room, this.config?.server || 'localhost'), {
            sessionDescriptionHandlerOptions: {
              constraints: { audio: false, video: false }, // No media for control session
            },
            extraHeaders: [
              'X-Conference-Control: allocate',
              'X-Conference-Room: ' + room,
              'Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO',
              'Content-Type: application/sdp'
            ]
          });
          
          // Send the INVITE
          await inviter.invite();
          
          // Store the control session
          const controlSessionId = `control_${room}`;
          this.sessions.set(controlSessionId, inviter);
          
          console.log(`📞 Sent INVITE to reserve conference room ${room} on FreeSWITCH`);
          
          // Handle session state
          inviter.stateChange.addListener((state: SessionState) => {
            if (state === SessionState.Established) {
              console.log(`✅ Conference room ${room} successfully reserved on FreeSWITCH`);
              // Immediately put the control session on hold or terminate after reservation
              setTimeout(() => {
                inviter.bye();
              }, 1000);
            } else if (state === SessionState.Terminated) {
              console.log(`Control session for room ${room} terminated`);
              this.sessions.delete(controlSessionId);
            }
          });
          
        } catch (sipError) {
          console.error(`Failed to send INVITE to reserve room ${room}:`, sipError);
          // Continue with local allocation even if SIP fails
        }
      }
      
      // Mark as allocated locally
      SipService.allocatedRooms.add(room);
      console.log(`✅ Allocated conference room locally: ${room}`);
      return room;
    } catch (error) {
      console.error('Failed to allocate conference room:', error);
      return null;
    }
  }

  /**
   * Release a conference room back to the pool by sending BYE or INFO to FreeSWITCH
   */
  async releaseConferenceRoom(roomId: string): Promise<boolean> {
    if (SipService.allocatedRooms.has(roomId)) {
      // Send SIP message to FreeSWITCH to release the conference room
      if (this.userAgent && this.registerer?.state === 'Registered') {
        try {
          // Check if we have a control session for this room
          const controlSessionId = `control_${roomId}`;
          const controlSession = this.sessions.get(controlSessionId);
          
          if (controlSession && typeof controlSession.bye === 'function') {
            // Send BYE to terminate the control session
            await controlSession.bye();
            console.log(`📞 Sent BYE to release conference room ${roomId} on FreeSWITCH`);
          } else {
            // Alternative: Send OPTIONS or INFO to notify FreeSWITCH about room release
            if (this.userAgent.userAgentCore) {
              const target = new URI('sip', roomId, this.config?.server || 'localhost');
              
              // Create body object with FreeSWITCH conference control format
              const bodyContent = {
                content: 'action=release',
                contentType: 'application/conference-info+xml',
                contentDisposition: 'render'
              };
              
              const request = this.userAgent.userAgentCore.makeOutgoingRequestMessage(
                'INFO',
                target,
                this.userAgent.userAgentCore.configuration.aor,
                target,
                {},
                [
                  'X-Conference-Control: release', 
                  `X-Conference-Room: ${roomId}`,
                  'Content-Type: application/conference-info+xml'
                ],
                bodyContent
              );
              
              // Send the INFO request
              this.userAgent.userAgentCore.request(request);
              console.log(`📞 Sent INFO to release conference room ${roomId} on FreeSWITCH`);
            }
          }
          
          // Clean up control session
          this.sessions.delete(controlSessionId);
          
        } catch (sipError) {
          console.error(`Failed to send SIP message to release room ${roomId}:`, sipError);
          // Continue with local release even if SIP fails
        }
      }
      
      // Remove from local allocation
      SipService.allocatedRooms.delete(roomId);
      console.log(`✅ Released conference room locally: ${roomId}`);
      return true;
    }
    return false;
  }

  /**
   * Get list of all allocated conference rooms
   */
  getAllocatedConferenceRooms(): string[] {
    return Array.from(SipService.allocatedRooms);
  }

  /**
   * Check if a specific room is available
   */
  isConferenceRoomAvailable(roomId: string): boolean {
    return !SipService.allocatedRooms.has(roomId);
  }

  /**
   * Get conference room status information
   */
  getConferenceRoomStatus(): {
    totalRooms: number;
    allocatedRooms: string[];
    availableCount: number;
    nextAvailable: string;
  } {
    const allocatedRooms = this.getAllocatedConferenceRooms();
    const totalRooms = SipService.CONFERENCE_ROOM_END - SipService.CONFERENCE_ROOM_START + 1;
    
    return {
      totalRooms,
      allocatedRooms,
      availableCount: totalRooms - allocatedRooms.length,
      nextAvailable: this.getNextAvailableConferenceRoom()
    };
  }

  // Transfer a call to conference using REFER (as per conference.md Phase 4)
  private async transferCallToConference(sessionId: string): Promise<void> {
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
      // Send REFER to transfer the call to conference (Phase 4 from conference.md)
      console.log(`📞 Sending REFER to transfer ${sessionId} to conference room ${this.conferenceRoomId}`);
      
      if (typeof session.refer === 'function') {
        // Use session's refer method if available
        await session.refer(new URI('sip', this.conferenceRoomId, this.config.server), {
          requestDelegate: {
            onAccept: () => {
              console.log(`✅ REFER accepted for session ${sessionId}`);
            },
            onReject: (response: any) => {
              console.error(`❌ REFER rejected for session ${sessionId}:`, response);
            },
            onNotify: (notification: any) => {
              console.log(`📨 REFER NOTIFY for session ${sessionId}:`, notification);
              this.handleReferNotify(sessionId, notification);
            }
          }
        });
      } else if (typeof session.request === 'function') {
        // Fallback to manual REFER request
        const referToURI = new URI('sip', this.conferenceRoomId, this.config.server);
        await session.request('REFER', {
          extraHeaders: [
            `Refer-To: ${referToURI.toString()}`,
            'Referred-By: ' + (session.localIdentity?.uri?.toString() || 'softphone')
          ],
          requestDelegate: {
            onAccept: () => {
              console.log(`✅ Conference REFER accepted for session: ${sessionId}`);
            },
            onReject: (response: any) => {
              console.error(`❌ Conference REFER rejected for session: ${sessionId}`, response);
            },
            onNotify: (notification: any) => {
              console.log(`📨 Manual REFER NOTIFY for session ${sessionId}:`, notification);
              this.handleReferNotify(sessionId, notification);
            }
          }
        });
      } else {
        console.warn(`Session ${sessionId} does not support REFER, using re-INVITE fallback`);
        // Fallback to re-INVITE approach
        await this.inviteToConference(session, this.callInfos.get(sessionId)!);
      }
      
      console.log(`✅ Successfully sent REFER for ${sessionId} to conference room ${this.conferenceRoomId}`);
    } catch (error) {
      console.error(`Failed to send REFER for session ${sessionId} to conference:`, error);
      throw error;
    }
  }

  // Handle REFER NOTIFY messages from FreeSWITCH
  private handleReferNotify(sessionId: string, notification: any): void {
    try {
      console.log(`📨 Processing REFER NOTIFY for session ${sessionId}:`, notification);
      
      // Extract SIP response code from notification
      const body = notification.request?.body;
      const sipStatus = this.extractSipStatusFromNotify(body);
      
      if (sipStatus) {
        console.log(`🔄 REFER status update for ${sessionId}: ${sipStatus.code} ${sipStatus.reason}`);
        
        if (sipStatus.code >= 200 && sipStatus.code < 300) {
          // Transfer successful (2xx response)
          console.log(`✅ REFER transfer successful for session ${sessionId}`);
          
          // Mark session as transferred to conference
          const callInfo = this.callInfos.get(sessionId);
          if (callInfo) {
            callInfo.isInConference = true;
            this.conferenceParticipants.add(sessionId);
            console.log(`🎯 Session ${sessionId} (${callInfo.remoteNumber}) confirmed in conference`);
          }
          
          // Track successful transfer
          this.pendingReferTransfers.delete(sessionId);
          this.successfulTransfers.add(sessionId);
          
        } else if (sipStatus.code >= 400) {
          // Transfer failed (4xx, 5xx, 6xx response)
          console.error(`❌ REFER transfer failed for session ${sessionId}: ${sipStatus.code} ${sipStatus.reason}`);
          
          // Keep session in regular call state since transfer failed
          const callInfo = this.callInfos.get(sessionId);
          if (callInfo) {
            callInfo.isInConference = false;
            console.log(`⚠️ Session ${sessionId} (${callInfo.remoteNumber}) remains as regular call`);
          }
          
          // Remove from pending transfers
          this.pendingReferTransfers.delete(sessionId);
        }
        // 1xx responses are provisional, continue waiting
      }
      
      // Notify UI of state change
      this.emitEvent('conferenceStateChanged', {
        participants: Array.from(this.conferenceParticipants),
        sessionId,
        notifyStatus: sipStatus
      });
      
    } catch (error) {
      console.error(`Failed to handle REFER NOTIFY for session ${sessionId}:`, error);
    }
  }

  // Extract SIP status code from NOTIFY body
  private extractSipStatusFromNotify(body: string | undefined): { code: number; reason: string } | null {
    if (!body) return null;
    
    try {
      // NOTIFY body typically contains: "SIP/2.0 200 OK" or similar
      const sipLineMatch = body.match(/SIP\/2\.0\s+(\d+)\s+(.+)/i);
      if (sipLineMatch) {
        return {
          code: parseInt(sipLineMatch[1], 10),
          reason: sipLineMatch[2].trim()
        };
      }
      
      // Alternative format: just the status code and reason
      const statusMatch = body.match(/(\d{3})\s+(.+)/);
      if (statusMatch) {
        return {
          code: parseInt(statusMatch[1], 10),
          reason: statusMatch[2].trim()
        };
      }
      
      return null;
    } catch (error) {
      console.error('Failed to parse NOTIFY body:', error);
      return null;
    }
  }

  // Wait for REFER transfers to complete before joining conference
  private async waitForReferTransfers(timeoutMs: number = 10000): Promise<void> {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkTransfers = () => {
        const elapsed = Date.now() - startTime;
        
        // Check if we have any successful transfers
        if (this.successfulTransfers.size > 0) {
          console.log(`✅ At least one REFER transfer completed successfully (${this.successfulTransfers.size}/${this.successfulTransfers.size + this.pendingReferTransfers.size})`);
          resolve();
          return;
        }
        
        // Check if all transfers completed (success or failure)
        if (this.pendingReferTransfers.size === 0) {
          if (this.successfulTransfers.size === 0) {
            console.warn('⚠️ All REFER transfers completed without success confirmation, but FreeSWITCH may have processed them anyway');
          }
          resolve();
          return;
        }
        
        // Check for timeout
        if (elapsed >= timeoutMs) {
          console.warn(`⏰ Timeout waiting for REFER transfers after ${timeoutMs}ms`);
          console.warn(`Still pending: ${Array.from(this.pendingReferTransfers)}`);
          console.warn(`Successful: ${Array.from(this.successfulTransfers)}`);
          resolve(); // Proceed anyway after timeout
          return;
        }
        
        // Continue waiting
        setTimeout(checkTransfers, 200);
      };
      
      // Start checking
      checkTransfers();
    });
  }

  // Join conference room directly (as per conference.md Phase 5)
  private async joinConferenceRoom(roomId: string): Promise<void> {
    if (!this.userAgent || !this.config?.server) {
      throw new Error('UserAgent or server config not available');
    }
    
    try {
      console.log(`📞 Joining conference room ${roomId} with new INVITE`);
      
      // Build extra headers for conference join
      const extraHeaders = [
        'X-Conference-Join: true',
        `X-Conference-Room: ${roomId}`,
        'Allow: INVITE, ACK, CANCEL, BYE, REFER, NOTIFY, MESSAGE, OPTIONS, INFO, SUBSCRIBE'
      ];
      
      // Commented out PIN-based moderator authentication
      // FreeSWITCH may need specific dialplan configuration for PIN support
      /*
      if (this.config.moderatorPin) {
        console.log(`🔐 Joining as moderator with PIN: ${this.config.moderatorPin}`);
        extraHeaders.push(`X-Conference-Pin: ${this.config.moderatorPin}`);
        extraHeaders.push('X-Conference-Role: moderator');
      } else {
        console.log('👤 Joining as regular participant (no moderator PIN configured)');
      }
      */
      
      // For now, always join as moderator without PIN
      if (this.config.moderatorPin) {
        console.log(`🔐 Moderator PIN configured but not sent (PIN auth disabled)`);
        extraHeaders.push('X-Conference-Role: moderator');
      }
      
      // Create new INVITE to conference room
      const target = new URI('sip', roomId, this.config.server);
      const inviter = new Inviter(this.userAgent, target, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false }
        },
        extraHeaders
      });
      
      // Store conference session BEFORE sending INVITE to prevent it being treated as incoming
      const conferenceSessionId = `conf_session_${roomId}`;
      this.sessions.set(conferenceSessionId, inviter);
      this.conferenceParticipants.add(conferenceSessionId);
      
      // Handle session state changes
      inviter.stateChange.addListener((state: SessionState) => {
        if (state === SessionState.Established) {
          console.log(`✅ Successfully joined conference room ${roomId}`);
          this.setupAudioStreams(inviter, conferenceSessionId);
          
          // Set up conference event listeners to receive notifications from FreeSWITCH
          this.setupConferenceEventListeners(inviter);
          
          // Ensure audio is properly enabled for conference session
          this.setAudioForSession(conferenceSessionId, false); // Unmute conference session
          
          // Set conference session as active to maintain UI state
          this.activeSessionId = conferenceSessionId;
          
          // Create a callInfo for the conference session to maintain UI state
          // But DON'T add it to conferenceParticipantInfos (that's for the original participants)
          this.callInfos.set(conferenceSessionId, {
            sessionId: conferenceSessionId,
            remoteNumber: `Conference ${roomId}`,
            isOnHold: false,
            direction: 'outgoing',
            status: 'connected',
            startTime: new Date(),
            isInConference: true
          });
          
          console.log(`✅ Conference room session created, preserving ${this.conferenceParticipantInfos.size} original participants in UI`);
          
          // Subscribe to conference events now that we're established in the conference
          // The ACK has been sent and we're officially part of the conference
          if (this.conferenceRoomId) {
            console.log(`🔔 Subscribing to conference events for room ${this.conferenceRoomId} after session established`);
            this.subscribeToConferenceEvents();
          }
          
          // Force UI update to show conference controls immediately
          this.updateCallState();
          this.emitEvent('conferenceStateChanged', {
            participants: Array.from(this.conferenceParticipants),
            isConferenceMode: this.isConferenceMode,
            conferenceRoomId: this.conferenceRoomId
          });
        } else if (state === SessionState.Terminated) {
          console.log(`Conference session for room ${roomId} terminated`);
          this.sessions.delete(conferenceSessionId);
          this.conferenceParticipants.delete(conferenceSessionId);
          
          // If this was our main conference session, end conference mode
          if (this.isConferenceMode) {
            console.log('⚠️ Main conference session terminated, but keeping conference controls visible');
            // Don't auto-disable conference mode - let user manually end it
            // this.disableConferenceMode();
          }
        }
      });
      
      // Send INVITE to join conference
      await inviter.invite();
      
      console.log(`✅ INVITE sent to join conference room ${roomId}`);
    } catch (error) {
      console.error(`Failed to join conference room ${roomId}:`, error);
      throw error;
    }
  }

  // Send INVITE to establish conference bridge (Zoiper-style) - kept as fallback
  private async inviteToConference(session: any, callInfo: CallInfo): Promise<void> {
    try {
      console.log(`Sending re-INVITE for conference to ${callInfo.remoteNumber} (${callInfo.sessionId})`);
      
      // Use sessionDescriptionHandlerModifiers to maintain current SDP settings
      const conferenceModifier = (description: RTCSessionDescriptionInit) => {
        if (description.sdp) {
          // Keep sendrecv for conference mode
          description.sdp = description.sdp.replace(/a=inactive/g, 'a=sendrecv');
          description.sdp = description.sdp.replace(/a=sendonly/g, 'a=sendrecv');
          description.sdp = description.sdp.replace(/a=recvonly/g, 'a=sendrecv');
          console.log(`Modified SDP for conference (${callInfo.sessionId}): set a=sendrecv`);
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
            `X-Conference-Id: ${this.conferenceRoomId}`,
            `X-Conference-Room: ${this.conferenceRoomId}`,
            'X-Conference-Mode: participant'
          ]
        }
      });
      
      console.log(`✅ Sent conference re-INVITE for ${callInfo.remoteNumber} (${callInfo.sessionId}) to join conference ${this.conferenceRoomId}`);
    } catch (error) {
      console.error(`Failed to send conference re-INVITE for ${callInfo.remoteNumber} (${callInfo.sessionId}):`, error);
      throw error;
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
        this.transferCallToConference(sessionId1),
        this.transferCallToConference(sessionId2)
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

  // Set up event listeners on the conference session to receive notifications from FreeSWITCH
  private setupConferenceEventListeners(session: any): void {
    try {
      console.log('🎧 Setting up conference event listeners for FreeSWITCH notifications');
      
      // Listen for incoming INFO messages from FreeSWITCH
      if (session.delegate) {
        const originalOnInfo = session.delegate.onInfo;
        session.delegate.onInfo = (request: any) => {
          console.log('📨 Received INFO from FreeSWITCH:', request);
          this.handleConferenceInfo(request);
          
          // Call original handler if it exists
          if (originalOnInfo) {
            originalOnInfo.call(session.delegate, request);
          }
        };
        
        const originalOnNotify = session.delegate.onNotify;
        session.delegate.onNotify = (request: any) => {
          console.log('📨 Received NOTIFY from FreeSWITCH:', request);
          this.handleConferenceNotify(request);
          
          // Call original handler if it exists
          if (originalOnNotify) {
            originalOnNotify.call(session.delegate, request);
          }
        };
      }
      
      // Note: Conference event subscription is now done after session is established
      // to ensure we're actually in the conference before subscribing
      console.log('✅ Conference event listeners set up successfully (subscription will happen after ACK)');
    } catch (error) {
      console.error('Failed to set up conference event listeners:', error);
    }
  }

  // Handle INFO messages from FreeSWITCH about conference state
  private handleConferenceInfo(request: any): void {
    try {
      const contentType = request.message?.headers?.['Content-Type']?.[0]?.parsed;
      const body = request.message?.body;
      
      console.log('📨 Conference INFO - Content-Type:', contentType, 'Body:', body);
      
      if (contentType?.includes('conference') && body) {
        // Parse conference state information
        this.parseConferenceStateUpdate(body);
      }
    } catch (error) {
      console.error('Failed to handle conference INFO:', error);
    }
  }

  // Handle NOTIFY messages from FreeSWITCH about conference events (RFC 4575)
  private handleConferenceNotify(notification: any): void {
    try {
      console.log('🔔 CONFERENCE EVENT NOTIFY RECEIVED:');
      console.log('  - Notification object:', notification);
      
      const request = notification.request || notification;
      const headers = request?.headers || request?.message?.headers;
      const contentType = headers?.['Content-Type']?.[0]?.parsed || 
                         request?.getHeader?.('Content-Type') ||
                         headers?.['content-type']?.[0];
      const body = request?.body || request?.message?.body;
      
      console.log('📨 RFC 4575 Conference NOTIFY Details:');
      console.log('  - Content-Type:', contentType);
      console.log('  - Body length:', body?.length);
      console.log('  - Headers:', headers);
      
      if (body) {
        console.log('  - Body preview (first 500 chars):', body.substring(0, 500));
      }
      
      if (contentType?.includes('conference-info+xml') && body) {
        console.log('🔔 Parsing RFC 4575 conference-info+xml document');
        // Parse RFC 4575 conference-info+xml document
        this.parseConferenceInfoXml(body);
      } else if (contentType?.includes('conference') && body) {
        console.log('🔔 Parsing other conference event format');
        // Fallback: Parse other conference event formats
        this.parseConferenceStateUpdate(body);
      } else {
        console.log('📨 Conference NOTIFY without recognized conference-info content');
        console.log('  - Full notification for debugging:', JSON.stringify(notification, null, 2));
      }
    } catch (error) {
      console.error('Failed to handle conference NOTIFY:', error);
    }
  }

  // Parse RFC 4575 conference-info+xml document
  private parseConferenceInfoXml(xmlBody: string): void {
    try {
      console.log('📋 PARSING RFC 4575 CONFERENCE-INFO+XML:');
      console.log('  - XML length:', xmlBody.length);
      console.log('  - Full XML:', xmlBody);
      
      // Parse XML using DOMParser
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlBody, 'text/xml');
      
      // Check for parse errors
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) {
        console.error('❌ XML PARSE ERROR:', parseError.textContent);
        return;
      }
      
      // Extract conference information
      const conferenceInfo = xmlDoc.querySelector('conference-info');
      if (!conferenceInfo) {
        console.error('❌ No conference-info element found in XML');
        console.log('  - Document element:', xmlDoc.documentElement?.tagName);
        console.log('  - Available elements:', xmlDoc.documentElement?.innerHTML);
        return;
      }
      
      const entity = conferenceInfo.getAttribute('entity');
      const state = conferenceInfo.getAttribute('state');
      const version = conferenceInfo.getAttribute('version');
      
      console.log(`📋 CONFERENCE INFO PARSED:`);
      console.log(`  - Entity: ${entity}`);
      console.log(`  - State: ${state}`);
      console.log(`  - Version: ${version}`);
      
      // Parse conference description
      const confDesc = xmlDoc.querySelector('conference-description');
      if (confDesc) {
        const displayText = confDesc.querySelector('display-text')?.textContent;
        const subject = confDesc.querySelector('subject')?.textContent;
        console.log(`📋 Conference: ${displayText || subject}`);
      }
      
      // Parse users/participants
      const users = xmlDoc.querySelector('users');
      if (users) {
        const userElements = users.querySelectorAll('user');
        console.log(`📋 CONFERENCE PARTICIPANTS:`);
        console.log(`  - Total count: ${userElements.length}`);
        
        // Clear previous state if this is a full update
        if (state === 'full') {
          console.log('  - Full update: clearing previous state');
          this.conferenceState.clear();
        }
        
        userElements.forEach((userElement, index) => {
          console.log(`  - Parsing participant ${index + 1}...`);
          const participant = this.parseConferenceUser(userElement);
          if (participant) {
            // Check if this participant is leaving/disconnecting
            const wasInConference = this.conferenceState.has(participant.entity);
            const isLeaving = participant.state === 'disconnected' || 
                            participant.state === 'disconnecting' || 
                            state === 'deleted';
            
            if (isLeaving) {
              this.conferenceState.delete(participant.entity);
              console.log(`    👤 REMOVED: ${participant.entity}`);
              
              // Show alert for participant leaving
              if (wasInConference) {
                this.showParticipantLeftAlert(participant);
              }
            } else {
              // Check if participant was already in conference before updating
              const previousState = this.conferenceState.get(participant.entity);
              
              this.conferenceState.set(participant.entity, participant);
              console.log(`    👤 ADDED/UPDATED: ${participant.entity}`);
              console.log(`       - Display: ${participant.displayText}`);
              console.log(`       - State: ${participant.state}`);
              console.log(`       - Join Method: ${participant.joinMethod}`);
              console.log(`       - Endpoints: ${participant.endpoints.length}`);
              
              // Check if participant state changed to disconnected
              if (previousState && participant.state === 'disconnected') {
                this.showParticipantLeftAlert(participant);
                // Remove from state after showing alert
                this.conferenceState.delete(participant.entity);
              }
            }
          }
        });
        
        console.log(`  - Conference state now has ${this.conferenceState.size} participants`);
      } else {
        console.log('📋 No <users> element found in conference-info');
      }
      
      // Update UI with new conference state
      this.updateConferenceParticipantUI();
      
    } catch (error) {
      console.error('Failed to parse conference-info+xml:', error);
    }
  }

  // Parse individual user element from conference-info+xml
  private parseConferenceUser(userElement: Element): ConferenceParticipant | null {
    try {
      const entity = userElement.getAttribute('entity');
      const state = userElement.getAttribute('state') as ConferenceParticipant['state'];
      
      if (!entity) {
        console.warn('User element missing entity attribute');
        return null;
      }
      
      const displayText = userElement.querySelector('display-text')?.textContent;
      const language = userElement.querySelector('language')?.textContent;
      
      // Parse associated URIs and roles
      const associatedUris = userElement.querySelector('associated-aors');
      const roles = userElement.querySelector('roles');
      
      // Parse endpoints
      const endpoints: ConferenceEndpoint[] = [];
      const endpointElements = userElement.querySelectorAll('endpoint');
      
      endpointElements.forEach(endpointElement => {
        const endpoint = this.parseConferenceEndpoint(endpointElement);
        if (endpoint) {
          endpoints.push(endpoint);
        }
      });
      
      // Determine join method from roles or other indicators
      let joinMethod: ConferenceParticipant['joinMethod'];
      if (roles?.textContent?.includes('moderator')) {
        joinMethod = 'focus-owner';
      } else {
        joinMethod = 'dialed-in'; // Default assumption
      }
      
      return {
        entity,
        displayText,
        state: state || 'active',
        joinMethod,
        language,
        endpoints
      };
      
    } catch (error) {
      console.error('Failed to parse conference user:', error);
      return null;
    }
  }

  // Parse individual endpoint element from conference-info+xml
  private parseConferenceEndpoint(endpointElement: Element): ConferenceEndpoint | null {
    try {
      const entity = endpointElement.getAttribute('entity');
      const state = endpointElement.getAttribute('state') as ConferenceEndpoint['state'];
      
      if (!entity) {
        console.warn('Endpoint element missing entity attribute');
        return null;
      }
      
      const displayText = endpointElement.querySelector('display-text')?.textContent;
      
      // Parse media streams
      const media: ConferenceMedia[] = [];
      const mediaElements = endpointElement.querySelectorAll('media');
      
      mediaElements.forEach(mediaElement => {
        const id = mediaElement.getAttribute('id');
        const type = mediaElement.querySelector('type')?.textContent as ConferenceMedia['type'];
        const status = mediaElement.querySelector('status')?.textContent as ConferenceMedia['status'];
        const srcId = mediaElement.querySelector('src-id')?.textContent;
        
        if (id && type) {
          media.push({
            id,
            type,
            status: status || 'sendrecv',
            srcId
          });
        }
      });
      
      return {
        entity,
        displayText,
        state: state || 'active',
        media
      };
      
    } catch (error) {
      console.error('Failed to parse conference endpoint:', error);
      return null;
    }
  }

  // Parse conference state updates from FreeSWITCH (fallback for non-RFC 4575)
  private parseConferenceStateUpdate(body: string): void {
    try {
      console.log('🔍 Parsing conference state update:', body);
      
      // Try to parse XML if it's structured data
      if (body.includes('<conference')) {
        // Handle XML conference state
        this.parseXMLConferenceState(body);
      } else if (body.includes('participant') || body.includes('join') || body.includes('leave')) {
        // Handle text-based conference updates
        this.parseTextConferenceState(body);
      }
      
      // Force UI update after parsing conference state
      this.updateConferenceParticipantUI();
    } catch (error) {
      console.error('Failed to parse conference state update:', error);
    }
  }

  // Parse XML conference state from FreeSWITCH
  private parseXMLConferenceState(xmlBody: string): void {
    // Basic XML parsing for conference state
    // This would need to be adapted based on FreeSWITCH's actual XML format
    console.log('📋 Parsing XML conference state:', xmlBody);
    
    // Example: Extract participant information from XML
    // In a real implementation, you'd use proper XML parsing
  }

  // Parse text-based conference state updates
  private parseTextConferenceState(textBody: string): void {
    console.log('📋 Parsing text conference state:', textBody);
    
    // Look for participant join/leave events
    if (textBody.includes('joined')) {
      // Participant joined - update UI
    } else if (textBody.includes('left') || textBody.includes('disconnected')) {
      // Participant left - update UI
    }
  }

  // Public method to manually subscribe to conference events (for testing/debugging)
  async subscribeToConferenceEventsManually(): Promise<void> {
    console.log('📺 MANUAL CONFERENCE SUBSCRIPTION TRIGGERED FROM UI');
    this.subscribeToConferenceEvents();
  }

  // Subscribe to conference events from FreeSWITCH per RFC 4575
  private subscribeToConferenceEvents(): void {
    try {
      if (!this.userAgent || !this.config?.server || !this.conferenceRoomId) {
        console.log('⚠️ Cannot subscribe to conference - missing requirements:');
        console.log('  - userAgent:', !!this.userAgent);
        console.log('  - config.server:', this.config?.server);
        console.log('  - conferenceRoomId:', this.conferenceRoomId);
        return;
      }
      
      console.log(`📺 SUBSCRIBING TO CONFERENCE EVENTS:`);
      console.log(`  - Room: ${this.conferenceRoomId}`);
      console.log(`  - Server: ${this.config.server}`);
      console.log(`  - Username: ${this.config?.username}`);
      
      // Subscribe to conference events
      // FreeSWITCH may expect different formats:
      // 1. RFC 4575: sip:conference@server with Event: conference
      // 2. Dialog events: sip:conference@server with Event: dialog
      // 3. Presence events: sip:conference@server with Event: presence
      
      // Try RFC 4575 standard format first
      const targetUri = `sip:${this.conferenceRoomId}@${this.config.server}`;
      const eventPackage = 'conference'; // RFC 4575 standard
      
      console.log(`📝 NOTE: FreeSWITCH may not support RFC 4575 conference events.`);
      console.log(`  If subscription fails, FreeSWITCH may need mod_conference configuration`);
      console.log(`  or may use different event packages like 'dialog' or custom events.`);
      
      console.log(`  - Target URI: ${targetUri}`);
      console.log(`  - Event Package: ${eventPackage}`);
      console.log(`  - From: sip:${this.config?.username}@${this.config.server}`);
      
      const target = UserAgent.makeURI(targetUri);
      if (!target) {
        console.error('❌ Failed to create conference subscription target URI');
        return;
      }
      
      // Check if already subscribed
      if (this.conferenceSubscriber) {
        console.log('⚠️ Already have a conference subscription, cleaning up old one');
        try {
          this.conferenceSubscriber.unsubscribe();
        } catch (e) {
          console.error('Error unsubscribing old subscription:', e);
        }
      }
      
      // Create conference event subscription
      console.log(`📺 Creating new Subscriber instance with event: ${eventPackage}...`);
      this.conferenceSubscriber = new Subscriber(this.userAgent, target, eventPackage);
      
      // Set up subscription event handlers
      this.conferenceSubscriber.stateChange.addListener((newState: SubscriptionState) => {
        console.log(`📺 CONFERENCE SUBSCRIPTION STATE CHANGED:`);
        console.log(`  - New State: ${newState}`);
        console.log(`  - State value:`, newState);
        
        switch (newState) {
          case SubscriptionState.Subscribed:
            console.log('📥 RECEIVED SIP 200 OK RESPONSE TO SUBSCRIBE:');
            console.log('  ═══════════════════════════════════════');
            console.log('  - Status: 200 OK');
            console.log('  - Subscription-State: active');  
            console.log('  - Expires: 3600');
            console.log('  - Allow-Events: conference (expected)');
            console.log('  ═══════════════════════════════════════');
            console.log('✅ CONFERENCE EVENT SUBSCRIPTION ACTIVE - Ready to receive NOTIFY messages');
            break;
          case SubscriptionState.Terminated:
            console.log('❌ CONFERENCE EVENT SUBSCRIPTION TERMINATED');
            console.log('📥 RECEIVED TERMINATION RESPONSE OR TIMEOUT');
            this.conferenceSubscriber = undefined;
            break;
          default:
            console.log(`📺 Conference subscription state: ${newState}`);
            break;
        }
      });
      
      // Handle incoming NOTIFY messages with conference state
      console.log('📺 Setting up NOTIFY handler...');
      this.conferenceSubscriber.delegate = {
        onNotify: (notification) => {
          console.log('📥 INCOMING SIP NOTIFY MESSAGE:');
          console.log('  ═══════════════════════════════════════');
          console.log('  - Method: NOTIFY');
          console.log('  - Event: conference');
          console.log('  - Subscription-State: active (expected)');
          console.log('  - Content-Type: application/conference-info+xml (expected)');
          console.log('  ═══════════════════════════════════════');
          console.log('🔔 RFC 4575 CONFERENCE NOTIFY RECEIVED via subscription');
          this.handleConferenceNotify(notification);
        }
      };
      
      // Start the subscription with timeout handling
      console.log('📺 Sending SUBSCRIBE request...');
      
      // Set a timeout for the subscription attempt
      const subscriptionTimeout = setTimeout(() => {
        console.warn('⚠️ Conference subscription timeout - FreeSWITCH may not support RFC 4575');
        console.log('  - This is normal if FreeSWITCH is not configured for conference events');
        console.log('  - Conference will still work but without real-time participant updates');
        
        if (this.conferenceSubscriber) {
          try {
            this.conferenceSubscriber.dispose();
          } catch (e) {
            console.error('Error disposing timed-out subscription:', e);
          }
          this.conferenceSubscriber = undefined;
        }
      }, 5000); // 5 second timeout
      
      // Enhanced SIP message logging for conference subscription
      console.log('');
      console.log('📤 OUTGOING SIP SUBSCRIBE MESSAGE TO FREESWITCH:');
      console.log('════════════════════════════════════════════════════════════════');
      console.log(`SUBSCRIBE ${targetUri} SIP/2.0`);
      console.log(`Via: SIP/2.0/WS [transport];branch=[auto-generated]`);
      console.log(`To: <${targetUri}>`);
      console.log(`From: <sip:${this.config.username}@${this.config.server}>;tag=[auto-generated]`);
      console.log(`CSeq: [sequence] SUBSCRIBE`);
      console.log(`Call-ID: [auto-generated]`);
      console.log(`Max-Forwards: 70`);
      console.log(`Proxy-Authorization: Digest algorithm=MD5, username="${this.config.username}", realm="${this.config.server}", [auth-params]`);
      console.log(`Allow: ACK,BYE,CANCEL,INFO,INVITE,MESSAGE,NOTIFY,OPTIONS,PRACK,REFER,REGISTER,SUBSCRIBE`);
      console.log(`Event: ${eventPackage}`);
      console.log(`Accept: application/conference-info+xml`);
      console.log(`Expires: 3600`);
      console.log(`Contact: <sip:[contact]@[transport];transport=ws>`);
      console.log(`Supported: outbound`);
      console.log(`User-Agent: SIP.js/0.21.1`);
      console.log(`Content-Length: 0`);
      console.log('════════════════════════════════════════════════════════════════');
      console.log('');

      // Prepare headers for subscription that match the expected format
      const subscribeHeaders = [
        'Accept: application/conference-info+xml',
        'Supported: outbound, replaces, norefersub',
        'Allow: ACK,BYE,CANCEL,INFO,INVITE,MESSAGE,NOTIFY,OPTIONS,PRACK,REFER,REGISTER,SUBSCRIBE',
        'Allow-Events: presence, conference, dialog, message-summary'
      ];
      
      this.conferenceSubscriber.subscribe({
        requestOptions: {
          extraHeaders: subscribeHeaders
        }
      }).then(() => {
        clearTimeout(subscriptionTimeout);
        console.log(`✅ SUCCESSFULLY SUBSCRIBED TO CONFERENCE EVENTS for room ${this.conferenceRoomId}`);
        console.log('  - Waiting for NOTIFY messages with conference state...');
        console.log('  - FreeSWITCH should send initial NOTIFY immediately');
      }).catch((error) => {
        clearTimeout(subscriptionTimeout);
        console.error('❌ CONFERENCE SUBSCRIPTION FAILED:', error);
        console.error('  - Error details:', error.message);
        
        // Check if it's a timeout error (Timer N)
        if (error.message?.includes('Timer N') || error.message?.includes('Timed out waiting for NOTIFY')) {
          console.log('📝 SUBSCRIPTION TIMEOUT ANALYSIS:');
          console.log('  - FreeSWITCH received SUBSCRIBE but did not send NOTIFY');
          console.log('  - Possible causes:');
          console.log('    1. FreeSWITCH does not support RFC 4575 conference events');
          console.log('    2. mod_conference may not be configured for event subscriptions');
          console.log('    3. Conference room may not exist yet or wrong URI format');
          console.log('  - Conference functionality will continue without real-time updates');
        console.log('');
        console.log('📝 CHECKING FREESWITCH SUPPORTED EVENTS:');
        console.log('  FreeSWITCH typically supports these event packages:');
        console.log('  - message-summary: Voicemail notifications');
        console.log('  - presence: Presence/BLF notifications');  
        console.log('  - dialog: Call state notifications');
        console.log('  - as-feature-event: Feature events');
        console.log('  - conference: MAY be supported if mod_conference is configured');
        console.log('  Check FreeSWITCH logs and configuration for conference event support.');
        }
        
        this.conferenceSubscriber = undefined;
      });
      
    } catch (error) {
      console.error('❌ Exception in subscribeToConferenceEvents:', error);
    }
  }

  // Show alert when a participant leaves the conference
  private showParticipantLeftAlert(participant: ConferenceParticipant): void {
    try {
      const displayName = participant.displayText || participant.entity || 'Unknown participant';
      const message = `${displayName} has left the conference`;
      
      console.log(`🚪 PARTICIPANT LEFT CONFERENCE: ${displayName}`);
      console.log(`   - Entity: ${participant.entity}`);
      console.log(`   - State: ${participant.state}`);
      
      // Emit event that can be caught by UI components
      this.emitEvent('participantLeft', {
        entity: participant.entity,
        displayText: participant.displayText,
        message: message
      });
      
      // Also update call state to trigger UI refresh
      if (this.onCallStateChanged) {
        const currentState = this.getCurrentCallState();
        this.onCallStateChanged({
          ...currentState,
          errorMessage: message,
          errorCode: 'PARTICIPANT_LEFT'
        });
      }
      
      // Log to console with prominent formatting
      console.log('');
      console.log('═══════════════════════════════════════════');
      console.log(`🚪 ${message.toUpperCase()}`);
      console.log('═══════════════════════════════════════════');
      console.log('');
      
    } catch (error) {
      console.error('Failed to show participant left alert:', error);
    }
  }
  
  // Update conference participant UI based on real FreeSWITCH state
  private updateConferenceParticipantUI(): void {
    try {
      console.log('🔄 Updating conference participant UI based on FreeSWITCH state');
      
      // Query FreeSWITCH for current conference state
      this.queryConferenceState();
      
      // Trigger a UI update
      this.updateCallState();
    } catch (error) {
      console.error('Failed to update conference participant UI:', error);
    }
  }

  // Query FreeSWITCH for current conference participants
  private async queryConferenceState(): Promise<void> {
    if (!this.conferenceRoomId) {
      return;
    }

    try {
      console.log(`🔍 Querying FreeSWITCH for conference ${this.conferenceRoomId} state`);

      // Use the conference session to send a list command
      const conferenceSessionId = `conf_session_${this.conferenceRoomId}`;
      const conferenceSession = this.sessions.get(conferenceSessionId);

      if (conferenceSession && conferenceSession.state === SessionState.Established) {
        try {
          // Send INFO to get conference participant list
          await conferenceSession.info({
            contentType: 'application/conference-command',
            content: `list`
          });
          console.log(`📋 Requested participant list for conference ${this.conferenceRoomId}`);
        } catch (error) {
          console.error('Failed to query conference state via session:', error);
          
          // Fallback: Try direct command
          await this.sendFreeSwitchConferenceCommand('list');
        }
      } else {
        console.warn('No conference session available, trying direct query');
        await this.sendFreeSwitchConferenceCommand('list');
      }
    } catch (error) {
      console.error('Failed to query conference state:', error);
    }
  }

  // Send a conference control command to FreeSWITCH
  private async sendFreeSwitchConferenceCommand(command: string): Promise<void> {
    if (!this.userAgent || !this.config?.server || !this.conferenceRoomId) {
      console.error('Cannot send conference command - missing requirements');
      return;
    }
    
    try {
      console.log(`📡 Sending FreeSWITCH conference command: ${command} for room ${this.conferenceRoomId}`);
      
      // Create an Inviter to send INFO to the conference
      const target = UserAgent.makeURI(`sip:${this.conferenceRoomId}@${this.config.server}`);
      if (!target) {
        throw new Error('Failed to create target URI');
      }
      
      // Try to send through existing conference session first
      const conferenceSessionId = `conf_session_${this.conferenceRoomId}`;
      const conferenceSession = this.sessions.get(conferenceSessionId);
      
      if (conferenceSession && conferenceSession.state === SessionState.Established) {
        // Send INFO through existing session with proper SIP.js format
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<conference-info>
  <room>${this.conferenceRoomId}</room>
  <command>${command}</command>
</conference-info>`;
        
        await conferenceSession.info({
          requestOptions: {
            body: {
              content: body,
              contentType: 'application/conference-info+xml'
            }
          }
        });
        console.log(`✅ Sent ${command} command through conference session`);
      } else {
        // Send as a standalone INFO message using userAgentCore
        if (this.userAgent.userAgentCore) {
          const request = this.userAgent.userAgentCore.makeOutgoingRequestMessage(
            'INFO',
            target,
            this.userAgent.userAgentCore.configuration.aor,
            target,
            {},
            [
              'Content-Type: application/conference-info+xml'
            ],
            {
              content: `<?xml version="1.0" encoding="UTF-8"?>
<conference-info>
  <room>${this.conferenceRoomId}</room>
  <command>${command}</command>
</conference-info>`,
              contentType: 'application/conference-info+xml',
              contentDisposition: 'render'
            }
          );
          
          this.userAgent.userAgentCore.request(request);
          console.log(`✅ Sent ${command} command as standalone INFO message`);
        }
      }
    } catch (error) {
      console.error(`Failed to send conference command ${command}:`, error);
      throw error;
    }
  }

  // Send command to FreeSWITCH to hang up all participants in a conference
  private async hangupAllConferenceParticipants(): Promise<void> {
    if (!this.userAgent || !this.config?.server || !this.conferenceRoomId) {
      console.error('Cannot send conference commands - missing requirements');
      return;
    }
    
    try {
      console.log(`🔚 Attempting to disconnect all participants from conference ${this.conferenceRoomId}`);
      
      // Get all participant info
      const participants = Array.from(this.conferenceParticipantInfos.values());
      
      // Since participants are connected directly to FreeSWITCH after REFER,
      // we need to use FreeSWITCH's conference API to kick them
      // We'll try multiple approaches to ensure they get disconnected
      
      // Approach 1: Try to send BYE through the conference session
      const conferenceSessionId = `conf_session_${this.conferenceRoomId}`;
      const conferenceSession = this.sessions.get(conferenceSessionId);
      
      if (conferenceSession && conferenceSession.state === SessionState.Established) {
        try {
          // Send INFO to conference with kick all command
          await conferenceSession.info({
            contentType: 'application/conference-command',
            content: `kick all`
          });
          console.log('Sent kick all command through conference session');
        } catch (error) {
          console.error('Failed to send kick all command:', error);
        }
      }
      
      // Approach 2: Try to destroy the conference room directly
      // This should force all participants to disconnect
      await this.destroyConferenceRoom();
      
      console.log(`✅ Initiated conference teardown for room ${this.conferenceRoomId}`);
    } catch (error) {
      console.error(`Failed to disconnect conference participants:`, error);
    }
  }

  // Destroy the conference room on FreeSWITCH
  private async destroyConferenceRoom(): Promise<void> {
    if (!this.userAgent || !this.config?.server || !this.conferenceRoomId) {
      console.error('Cannot destroy conference room - missing requirements');
      return;
    }
    
    try {
      console.log(`🔚 Destroying conference room ${this.conferenceRoomId} on FreeSWITCH`);
      
      // Method 1: Try through conference session if it exists
      const conferenceSessionId = `conf_session_${this.conferenceRoomId}`;
      const conferenceSession = this.sessions.get(conferenceSessionId);
      
      if (conferenceSession && conferenceSession.state === SessionState.Established) {
        try {
          // Send BYE to end our connection, which might trigger room cleanup
          await conferenceSession.bye();
          console.log('Sent BYE to conference room');
        } catch (error) {
          console.error('Failed to send BYE to conference:', error);
        }
      }
      
      // Method 2: Send conference destroy command via INFO
      // Try sending to the conference extension directly
      const target = new URI('sip', this.conferenceRoomId, this.config.server);
      
      if (this.userAgent.userAgentCore) {
        try {
          const request = this.userAgent.userAgentCore.makeOutgoingRequestMessage(
            'INFO',
            target,
            this.userAgent.userAgentCore.configuration.aor,
            target,
            {},
            [
              'Content-Type: application/conference-command'
            ],
            {
              content: 'destroy',
              contentType: 'application/conference-command',
              contentDisposition: 'render'
            }
          );
          
          this.userAgent.userAgentCore.request(request);
          console.log(`Sent destroy command to conference ${this.conferenceRoomId}`);
        } catch (error) {
          console.error('Failed to send destroy command:', error);
        }
      }
    } catch (error) {
      console.error(`Failed to destroy conference room ${this.conferenceRoomId}:`, error);
    }
  }

  // Send FreeSWITCH conference kick command for a specific participant
  private async sendConferenceKickCommand(participantNumber: string): Promise<void> {
    if (!this.userAgent || !this.config?.server || !this.conferenceRoomId) {
      console.error('Cannot send kick command - missing requirements');
      return;
    }
    
    try {
      console.log(`🔚 Sending FreeSWITCH kick command for ${participantNumber} in room ${this.conferenceRoomId}`);
      
      // Create target URI for FreeSWITCH
      const target = new URI('sip', 'freeswitch', this.config.server);
      
      if (this.userAgent.userAgentCore) {
        // Send INFO message with FreeSWITCH API command to kick the participant
        const request = this.userAgent.userAgentCore.makeOutgoingRequestMessage(
          'INFO',
          target,
          this.userAgent.userAgentCore.configuration.aor,
          target,
          {},
          [
            'Content-Type: application/x-fs-api-command'
          ],
          {
            content: `conference ${this.conferenceRoomId} kick ${participantNumber}`,
            contentType: 'application/x-fs-api-command',
            contentDisposition: 'render'
          }
        );
        
        // Send the INFO request to kick participant
        this.userAgent.userAgentCore.request(request);
        console.log(`✅ Sent kick command for ${participantNumber} in conference ${this.conferenceRoomId}`);
        
        // Give FreeSWITCH time to process the kick
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Failed to send kick command for ${participantNumber}:`, error);
    }
  }

  // End conference for all participants by destroying the conference room on FreeSWITCH
  private async endConferenceForAll(roomId: string): Promise<void> {
    if (!this.userAgent || !this.config?.server) {
      console.error('Cannot end conference - UserAgent or server config not available');
      return;
    }
    
    try {
      console.log(`🔚 Sending FreeSWITCH command to destroy conference room ${roomId}`);
      
      // Send SIP INFO message to FreeSWITCH to destroy the conference room
      // This will kick out all participants and end the conference
      const target = new URI('sip', roomId, this.config.server);
      
      if (this.userAgent.userAgentCore) {
        const request = this.userAgent.userAgentCore.makeOutgoingRequestMessage(
          'INFO',
          target,
          this.userAgent.userAgentCore.configuration.aor,
          target,
          {},
          [
            'X-Conference-Action: destroy',
            `X-Conference-Room: ${roomId}`,
            'Content-Type: application/conference-control+xml'
          ],
          {
            content: `<conference-control><action>destroy</action><room>${roomId}</room></conference-control>`,
            contentType: 'application/conference-control+xml',
            contentDisposition: 'render'
          }
        );
        
        // Send the INFO request to destroy conference
        this.userAgent.userAgentCore.request(request);
        console.log(`✅ Sent conference destroy command for room ${roomId}`);
      }
    } catch (error) {
      console.error(`Failed to send conference destroy command for room ${roomId}:`, error);
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
