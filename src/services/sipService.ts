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
}

export class SipService {
  private userAgent?: UserAgent;
  private registerer?: Registerer;
  private currentSession?: any;
  private config?: SipConfig;
  private onCallStateChanged?: (state: CallState) => void;
  private onRegistrationStateChanged?: (registered: boolean) => void;
  private remoteAudio?: HTMLAudioElement;

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
      throw new Error('SIP configuration not set');
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
          server: serverUrl
        },
        authorizationUsername: this.config.username,
        authorizationPassword: this.config.password,
        sessionDescriptionHandlerFactoryOptions: {
          constraints: {
            audio: true,
            video: false
          },
          peerConnectionOptions: {
            rtcConfiguration: {
              iceServers: []
            }
          }
        },
        logLevel: 'warn'
      };

      this.userAgent = new UserAgent(userAgentOptions);

      this.userAgent.delegate = {
        onInvite: (invitation) => {
          this.handleIncomingCall(invitation);
        }
      };

      await this.userAgent.start();

      this.registerer = new Registerer(this.userAgent);
      
      this.registerer.stateChange.addListener((state) => {
        const isRegistered = state === 'Registered';
        this.onRegistrationStateChanged?.(isRegistered);
        console.log('Registration state:', state);
      });

      await this.registerer.register();
    } catch (error) {
      console.error('Failed to connect to SIP server:', error);
      this.onRegistrationStateChanged?.(false);
      throw error;
    }
  }

  private handleIncomingCall(invitation: any) {
    this.currentSession = invitation;
    const remoteUser = invitation.remoteIdentity?.uri?.user || 'Unknown';
    this.onCallStateChanged?.({ status: 'ringing', remoteNumber: remoteUser });

    invitation.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Established:
          this.setupAudioStreams(invitation);
          this.onCallStateChanged?.({ status: 'connected', remoteNumber: remoteUser });
          break;
        case SessionState.Terminated:
          this.cleanupAudioStreams();
          this.onCallStateChanged?.({ status: 'idle' });
          this.currentSession = undefined;
          break;
      }
    });
  }

  async makeCall(number: string): Promise<void> {
    if (!this.userAgent || !this.config) {
      throw new Error('SIP service not configured');
    }

    try {
      const domain = this.config.domain || this.config.server;
      const target = new URI('sip', number, domain);
      
      this.currentSession = new Inviter(this.userAgent, target);

      this.onCallStateChanged?.({ status: 'connecting', remoteNumber: number });

      this.currentSession.stateChange.addListener((state: SessionState) => {
        switch (state) {
          case SessionState.Establishing:
            this.onCallStateChanged?.({ status: 'connecting', remoteNumber: number });
            break;
          case SessionState.Established:
            this.setupAudioStreams(this.currentSession);
            this.onCallStateChanged?.({ status: 'connected', remoteNumber: number });
            break;
          case SessionState.Terminated:
            this.cleanupAudioStreams();
            this.onCallStateChanged?.({ status: 'idle' });
            this.currentSession = undefined;
            break;
        }
      });

      await this.currentSession.invite();
    } catch (error) {
      this.onCallStateChanged?.({ status: 'failed' });
      console.error('Failed to make call:', error);
      throw error;
    }
  }

  async answerCall(): Promise<void> {
    if (this.currentSession && this.currentSession.accept) {
      try {
        await this.currentSession.accept();
      } catch (error) {
        console.error('Failed to answer call:', error);
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
      } catch (error) {
        console.error('Failed to hangup:', error);
      }
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
      this.cleanupAudioStreams();
      if (this.remoteAudio && this.remoteAudio.parentNode) {
        this.remoteAudio.parentNode.removeChild(this.remoteAudio);
        this.remoteAudio = undefined;
      }
    } catch (error) {
      console.error('Failed to disconnect:', error);
    } finally {
      this.userAgent = undefined;
      this.registerer = undefined;
      this.currentSession = undefined;
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