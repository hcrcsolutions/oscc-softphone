/**
 * Microsoft Entra ID Authentication Service
 * 
 * Handles authentication, token management, and user session
 */

import {
  PublicClientApplication,
  AuthenticationResult,
  AccountInfo,
  InteractionRequiredAuthError,
  SilentRequest,
} from '@azure/msal-browser';
import { msalConfig, loginRequest, tokenRequest } from '@/config/authConfig';

export class AuthService {
  private msalInstance: PublicClientApplication;
  private account: AccountInfo | null = null;
  private loginInProgress: boolean = false;

  constructor() {
    this.msalInstance = new PublicClientApplication(msalConfig);
    this.initializeMsal();
  }

  /**
   * Initialize MSAL and handle redirect response
   */
  private async initializeMsal(): Promise<void> {
    try {
      // Handle redirect response if returning from auth
      await this.msalInstance.initialize();
      const response = await this.msalInstance.handleRedirectPromise();
      
      if (response) {
        this.handleAuthResponse(response);
      } else {
        // Check if user is already signed in
        const accounts = this.msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          this.account = accounts[0];
          console.log('User already authenticated:', this.account.username);
        }
      }
    } catch (error) {
      console.error('Failed to initialize MSAL:', error);
    }
  }

  /**
   * Handle authentication response
   */
  private handleAuthResponse(response: AuthenticationResult): void {
    if (response && response.account) {
      this.account = response.account;
      this.msalInstance.setActiveAccount(response.account);
      console.log('Authentication successful:', response.account.username);
      
      // Store tokens securely (they're already in MSAL cache)
      // You can emit an event or callback here if needed
      this.onAuthSuccess(response);
    }
  }

  /**
   * Sign in using redirect (primary method)
   */
  async login(): Promise<void> {
    if (this.loginInProgress) {
      console.warn('Login already in progress');
      return;
    }

    this.loginInProgress = true;
    try {
      await this.msalInstance.loginRedirect(loginRequest);
      // Note: execution stops here as browser redirects
    } catch (error) {
      console.error('Login redirect failed:', error);
      this.loginInProgress = false;
      throw error;
    }
  }


  /**
   * Get access token silently
   */
  async getAccessToken(scopes?: string[]): Promise<string | null> {
    if (!this.account) {
      console.error('No authenticated user');
      return null;
    }

    const request: SilentRequest = {
      ...tokenRequest,
      account: this.account,
      scopes: scopes || tokenRequest.scopes,
    };

    try {
      // Try to get token silently
      const response = await this.msalInstance.acquireTokenSilent(request);
      return response.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        // Token refresh required - use redirect
        console.log('Token refresh required, redirecting to login...');
        try {
          await this.msalInstance.acquireTokenRedirect(request);
          // Note: execution stops here as browser redirects
          return null;
        } catch (redirectError) {
          console.error('Failed to acquire token via redirect:', redirectError);
          return null;
        }
      }
      console.error('Failed to acquire token:', error);
      return null;
    }
  }

  /**
   * Get ID token claims
   */
  getIdTokenClaims(): any {
    if (!this.account || !this.account.idTokenClaims) {
      return null;
    }
    return this.account.idTokenClaims;
  }

  /**
   * Get current user
   */
  getCurrentUser(): AccountInfo | null {
    return this.account;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.account !== null;
  }

  /**
   * Get all accounts (for account switcher)
   */
  getAllAccounts(): AccountInfo[] {
    return this.msalInstance.getAllAccounts();
  }

  /**
   * Switch active account
   */
  setActiveAccount(account: AccountInfo): void {
    this.account = account;
    this.msalInstance.setActiveAccount(account);
  }

  /**
   * Callback for successful authentication
   * Override this method to handle post-authentication logic
   */
  protected onAuthSuccess(response: AuthenticationResult): void {
    // Extract user information
    const user = {
      id: response.account.localAccountId,
      username: response.account.username,
      name: response.account.name,
      email: response.account.username, // Usually email
      tenantId: response.account.tenantId,
      roles: (response.account.idTokenClaims as any)?.roles || [],
    };

    console.log('User authenticated:', user);
    
    // You can dispatch events or update global state here
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:success', { detail: user }));
    }
  }

  /**
   * Make authenticated API call
   */
  async callApi(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error('Failed to acquire access token');
    }

    const headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };

    return fetch(endpoint, {
      ...options,
      headers,
    });
  }

  // Removed getUserProfile and getUserPhoto - not using Microsoft Graph API

  /**
   * Check if token is expired or about to expire
   */
  async isTokenExpired(): Promise<boolean> {
    if (!this.account) return true;

    try {
      const request: SilentRequest = {
        account: this.account,
        scopes: tokenRequest.scopes,
      };
      
      // This will check token expiry internally
      await this.msalInstance.acquireTokenSilent(request);
      return false;
    } catch (error) {
      return true;
    }
  }

  /**
   * Refresh tokens
   */
  async refreshTokens(): Promise<boolean> {
    if (!this.account) return false;

    try {
      const request: SilentRequest = {
        account: this.account,
        scopes: tokenRequest.scopes,
        forceRefresh: true,
      };
      
      const response = await this.msalInstance.acquireTokenSilent(request);
      return !!response.accessToken;
    } catch (error) {
      console.error('Failed to refresh tokens:', error);
      return false;
    }
  }

  /**
   * Get MSAL instance (for advanced use cases)
   */
  getMsalInstance(): PublicClientApplication {
    return this.msalInstance;
  }
}

// Singleton instance
let authServiceInstance: AuthService | null = null;

export const getAuthService = (): AuthService => {
  if (!authServiceInstance) {
    authServiceInstance = new AuthService();
  }
  return authServiceInstance;
};