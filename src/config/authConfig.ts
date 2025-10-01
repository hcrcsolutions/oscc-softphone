/**
 * Microsoft Entra ID (Azure AD) Authentication Configuration
 * 
 * This module configures the Microsoft Authentication Library (MSAL) for single sign-on
 * Replace the placeholder values with your actual Azure AD application settings
 */

import { Configuration, PopupRequest, RedirectRequest, SilentRequest } from '@azure/msal-browser';

// Azure AD Application Settings
// TODO: Move these to environment variables in production
export const msalConfig: Configuration = {
  auth: {
    // Your Azure AD Application (client) ID
    clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || 'YOUR_CLIENT_ID_HERE',
    
    // Authority URL - typically https://login.microsoftonline.com/{tenant}
    // Use 'common' for multi-tenant, or your specific tenant ID
    authority: process.env.NEXT_PUBLIC_AZURE_AUTHORITY || 'https://login.microsoftonline.com/common',
    
    // Redirect URI - must be registered in Azure AD
    redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI || (typeof window !== 'undefined' ? `${window.location.origin}/sso/auth-callback` : 'http://localhost:3000/sso/auth-callback'),
    
    // Post-logout redirect URI
    postLogoutRedirectUri: process.env.NEXT_PUBLIC_POST_LOGOUT_URI || typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    
    // Navigate to login page immediately on load if not authenticated
    navigateToLoginRequestUrl: true,
  },
  cache: {
    // Cache location - 'sessionStorage' or 'localStorage'
    cacheLocation: 'sessionStorage',
    
    // Enable storage of auth state in cookie for IE11 or Edge
    storeAuthStateInCookie: false,
  },
  system: {
    // Logger options
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) {
          return;
        }
        switch (level) {
          case 0: // Error
            console.error(message);
            return;
          case 1: // Info
            console.info(message);
            return;
          case 2: // Verbose
            console.debug(message);
            return;
          case 3: // Warning
            console.warn(message);
            return;
        }
      },
      piiLoggingEnabled: false,
      logLevel: 3,
    },
    
    // Token renewal offset in seconds (5 minutes before expiry)
    tokenRenewalOffsetSeconds: 300,
  },
};

// Scopes for ID token
export const loginRequest: PopupRequest | RedirectRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
  prompt: 'select_account', // Force account selection even if single account
};

// Scopes for access token to call APIs
export const tokenRequest: SilentRequest = {
  scopes: ['User.Read', 'User.ReadBasic.All'],
  forceRefresh: false,
};

// Graph API endpoint
export const graphConfig = {
  graphMeEndpoint: 'https://graph.microsoft.com/v1.0/me',
  graphUsersEndpoint: 'https://graph.microsoft.com/v1.0/users',
};

// Application specific roles (optional - if using app roles)
export const appRoles = {
  Admin: 'Admin',
  User: 'User',
  Viewer: 'Viewer',
};