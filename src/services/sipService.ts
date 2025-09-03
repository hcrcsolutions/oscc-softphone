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

  setCallStateCallback(callback: (state: CallState) => void) {
    this.onCallStateChanged = callback;
  }

  setRegistrationStateCallback(callback: (registered: boolean) => void) {
    this.onRegistrationStateChanged = callback;
  }

  async configure(config: SipConfig): Promise<void> {
    this.config = config;
    await this.disconnect();
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.config) {
      throw new Error('SIP configuration not set');
    }

    try {
      const domain = this.config.domain || this.config.server;
      
      const userAgentOptions: UserAgentOptions = {
        uri: new URI('sip', this.config.username, domain),
        transportOptions: {
          server: `ws://${this.config.server}:5066`
        },
        authorizationUsername: this.config.username,
        authorizationPassword: this.config.password,
        sessionDescriptionHandlerFactoryOptions: {
          constraints: {
            audio: true,
            video: false
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
          this.onCallStateChanged?.({ status: 'connected', remoteNumber: remoteUser });
          break;
        case SessionState.Terminated:
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
            this.onCallStateChanged?.({ status: 'connected', remoteNumber: number });
            break;
          case SessionState.Terminated:
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