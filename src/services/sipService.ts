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
}

export class SipService {
  private userAgent?: UserAgent;
  private registerer?: Registerer;
  private currentSession?: any;
  private config?: SipConfig;
  private onCallStateChanged?: (state: CallState) => void;
  private onRegistrationStateChanged?: (registered: boolean) => void;
  private remoteAudio?: HTMLAudioElement;
  private currentRemoteNumber?: string;
  private currentCallDirection?: 'incoming' | 'outgoing';
  private isCurrentCallOnHold: boolean = false;
  private dialToneAudio?: HTMLAudioElement;
  private ringtoneAudio?: HTMLAudioElement;
  private audioContext?: AudioContext;
  private dialToneOscillator?: OscillatorNode;
  private ringtoneInterval?: NodeJS.Timeout;

  setCallStateCallback(callback: (state: CallState) => void) {
    this.onCallStateChanged = callback;
  }

  setRegistrationStateCallback(callback: (registered: boolean) => void) {
    this.onRegistrationStateChanged = callback;
  }

  async configure(config: SipConfig): Promise<void> {
    this.config = config;
    this.setupRemoteAudio();
    await this.disconnect();
    await this.connect();
  }

  private setupRemoteAudio() {
    if (!this.remoteAudio) {
      this.remoteAudio = new Audio();
      this.remoteAudio.autoplay = true;
      this.remoteAudio.controls = false;
      this.remoteAudio.muted = false;
      this.remoteAudio.volume = 1.0;
      
      // Add event listeners for debugging
      this.remoteAudio.addEventListener('loadstart', () => console.log('Audio: loadstart'));
      this.remoteAudio.addEventListener('loadeddata', () => console.log('Audio: loadeddata'));
      this.remoteAudio.addEventListener('canplay', () => console.log('Audio: canplay'));
      this.remoteAudio.addEventListener('playing', () => console.log('Audio: playing'));
      this.remoteAudio.addEventListener('error', (e) => console.error('Audio error:', e));
      
      document.body.appendChild(this.remoteAudio);
      console.log('Remote audio element created and added to DOM');
    }
  }

