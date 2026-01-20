import { NextAuthOptions } from 'next-auth';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { headers } from 'next/headers';

interface OIDCProfile {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  picture?: string;
}

// Forward auth mode: trust Remote-User header from nginx/TinyAuth
const isForwardAuth = process.env.AUTH_TRUST_PROXY === 'true';

const AuthentikProvider: OAuthConfig<OIDCProfile> = {
  id: 'authentik',
  name: 'Authentik',
  type: 'oauth',
  wellKnown: `${process.env.AUTHENTIK_URL}/.well-known/openid-configuration`,
  clientId: process.env.AUTHENTIK_CLIENT_ID!,
  clientSecret: process.env.AUTHENTIK_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: 'openid email profile',
    },
  },
  idToken: true,
  checks: ['pkce', 'state'],
  profile(profile) {
    return {
      id: profile.sub,
      name: profile.name || profile.preferred_username,
      email: profile.email,
      image: profile.picture,
    };
  },
};

// Pocket ID OIDC provider - direct connection to Pocket ID
const PocketIDProvider: OAuthConfig<OIDCProfile> = {
  id: 'pocketid',
  name: 'Pocket ID',
  type: 'oauth',
  wellKnown: `${process.env.POCKETID_URL}/.well-known/openid-configuration`,
  clientId: process.env.POCKETID_CLIENT_ID!,
  clientSecret: process.env.POCKETID_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: 'openid email profile',
    },
  },
  idToken: true,
  checks: ['pkce', 'state'],
  profile(profile) {
    return {
      id: profile.sub,
      name: profile.name || profile.preferred_username,
      email: profile.email,
      image: profile.picture,
    };
  },
};

// Forward auth provider - uses Remote-User header from nginx/TinyAuth
const ForwardAuthProvider = CredentialsProvider({
  id: 'forward-auth',
  name: 'Login',
  credentials: {},
  async authorize(credentials, req) {
    // Get Remote-User header set by nginx/TinyAuth
    const headersList = headers();
    const remoteUser = headersList.get('remote-user') || headersList.get('x-remote-user');
    const remoteEmail = headersList.get('remote-email') || headersList.get('x-remote-email');
    const remoteName = headersList.get('remote-name') || headersList.get('x-remote-name');
    const remotePhoto = headersList.get('remote-photo') || headersList.get('x-remote-photo');

    if (!remoteUser) {
      // No forward auth header - reject
      return null;
    }

    return {
      id: remoteUser,
      email: remoteEmail || `${remoteUser}@forward-auth.local`,
      name: remoteName || remoteUser,
      image: remotePhoto || null,
    };
  },
});

// Dev credentials provider - for local development only
const DevCredentialsProvider = CredentialsProvider({
  id: 'dev-credentials',
  name: 'Dev Login',
  credentials: {
    email: { label: 'Email', type: 'email', placeholder: 'dev@example.com' },
    name: { label: 'Name', type: 'text', placeholder: 'Dev User' },
  },
  async authorize(credentials) {
    if (!credentials?.email) {
      return null;
    }

    // In dev mode, accept any email/name combination
    const email = credentials.email;
    const name = credentials.name || email.split('@')[0];
    const id = email.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    return {
      id,
      email,
      name,
      image: null,
    };
  },
});

// Determine which provider to use
function getProviders() {
  // Pocket ID OIDC (direct connection, supports profile pictures)
  if (process.env.POCKETID_URL) {
    return [PocketIDProvider];
  }
  // Authentik OIDC
  if (process.env.AUTHENTIK_URL) {
    return [AuthentikProvider];
  }
  // Forward auth via TinyAuth (no profile picture support)
  if (isForwardAuth) {
    return [ForwardAuthProvider];
  }
  // Default to dev credentials for local development
  return [DevCredentialsProvider];
}

export const authOptions: NextAuthOptions = {
  providers: getProviders(),
  callbacks: {
    async jwt({ token, user, trigger }) {
      const apiUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000';

      // Session update triggered - refresh user data from backend
      if (trigger === 'update' && token.accessToken) {
        try {
          const response = await fetch(`${apiUrl}/api/v1/users/me`, {
            headers: {
              'Authorization': `Bearer ${token.accessToken}`,
            },
          });

          if (response.ok) {
            const userData = await response.json();
            return {
              ...token,
              onboardingCompleted: userData.onboarding_completed,
            };
          }
        } catch (error) {
          console.error('Failed to refresh user data:', error);
        }
        return token;
      }

      // Initial sign in - sync with backend and get API token
      if (user) {
        try {
          const response = await fetch(`${apiUrl}/api/v1/auth/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              external_id: user.id,
              email: user.email,
              display_name: user.name || user.email?.split('@')[0] || 'User',
              avatar_url: user.image,
            }),
          });

          if (response.ok) {
            const syncData = await response.json();
            return {
              ...token,
              accessToken: syncData.access_token,
              sub: user.id,
              backendUserId: syncData.id,
              isNewUser: syncData.is_new_user,
              onboardingCompleted: syncData.onboarding_completed,
            };
          }
        } catch (error) {
          console.error('Failed to sync user to backend:', error);
        }

        return {
          ...token,
          sub: user.id,
        };
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub,
        },
        accessToken: token.accessToken,
        isNewUser: token.isNewUser,
        onboardingCompleted: token.onboardingCompleted,
      };
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export { isForwardAuth };
