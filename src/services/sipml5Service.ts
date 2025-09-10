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
  private callSession?: any;
  private config?: SipML5Config;
  private onCallStateChanged?: (state: CallState) => void;
  private onRegistrationStateChanged?: (registered: boolean) => void;
  private isInitialized = false;
  private isStackStarted = false;
  private currentRemoteNumber?: string;
  private currentCallDirection?: 'incoming' | 'outgoing';
  private remoteAudio?: HTMLAudioElement;
  private loadPromise?: Promise<void>;
  private isCurrentCallOnHold: boolean = false;

  constructor() {
    this.loadSipML5();
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

  private handleIncomingCall(session: any) {
    this.callSession = session;
    const remoteUser = session.getRemoteFriendlyName() || 'Unknown';
    this.currentRemoteNumber = remoteUser;
    this.currentCallDirection = 'incoming';
    
    this.onCallStateChanged?.({ status: 'ringing', remoteNumber: remoteUser, direction: 'incoming' });
    
    // Set up call event handlers
    session.setConfiguration({
      events_listener: {
        events: '*',
        listener: this.handleCallEvent.bind(this)
      }
    });
  }

  private handleCallEvent(event: any) {
    console.log('SipML5: Call event:', event.type, event);
    
    switch (event.type) {
      case 'connecting':
        this.onCallStateChanged?.({ status: 'connecting', remoteNumber: this.currentRemoteNumber, direction: this.currentCallDirection });
        break;
        
      case 'connected':
        this.onCallStateChanged?.({ status: 'connected', remoteNumber: this.currentRemoteNumber, direction: this.currentCallDirection, isOnHold: false });
        break;
        
      case 'terminating':
      case 'terminated':
        this.onCallStateChanged?.({ status: 'idle', remoteNumber: this.currentRemoteNumber, direction: this.currentCallDirection });
        this.currentRemoteNumber = undefined;
        this.currentCallDirection = undefined;
        this.callSession = null;
        this.isCurrentCallOnHold = false;
        this.cleanupAudio();
        break;
        
      case 'failed':
        console.error('SipML5: Call failed');
        
        let failErrorMessage = 'Call failed.';
        let failErrorCode = 'CALL_FAILED';
        const failError = this.callSession?.getLastError?.();
        
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
        
        this.onCallStateChanged?.({
          status: 'failed',
          remoteNumber: this.currentRemoteNumber,
          direction: this.currentCallDirection,
          errorMessage: failErrorMessage,
          errorCode: failErrorCode
        });
        
        this.currentRemoteNumber = undefined;
        this.currentCallDirection = undefined;
        this.callSession = null;
        this.isCurrentCallOnHold = false;
        this.cleanupAudio();
        break;
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
      this.currentRemoteNumber = number;
      this.currentCallDirection = 'outgoing';
      const domain = this.config.domain || this.config.server;
      const target = `sip:${number}@${domain}`;
      
      console.log('SipML5: Making call to', target);
      
      // Create and configure remote audio element
      this.remoteAudio = document.createElement('audio');
      this.remoteAudio.autoplay = true;
      this.remoteAudio.controls = false;
      this.remoteAudio.style.display = 'none';
      document.body.appendChild(this.remoteAudio);
      
      this.callSession = this.sipStack.newSession('call-audio', {
        audio_remote: this.remoteAudio,
        events_listener: {
          events: '*',
          listener: this.handleCallEvent.bind(this)
        }
      });

      this.onCallStateChanged?.({ status: 'connecting', remoteNumber: number, direction: 'outgoing' });
      
      const result = this.callSession.call(target);
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
    if (this.callSession) {
      try {
        // Create and configure remote audio element if not already created
        if (!this.remoteAudio) {
          this.remoteAudio = document.createElement('audio');
          this.remoteAudio.autoplay = true;
          this.remoteAudio.controls = false;
          this.remoteAudio.style.display = 'none';
          document.body.appendChild(this.remoteAudio);
        }
        
        const result = this.callSession.accept({
          audio_remote: this.remoteAudio
        });
        
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
          
          this.onCallStateChanged?.({
            status: 'failed',
            remoteNumber: this.currentRemoteNumber,
            errorMessage,
            errorCode
          });
          
          throw new Error(errorMessage);
        }
        
        console.log('SipML5: Call answered');
      } catch (error: any) {
        console.error('SipML5: Failed to answer call:', error);
        
        // If we haven't already set an error message
        if (!error.message?.includes('Failed to answer')) {
          const errorMessage = 'Failed to answer call. Please check your microphone settings.';
          this.onCallStateChanged?.({
            status: 'failed',
            remoteNumber: this.currentRemoteNumber,
            errorMessage,
            errorCode: 'ANSWER_FAILED'
          });
          throw new Error(errorMessage);
        }
        
        throw error;
      }
    }
  }

  async hangup(): Promise<void> {
    if (this.callSession) {
      try {
        this.callSession.hangup();
        console.log('SipML5: Call terminated');
      } catch (error) {
        console.error('SipML5: Failed to hangup:', error);
      }
    }
  }

  async holdCall(): Promise<void> {
    if (this.callSession && this.callSession.isConnected()) {
      try {
        if (!this.isCurrentCallOnHold) {
          // SipML5 hold implementation - use dtmf or mute approach
          const result = this.callSession.hold();
          if (result !== 0) {
            // Fallback to muting if hold is not supported
            this.callSession.mute('audio');
          }
          
          this.isCurrentCallOnHold = true;
          this.onCallStateChanged?.({ 
            status: 'connected', 
            remoteNumber: this.currentRemoteNumber, 
            direction: this.currentCallDirection,
            isOnHold: true
          });
          
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
    if (this.callSession && this.callSession.isConnected()) {
      try {
        if (this.isCurrentCallOnHold) {
          // SipML5 unhold implementation
          const result = this.callSession.resume ? this.callSession.resume() : this.callSession.unhold();
          if (result !== 0) {
            // Fallback to unmuting if unhold is not supported
            this.callSession.unmute('audio');
          }
          
          this.isCurrentCallOnHold = false;
          this.onCallStateChanged?.({ 
            status: 'connected', 
            remoteNumber: this.currentRemoteNumber, 
            direction: this.currentCallDirection,
            isOnHold: false
          });
          
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

  private cleanupAudio() {
    if (this.remoteAudio && document.body.contains(this.remoteAudio)) {
      document.body.removeChild(this.remoteAudio);
      this.remoteAudio = undefined;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.callSession) {
        this.callSession.hangup();
        this.callSession = null;
      }
      
      if (this.regSession) {
        this.regSession.unregister();
        this.regSession = null;
      }
      
      if (this.sipStack) {
        this.sipStack.stop();
        this.sipStack = null;
        this.isStackStarted = false;
      }
      
      this.cleanupAudio();
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
    if (!this.callSession) {
      return { status: 'idle' };
    }
    
    if (this.callSession.isConnected()) {
      return { status: 'connected' };
    } else if (this.callSession.isConnecting()) {
      return { status: 'connecting' };
    } else {
      return { status: 'idle' };
    }
  }
}