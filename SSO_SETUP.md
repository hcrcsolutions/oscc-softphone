# Microsoft Entra ID SSO Setup Guide

## Prerequisites

1. **Azure AD Tenant** - You need access to an Azure AD tenant
2. **Admin Permissions** - Ability to register applications in Azure AD

## Step 1: Register Application in Azure AD

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **+ New registration**
4. Fill out the form:
   - **Name**: `OSCC Softphone`
   - **Supported account types**: Choose based on your needs
   - **Redirect URI**: Select `Single-page application (SPA)` and enter `http://localhost:3000`
5. Click **Register**

## Step 2: Configure Application

1. On the app registration page, note the **Application (client) ID**
2. Go to **Authentication** tab:
   - Add additional redirect URIs if needed
   - Enable **Access tokens** and **ID tokens**
3. Go to **API permissions** tab:
   - Ensure `User.Read` permission is present
   - Add any additional permissions your app needs
4. Go to **Token configuration** (optional):
   - Add optional claims if needed

## Step 3: Configure Environment Variables

1. Copy the environment template:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` with your Azure AD values:
   ```bash
   # Your Application (client) ID from Step 2
   NEXT_PUBLIC_AZURE_CLIENT_ID=your-client-id-here
   
   # Your tenant ID (or use 'common' for multi-tenant)
   NEXT_PUBLIC_AZURE_AUTHORITY=https://login.microsoftonline.com/your-tenant-id
   
   # Redirect URIs (must match Azure AD configuration)
   NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000
   NEXT_PUBLIC_POST_LOGOUT_URI=http://localhost:3000
   ```

## Step 4: Test the Integration

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open [http://localhost:3000](http://localhost:3000)

3. Click the **"Sign in with Microsoft"** button in the header

4. You should be redirected to Microsoft login page

5. After successful authentication, you'll see your user info in the header

## Troubleshooting

### Common Issues:

1. **CORS Error**: Make sure your redirect URI in Azure AD exactly matches your app URL
2. **Invalid Client**: Double-check your Client ID in the environment variables
3. **Permissions Error**: Ensure your app has the necessary API permissions granted

### Enable Detailed Logging:

The auth service includes detailed console logging. Open browser DevTools → Console to see authentication flow details.

## Production Deployment

For production deployment:

1. Update redirect URIs in Azure AD to include your production domain
2. Update environment variables with production URLs
3. Consider using Azure Key Vault for storing sensitive configuration
4. Enable additional security features like Conditional Access policies

## User Experience

- **First-time users**: Will see a "Sign in with Microsoft" button
- **Authenticated users**: Will see their profile picture/initials and name in the header
- **Dropdown menu**: Provides access to Profile, Settings, and Sign Out
- **Automatic token refresh**: Tokens are refreshed automatically every 5 minutes
- **Session persistence**: Users stay logged in across browser sessions

## API Integration

To make authenticated API calls:

```typescript
import { useAuth } from '@/contexts/AuthContext';

const { getAccessToken } = useAuth();

const token = await getAccessToken(['User.Read']);
const response = await fetch('/api/protected-endpoint', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

## Next Steps

- Configure additional scopes if needed
- Implement role-based access control using Azure AD roles
- Add Microsoft Graph API integration for enhanced user data
- Set up B2B/B2C scenarios if needed