  private setupAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  private generateDialTone() {
    try {
      this.setupAudioContext();
      if (!this.audioContext) return;

      // Stop any existing dial tone
      this.stopDialTone();

      // Create dual-frequency dial tone (350Hz + 440Hz)
      const oscillator1 = this.audioContext.createOscillator();
      const oscillator2 = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator1.frequency.setValueAtTime(350, this.audioContext.currentTime);
      oscillator2.frequency.setValueAtTime(440, this.audioContext.currentTime);
      
      gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime); // Lower volume

      oscillator1.connect(gainNode);
      oscillator2.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator1.start();
      oscillator2.start();

      // Store reference to stop later
      this.dialToneOscillator = oscillator1; // Store one for reference

      console.log('Dial tone started');
    } catch (error) {
      console.error('Failed to generate dial tone:', error);
    }
  }

  private stopDialTone() {
    if (this.dialToneOscillator) {
      try {
        this.dialToneOscillator.stop();
        this.dialToneOscillator.disconnect();
      } catch (error) {
        // Oscillator might already be stopped
      }
      this.dialToneOscillator = undefined;
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

  private setupAudioStreams(session: any) {
    try {
      console.log('Setting up audio streams for session:', session);
      
      // Get the session description handler
      const pc = session.sessionDescriptionHandler?.peerConnection;
      
      if (!pc) {
        console.warn('No peer connection available yet');
        return;
      }
      
      console.log('Found peer connection, setting up ontrack handler');
      
      // Set up ontrack event handler for incoming media
      pc.ontrack = (event: RTCTrackEvent) => {
        console.log('Track received:', event.track.kind, 'streams:', event.streams.length);
        
        if (event.track.kind === 'audio' && this.remoteAudio) {
          let remoteStream: MediaStream;
          
          if (event.streams && event.streams.length > 0) {
            remoteStream = event.streams[0];
            console.log('Using provided stream');
          } else {
            remoteStream = new MediaStream([event.track]);
            console.log('Creating new stream from track');
          }
          
          console.log('Setting remote stream to audio element');
          this.remoteAudio.srcObject = remoteStream;
          
          // Ensure volume is up
          this.remoteAudio.volume = 1.0;
          this.remoteAudio.muted = false;
          
          // Try to play
          this.remoteAudio.play().then(() => {
            console.log('✓ Remote audio playback started successfully');
          }).catch((error) => {
            console.error('Failed to start audio playback:', error);
            // On error, we might need user interaction
            console.log('Audio may require user interaction to start');
            
            // Try to inform about audio issues
            if (this.onCallStateChanged && this.currentSession?.state === SessionState.Established) {
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
        if (receiver.track && receiver.track.kind === 'audio' && this.remoteAudio) {
          console.log('Found existing audio track, setting up stream');
          const remoteStream = new MediaStream([receiver.track]);
          this.remoteAudio.srcObject = remoteStream;
          this.remoteAudio.volume = 1.0;
          this.remoteAudio.muted = false;
          
          this.remoteAudio.play().then(() => {
            console.log('✓ Remote audio playback started from existing track');
          }).catch((error) => {
            console.error('Failed to start audio from existing track:', error);
            console.warn('Audio playback requires user interaction. User may need to click to enable audio.');
          });
        }
      });
      
    } catch (error) {
      console.error('Failed to setup audio streams:', error);
    }
  }

  private cleanupAudioStreams() {
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio.pause();
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
      this.setupRemoteAudio();
      
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
    this.currentSession = invitation;
    const remoteUser = invitation.remoteIdentity?.uri?.user || 'Unknown';
    this.currentCallDirection = 'incoming';
    this.currentRemoteNumber = remoteUser;
    
    // Start ringtone for incoming call
    this.generateRingtone();
    
    this.onCallStateChanged?.({ status: 'ringing', remoteNumber: remoteUser, direction: 'incoming' });

    invitation.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Established:
          this.stopRingtone(); // Stop ringtone when call is answered
          this.setupAudioStreams(invitation);
          this.onCallStateChanged?.({ status: 'connected', remoteNumber: remoteUser, direction: 'incoming', isOnHold: false });
          break;
        case SessionState.Terminated:
          this.cleanupAudioStreams();
          this.onCallStateChanged?.({ status: 'idle', remoteNumber: this.currentRemoteNumber, direction: this.currentCallDirection });
          this.currentSession = undefined;
          this.currentRemoteNumber = undefined;
          this.currentCallDirection = undefined;
          break;
      }
    });
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
      
      this.currentSession = new Inviter(this.userAgent, target);

      this.onCallStateChanged?.({ status: 'connecting', remoteNumber: number });

      // Start dial tone for outgoing call
      this.generateDialTone();

      this.currentCallDirection = 'outgoing';
      this.currentRemoteNumber = number;
      
      this.currentSession.stateChange.addListener((state: SessionState) => {
        switch (state) {
          case SessionState.Establishing:
            this.onCallStateChanged?.({ status: 'connecting', remoteNumber: number, direction: 'outgoing' });
            break;
          case SessionState.Established:
            this.stopDialTone(); // Stop dial tone when call is connected
            this.setupAudioStreams(this.currentSession);
            this.onCallStateChanged?.({ status: 'connected', remoteNumber: number, direction: 'outgoing', isOnHold: false });
            break;
          case SessionState.Terminated:
            this.stopDialTone(); // Stop any audio feedback
            this.stopRingtone();
            this.cleanupAudioStreams();
            this.onCallStateChanged?.({ status: 'idle', remoteNumber: this.currentRemoteNumber, direction: this.currentCallDirection });
            this.currentSession = undefined;
            this.currentRemoteNumber = undefined;
            this.currentCallDirection = undefined;
            this.isCurrentCallOnHold = false;
            break;
        }
      });

      await this.currentSession.invite();
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
        remoteNumber: this.currentRemoteNumber,
        errorMessage,
        errorCode
      });
      this.currentRemoteNumber = undefined;
      console.error('Failed to make call:', error);
      throw new Error(errorMessage);
    }
  }

  async answerCall(): Promise<void> {
    if (this.currentSession && this.currentSession.accept) {
      try {
        // Try immediate accept first, only wait if it fails
        try {
          await this.currentSession.accept();
          return; // Success, exit early
        } catch (immediateError: any) {
          if (!immediateError.message?.includes('Invalid session state')) {
            throw immediateError; // If it's not a state error, rethrow
          }
          console.log('Immediate accept failed due to state, will wait and retry...');
        }
        
        // If immediate accept failed due to state, wait a bit
        if (this.currentSession.state === SessionState.Establishing) {
          console.log('Session is establishing, waiting briefly...');
          
          // Much shorter wait with linear progression
          let attempts = 0;
          const maxAttempts = 3; // Further reduced
          
          while (this.currentSession.state === SessionState.Establishing && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 30 + (attempts * 20))); // 30ms, 50ms, 70ms
            attempts++;
            console.log(`Attempt ${attempts}: Session state is ${this.currentSession.state}`);
            
            // Check if session was terminated while waiting
            if (this.currentSession.state === SessionState.Terminated) {
              throw new Error('Call was terminated before it could be answered');
            }
            
            // Try accepting after each wait
            try {
              await this.currentSession.accept();
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
        await this.currentSession.accept();
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
        
        this.onCallStateChanged?.({ 
          status: 'failed',
          remoteNumber: this.currentRemoteNumber,
          errorMessage,
          errorCode
        });
        
        throw new Error(errorMessage);
      }
    }
  }

  async hangup(): Promise<void> {
    if (this.currentSession) {
      try {
        switch (this.currentSession.state) {
          case SessionState.Initial:
          case SessionState.Establishing:
            if (this.currentSession.cancel) {
              await this.currentSession.cancel();
            }
            break;
          case SessionState.Established:
            if (this.currentSession.bye) {
              await this.currentSession.bye();
            }
            break;
          default:
            if (this.currentSession.terminate) {
              await this.currentSession.terminate();
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
    if (this.currentSession && this.currentSession.state === SessionState.Established) {
      try {
        if (!this.isCurrentCallOnHold) {
          // Mute the microphone to simulate hold
          const pc = this.currentSession.sessionDescriptionHandler?.peerConnection;
          if (pc) {
            const senders = pc.getSenders();
            senders.forEach((sender: RTCRtpSender) => {
              if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = false;
              }
            });
          }
          
          this.isCurrentCallOnHold = true;
          this.onCallStateChanged?.({ 
            status: 'connected', 
            remoteNumber: this.currentRemoteNumber, 
            direction: this.currentCallDirection,
            isOnHold: true
          });
          
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
    if (this.currentSession && this.currentSession.state === SessionState.Established) {
      try {
        if (this.isCurrentCallOnHold) {
          // Unmute the microphone to resume call
          const pc = this.currentSession.sessionDescriptionHandler?.peerConnection;
          if (pc) {
            const senders = pc.getSenders();
            senders.forEach((sender: RTCRtpSender) => {
              if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = true;
              }
            });
          }
          
          this.isCurrentCallOnHold = false;
          this.onCallStateChanged?.({ 
            status: 'connected', 
            remoteNumber: this.currentRemoteNumber, 
            direction: this.currentCallDirection,
            isOnHold: false
          });
          
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
      if (this.currentSession) {
        await this.hangup();
      }
      if (this.registerer) {
        await this.registerer.unregister();
      }
      if (this.userAgent) {
        await this.userAgent.stop();
      }
      
      // Cleanup all audio
      this.stopDialTone();
      this.stopRingtone();
      this.cleanupAudioStreams();
      
      if (this.remoteAudio && this.remoteAudio.parentNode) {
        this.remoteAudio.parentNode.removeChild(this.remoteAudio);
        this.remoteAudio = undefined;
      }
      
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
      this.currentSession = undefined;
      this.isCurrentCallOnHold = false;
    }
  }

  isRegistered(): boolean {
    return this.registerer?.state === 'Registered';
  }

  getCurrentCallState(): CallState {
    if (!this.currentSession) {
      return { status: 'idle' };
    }
    
    switch (this.currentSession.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        return { status: 'connecting' };
      case SessionState.Established:
        return { status: 'connected' };
      default:
        return { status: 'idle' };
    }
  }
}