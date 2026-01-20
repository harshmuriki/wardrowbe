import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const pocketIdUrl = process.env.POCKETID_URL;
  const tinyAuthUrl = process.env.TINYAUTH_URL;

  // Determine logout URL based on auth mode
  let logoutUrl: string;

  if (pocketIdUrl) {
    // Direct Pocket ID OIDC mode - use Pocket ID's end-session endpoint
    logoutUrl = `${pocketIdUrl}/api/oidc/end-session?post_logout_redirect_uri=${encodeURIComponent(appUrl + '/login')}`;
  } else if (tinyAuthUrl) {
    // TinyAuth forward-auth mode
    logoutUrl = `${tinyAuthUrl}/logout?redirect_uri=${encodeURIComponent(appUrl)}`;
  } else {
    // Dev mode - just redirect to login
    logoutUrl = `${appUrl}/login`;
  }

  // Clear NextAuth session by redirecting through signout then to external logout
  const signOutUrl = `${appUrl}/api/auth/signout?callbackUrl=${encodeURIComponent(logoutUrl)}`;

  return NextResponse.redirect(signOutUrl);
}
