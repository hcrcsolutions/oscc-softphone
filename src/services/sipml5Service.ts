export interface SipML5Config {
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

// Declare global SIPml for TypeScript
declare global {
  interface Window {
    SIPml: any;
  }
}

export class SipML5Service {
  private sipStack?: any;
  private regSession?: any;
  private sessions: Map<string, any> = new Map(); // sessionId -> SIPml session
  private callInfos: Map<string, CallInfo> = new Map(); // sessionId -> call info
  private activeSessionId?: string;
  private config?: SipML5Config;
  private onCallStateChanged?: (state: CallState) => void;
  private onRegistrationStateChanged?: (registered: boolean) => void;
  private isInitialized = false;
  private isStackStarted = false;
  private sessionAudioElements: Map<string, HTMLAudioElement> = new Map(); // Per-session audio elements
  private loadPromise?: Promise<void>;
  private audioContext?: AudioContext;
  private ringbackOscillators: OscillatorNode[] = [];
  private ringbackInterval?: NodeJS.Timeout;
  private ringtoneInterval?: NodeJS.Timeout;

  constructor() {
    this.loadSipML5();
  }

  // Helper methods for multi-session management
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

  private updateCallState(sessionId?: string, status?: CallState['status']): void {
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
    if (!status && session.state) {
      if (session.state === 'initial' || session.state === 'connecting') {
        finalStatus = 'connecting';
      } else if (session.state === 'terminated') {
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

    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.controls = false;
    audio.style.display = 'none';

    document.body.appendChild(audio);
    this.sessionAudioElements.set(sessionId, audio);
    
    console.log(`Audio element created for session: ${sessionId}`);
    return audio;
  }

  private cleanupAudioForSession(sessionId: string) {
    const audio = this.sessionAudioElements.get(sessionId);
    if (audio) {
      if (audio.parentNode) {
        audio.parentNode.removeChild(audio);
      }
      this.sessionAudioElements.delete(sessionId);
      console.log(`Audio cleanup completed for session: ${sessionId}`);
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
        console.log(`SipML5: Audio ${shouldMute ? 'muted' : 'unmuted'} for session ${sessionId} (active: ${sessionId === this.activeSessionId}, onHold: ${callInfo.isOnHold})`);
      }
    }
  }

  private setAudioForSession(sessionId: string, muted: boolean) {
    const audio = this.sessionAudioElements.get(sessionId);
    if (audio) {
      audio.muted = muted;
      console.log(`SipML5: Audio ${muted ? 'muted' : 'unmuted'} for session ${sessionId}`);
    }
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
        
        gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);

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

      // Set up interval for repeated ringback
      this.ringbackInterval = setInterval(playRingback, 6000);

      console.log('SipML5: Ringback tone started');
    } catch (error) {
      console.error('SipML5: Failed to generate ringback tone:', error);
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
      console.log('SipML5: Ringback tone stopped');
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
        
        gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);

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

      // Set up interval for repeated ringing
      this.ringtoneInterval = setInterval(playRing, 6000);

      console.log('SipML5: Ringtone started');
    } catch (error) {
      console.error('SipML5: Failed to generate ringtone:', error);
    }
  }

  private stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = undefined;
    }
  }

  private async loadSipML5(): Promise<void> {
    // Return existing promise if already loading
    if (this.loadPromise) {
      return this.loadPromise;
    }
    
    // Return immediately if already loaded
    if (this.isInitialized) {
      return Promise.resolve();
    }

    this.loadPromise = new Promise((resolve, reject) => {
      if (window.SIPml) {
        console.log('SipML5: Already loaded');
        // Still need to initialize if not done
        if (!this.isInitialized) {
          window.SIPml.init(() => {
            console.log('SipML5: Initialized successfully');
            this.isInitialized = true;
            resolve();
          }, (error: any) => {
            console.error('SipML5: Initialization failed:', error);
            reject(error);
          });
        } else {
          resolve();
        }
        return;
      }

      console.log('SipML5: Loading library...');
      
      const script = document.createElement('script');
      script.src = '/libs/SIPml-api.js';
      script.onload = () => {
        console.log('SipML5: Library loaded successfully');
        
        // Initialize SIPml
        if (window.SIPml) {
          window.SIPml.init(() => {
            console.log('SipML5: Initialized successfully');
            this.isInitialized = true;
            resolve();
          }, (error: any) => {
            console.error('SipML5: Initialization failed:', error);
            this.loadPromise = undefined; // Reset on error
            reject(error);
          });
        } else {
          this.loadPromise = undefined; // Reset on error
          reject(new Error('SIPml not found after loading'));
        }
      };
      script.onerror = () => {
        console.error('SipML5: Failed to load library');
        this.loadPromise = undefined; // Reset on error
        reject(new Error('Failed to load SipML5'));
      };
      
      document.head.appendChild(script);
    });
    
    return this.loadPromise;
  }

  setCallStateCallback(callback: (state: CallState) => void) {
    this.onCallStateChanged = callback;
  }

  setRegistrationStateCallback(callback: (registered: boolean) => void) {
    this.onRegistrationStateChanged = callback;
  }

  async configure(config: SipML5Config): Promise<void> {
    this.config = config;
    
    try {
      // Wait for SipML5 to be loaded if not already
      if (!this.isInitialized) {
        console.log('SipML5: Waiting for library to load...');
        await this.loadSipML5();
      }
      
      await this.disconnect();
      await this.connect();
    } catch (error: any) {
      console.error('SipML5: Configuration failed:', error);
      
      let errorMessage = 'Failed to configure phone system.';
      if (error.message?.includes('WebSocket') || error.message?.includes('ws')) {
        errorMessage = 'Cannot connect to phone server. Please check your network connection.';
      } else if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        errorMessage = 'Invalid phone credentials. Please check your username and password.';
      }
      
      this.onCallStateChanged?.({
        status: 'failed',
        errorMessage,
        errorCode: 'CONFIG_FAILED'
      });
      
      throw new Error(errorMessage);
    }
  }

  private async connect(): Promise<void> {
    if (!this.config || !this.isInitialized) {
      const errorMessage = 'Phone system not initialized or configured. Please check your settings.';
      this.onCallStateChanged?.({
        status: 'failed',
        errorMessage,
        errorCode: 'NOT_INITIALIZED'
      });
      throw new Error(errorMessage);
    }

    try {
      const domain = this.config.domain || this.config.server;
      const port = this.config.protocol === 'wss' ? '7443' : '5066';
      const wsUri = `${this.config.protocol}://${this.config.server}:${port}`;
      
      console.log('SipML5: Creating SIP stack with WebSocket:', wsUri);
      console.log('SipML5: Configuration - realm:', domain, 'impi:', this.config.username, 'impu:', `sip:${this.config.username}@${domain}`);

      // Create SIP stack
      this.sipStack = new window.SIPml.Stack({
        realm: domain,
        impi: this.config.username,
        impu: `sip:${this.config.username}@${domain}`,
        password: this.config.password,
        display_name: this.config.username,
        websocket_proxy_url: wsUri,
        outbound_proxy_url: null,
        ice_servers: [],
        enable_rtcweb_breaker: true,
        events_listener: {
          events: '*',
          listener: this.handleStackEvent.bind(this)
        }
      });

      // Start the SIP stack
      const result = this.sipStack.start();
      if (result !== 0) {
        throw new Error(`Failed to start SIP stack: ${result}`);
      }
      
      console.log('SipML5: SIP stack started');

    } catch (error) {
      console.error('SipML5: Failed to connect:', error);
      this.onRegistrationStateChanged?.(false);
      throw error;
    }
  }

  private handleStackEvent(event: any) {
    console.log('SipML5: Stack event:', event.type, event);
    
    switch (event.type) {
      case 'started':
        console.log('SipML5: Stack started, creating registration session');
        this.isStackStarted = true;
        this.createRegisterSession();
        break;
        
      case 'i_new_call':
        console.log('SipML5: Incoming call');
        this.handleIncomingCall(event.newSession);
        break;
        
      case 'failed_to_start':
        console.error('SipML5: Failed to start stack');
        this.isStackStarted = false;
        this.onRegistrationStateChanged?.(false);
        break;
        
      case 'stopped':
        console.log('SipML5: Stack stopped');
        this.isStackStarted = false;
        this.onRegistrationStateChanged?.(false);
        break;
        
      case 'm_permission_requested':
        console.log('SipML5: Media permission requested');
        break;
        
      case 'm_permission_accepted':
        console.log('SipML5: Media permission accepted');
        break;
        
      case 'm_permission_refused':
        console.error('SipML5: Media permission refused');
        break;
    }
  }

  private createRegisterSession() {
    if (!this.sipStack || !this.isStackStarted) {
      console.warn('SipML5: Cannot create registration session - stack not ready');
      return;
    }

    try {
      this.regSession = this.sipStack.newSession('register', {
        events_listener: {
          events: '*',
          listener: this.handleRegisterEvent.bind(this)
        }
      });

      const result = this.regSession.register();
      if (result !== 0) {
        console.warn('SipML5: Registration call returned code:', result, '(this may be normal for async operation)');
      } else {
        console.log('SipML5: Registration call successful');
      }
      console.log('SipML5: Registration session created and started');
    } catch (error) {
      console.error('SipML5: Failed to create registration session:', error);
    }
  }

  private handleRegisterEvent(event: any) {
    console.log('SipML5: Register event:', event.type, event);
    
    switch (event.type) {
      case 'connected':
        console.log('SipML5: Registered successfully');
        this.onRegistrationStateChanged?.(true);
        break;
        
      case 'disconnected':
        console.log('SipML5: Unregistered');
        this.onRegistrationStateChanged?.(false);
        break;
        
      case 'failed':
        console.error('SipML5: Registration failed');
        this.onRegistrationStateChanged?.(false);
        break;
    }
  }


  private handleCallEvent(event: any, sessionId?: string) {
    console.log('SipML5: Call event:', event.type, event, 'sessionId:', sessionId);
    
    // If no sessionId provided, this might be an old call or incoming call
    if (!sessionId && event.type === 'incoming') {
      this.handleIncomingCall(event);
      return;
    }
    
    if (!sessionId) return;
    
    const callInfo = this.callInfos.get(sessionId);
    const session = this.sessions.get(sessionId);
    
    if (!callInfo || !session) return;
    
    switch (event.type) {
      case 'connecting':
        this.updateCallState(sessionId, 'connecting');
        break;
        
      case 'connected':
        this.stopRingbackTone(); // Stop ringback tone when call connects
        this.stopRingtone(); // Stop ringtone when call connects
        console.log('SipML5: Call connected, audio feedback stopped');
        // Manage audio: mute all other calls, unmute this one
        this.muteAllInactiveCalls();
        this.updateCallState(sessionId, 'connected');
        break;
        
      case 'terminating':
      case 'terminated':
        this.stopRingbackTone(); // Stop any audio feedback
        this.stopRingtone();
        
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
        
        this.cleanupAudioForSession(sessionId);
        
        // Send updated state for remaining calls
        this.updateCallState();
        break;
        
      case 'failed':
        console.error('SipML5: Call failed');
        
        let failErrorMessage = 'Call failed.';
        let failErrorCode = 'CALL_FAILED';
        const failError = session?.getLastError?.();
        
        if (failError === 486) {
          failErrorMessage = 'The number is busy. Please try again later.';
          failErrorCode = 'BUSY';
        } else if (failError === 404) {
          failErrorMessage = 'Invalid number or extension not found.';
          failErrorCode = 'NOT_FOUND';
        } else if (failError === 503) {
          failErrorMessage = 'Phone service temporarily unavailable. Please try again later.';
          failErrorCode = 'SERVICE_UNAVAILABLE';
        } else if (failError === 408) {
          failErrorMessage = 'Call timeout. The number may be unreachable.';
          failErrorCode = 'TIMEOUT';
        }
        
        if (callInfo) {
          this.onCallStateChanged?.({
            status: 'failed',
            remoteNumber: callInfo.remoteNumber,
            direction: callInfo.direction,
            errorMessage: failErrorMessage,
            errorCode: failErrorCode
          });
        }
        
        // Clean up failed session
        this.sessions.delete(sessionId);
        this.callInfos.delete(sessionId);
        if (this.activeSessionId === sessionId) {
          this.activeSessionId = undefined;
        }
        this.cleanupAudioForSession(sessionId);
        break;
    }
  }

  private handleIncomingCall(event: any) {
    const sessionId = this.generateSessionId();
    const remoteNumber = event.session?.getRemoteNumber?.() || 'Unknown';
    
    // Store session and call info
    this.sessions.set(sessionId, event.session);
    this.callInfos.set(sessionId, {
      sessionId,
      remoteNumber: remoteNumber,
      isOnHold: false,
      direction: 'incoming',
      startTime: new Date()
    });
    
    // Set as active session
    this.activeSessionId = sessionId;
    
    // Start ringtone for incoming call
    this.generateRingtone();
    
    this.updateCallState(sessionId, 'ringing');
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
        session.hangup();
      } catch (error) {
        console.warn('Error ending call:', error);
      }
      
      // Cleanup will be handled by the event listener
    }
  }

  async makeCall(number: string): Promise<void> {
    if (!this.sipStack || !this.config) {
      const errorMessage = 'Phone system not ready. Please wait for registration to complete.';
      this.onCallStateChanged?.({
        status: 'failed',
        errorMessage,
        errorCode: 'NOT_REGISTERED'
      });
      throw new Error(errorMessage);
    }
    
    if (!this.isStackStarted) {
      const errorMessage = 'Phone system not ready. Please wait for initialization to complete.';
      this.onCallStateChanged?.({
        status: 'failed',
        errorMessage,
        errorCode: 'NOT_STARTED'
      });
      throw new Error(errorMessage);
    }

    try {
      const sessionId = this.generateSessionId();
      const domain = this.config.domain || this.config.server;
      const target = `sip:${number}@${domain}`;
      
      console.log('SipML5: Making call to', target);
      
      // Create audio element for this specific session
      const remoteAudio = this.createAudioElementForSession(sessionId);
      
      const callSession = this.sipStack.newSession('call-audio', {
        audio_remote: remoteAudio,
        events_listener: {
          events: '*',
          listener: (event: any) => this.handleCallEvent(event, sessionId)
        }
      });

      // Store session and call info
      this.sessions.set(sessionId, callSession);
      this.callInfos.set(sessionId, {
        sessionId,
        remoteNumber: number,
        isOnHold: false,
        direction: 'outgoing',
        startTime: new Date()
      });

      // Set as active session
      this.activeSessionId = sessionId;

      this.updateCallState(sessionId, 'connecting');
      
      // Start ringback tone for outgoing call
      this.generateRingbackTone();
      
      const result = callSession.call(target);
      if (result !== 0) {
        let errorMessage = 'Failed to make call.';
        let errorCode = 'CALL_FAILED';
        
        if (result === -1) {
          errorMessage = 'Invalid call parameters. Please check the number and try again.';
          errorCode = 'INVALID_PARAMS';
        } else if (result === -2) {
          errorMessage = 'Phone system not ready. Please try again.';
          errorCode = 'NOT_READY';
        }
        
        this.onCallStateChanged?.({
          status: 'failed',
          remoteNumber: number,
          errorMessage,
          errorCode
        });
        
        throw new Error(errorMessage);
      }
      
    } catch (error: any) {
      console.error('SipML5: Failed to make call:', error);
      
      // Check for specific error types
      let errorMessage = 'Failed to make call. Please try again.';
      let errorCode = 'CALL_FAILED';
      
      if (error.message?.includes('insecure context') || error.message?.includes('Media devices not available')) {
        errorMessage = 'Microphone access requires a secure connection (HTTPS). Please access this application using HTTPS.';
        errorCode = 'INSECURE_CONTEXT';
      } else if (error.message?.includes('media') || error.message?.includes('getUserMedia')) {
        errorMessage = 'Microphone access denied or not available.';
        errorCode = 'MEDIA_ERROR';
      }
      
      // If we haven't already set an error message, set a generic one
      if (!error.message?.includes('Phone') && !error.message?.includes('Failed to make call')) {
        this.onCallStateChanged?.({
          status: 'failed',
          remoteNumber: number,
          errorMessage,
          errorCode
        });
        throw new Error(errorMessage);
      }
      
      throw error;
    }
  }

  async answerCall(): Promise<void> {
    const activeSession = this.getActiveSession();
    const activeCallInfo = this.getActiveCallInfo();
    
    if (activeSession && activeCallInfo) {
      try {
        // Create audio element for this specific session
        const remoteAudio = this.createAudioElementForSession(activeCallInfo.sessionId);
        
        // Stop any audio feedback when answering
        this.stopRingbackTone();
        this.stopRingtone();
        
        // Try immediate accept first
        let result = activeSession.accept({
          audio_remote: remoteAudio
        });
        
        // If immediate accept failed, wait briefly and retry
        if (result !== 0 && result === -1 && activeSession.isConnecting && activeSession.isConnecting()) {
          console.log('SipML5: Immediate accept failed, session connecting, waiting briefly...');
          
          let attempts = 0;
          const maxAttempts = 3; // Reduced attempts
          
          while (activeSession.isConnecting && activeSession.isConnecting() && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 30 + (attempts * 20))); // 30ms, 50ms, 70ms
            attempts++;
            console.log(`SipML5: Retry attempt ${attempts}`);
            
            // Check if session was terminated while waiting
            if (!activeSession || (activeSession.isTerminated && activeSession.isTerminated())) {
              throw new Error('Call was terminated before it could be answered');
            }
            
            // Try accepting again
            result = activeSession.accept({
              audio_remote: remoteAudio
            });
            
            if (result === 0) {
              break; // Success
            }
          }
        }
        
        if (result !== 0) {
          let errorMessage = 'Failed to answer call.';
          let errorCode = 'ANSWER_FAILED';
          
          if (result === -1) {
            errorMessage = 'Invalid call state. Cannot answer at this time.';
            errorCode = 'INVALID_STATE';
          } else if (result === -2) {
            errorMessage = 'Phone system error. Please try again.';
            errorCode = 'SYSTEM_ERROR';
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
        
        console.log('SipML5: Call answered');
      } catch (error: any) {
        console.error('SipML5: Failed to answer call:', error);
        
        let errorMessage = 'Failed to answer call.';
        let errorCode = 'ANSWER_FAILED';
        
        if (error.message?.includes('Timeout waiting')) {
          errorMessage = 'Call answer timed out. Please try again.';
          errorCode = 'ANSWER_TIMEOUT';
        } else if (error.message?.includes('terminated before')) {
          errorMessage = 'Call was cancelled before it could be answered.';
          errorCode = 'CALL_CANCELLED';
        } else if (error.message?.includes('Invalid call state') || error.message?.includes('Failed to answer call')) {
          // Use existing error message if it's already specific
          errorMessage = error.message;
        } else if (!error.message?.includes('Phone') && !error.message?.includes('Failed to answer')) {
          errorMessage = 'Failed to answer call. Please check your microphone settings.';
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
        activeSession.hangup();
        console.log('SipML5: Call terminated');
      } catch (error) {
        console.error('SipML5: Failed to hangup:', error);
      }
    }
  }

  async holdCall(): Promise<void> {
    const activeSession = this.getActiveSession();
    const activeCallInfo = this.getActiveCallInfo();
    
    if (activeSession && activeSession.isConnected() && activeCallInfo) {
      try {
        if (!activeCallInfo.isOnHold) {
          // SipML5 hold implementation - use dtmf or mute approach
          const result = activeSession.hold();
          if (result !== 0) {
            // Fallback to muting if hold is not supported
            activeSession.mute('audio');
          }
          
          // Update call info
          activeCallInfo.isOnHold = true;
          this.callInfos.set(activeCallInfo.sessionId, activeCallInfo);
          
          // Mute the audio for this held call
          this.setAudioForSession(activeCallInfo.sessionId, true);
          
          this.updateCallState(activeCallInfo.sessionId, 'connected');
          
          console.log('SipML5: Call placed on hold');
        }
      } catch (error: any) {
        console.error('SipML5: Failed to hold call:', error);
        throw new Error('Failed to place call on hold');
      }
    } else {
      throw new Error('No active call to hold');
    }
  }

  async unholdCall(): Promise<void> {
    const activeSession = this.getActiveSession();
    const activeCallInfo = this.getActiveCallInfo();
    
    if (activeSession && activeSession.isConnected() && activeCallInfo) {
      try {
        if (activeCallInfo.isOnHold) {
          // SipML5 unhold implementation
          const result = activeSession.resume ? activeSession.resume() : activeSession.unhold();
          if (result !== 0) {
            // Fallback to unmuting if unhold is not supported
            activeSession.unmute('audio');
          }
          
          // Update call info
          activeCallInfo.isOnHold = false;
          this.callInfos.set(activeCallInfo.sessionId, activeCallInfo);
          
          // Manage audio: unmute this call and mute all others
          this.muteAllInactiveCalls();
          
          this.updateCallState(activeCallInfo.sessionId, 'connected');
          
          console.log('SipML5: Call resumed from hold');
        }
      } catch (error: any) {
        console.error('SipML5: Failed to unhold call:', error);
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
        activeSession.hangup();
      }
      
      // Clear all sessions and call info
      this.sessions.clear();
      this.callInfos.clear();
      this.activeSessionId = undefined;
      
      if (this.regSession) {
        this.regSession.unregister();
        this.regSession = null;
      }
      
      if (this.sipStack) {
        this.sipStack.stop();
        this.sipStack = null;
        this.isStackStarted = false;
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
      
      console.log('SipML5: Disconnected');
    } catch (error: any) {
      console.error('SipML5: Failed to disconnect:', error);
      // Don't throw here, just log - disconnect should always succeed from user perspective
    }
  }

  isRegistered(): boolean {
    return this.regSession && this.regSession.isConnected();
  }

  getCurrentCallState(): CallState {
    const activeSession = this.getActiveSession();
    const activeCallInfo = this.getActiveCallInfo();
    
    if (!activeSession || !activeCallInfo) {
      return { status: 'idle' };
    }
    
    if (activeSession.isConnected()) {
      return { 
        status: 'connected',
        remoteNumber: activeCallInfo.remoteNumber,
        direction: activeCallInfo.direction,
        isOnHold: activeCallInfo.isOnHold
      };
    } else if (activeSession.isConnecting()) {
      return { 
        status: 'connecting',
        remoteNumber: activeCallInfo.remoteNumber,
        direction: activeCallInfo.direction
      };
    } else {
      return { status: 'idle' };
    }
  }
}