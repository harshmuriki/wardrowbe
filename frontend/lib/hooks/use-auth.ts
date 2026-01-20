'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession, signOut } from 'next-auth/react';
import { api, setAccessToken, ApiError } from '@/lib/api';
import type { UserProfile } from './use-user';

export function useAuth() {
  const { data: session, status } = useSession();
  const signingOut = useRef(false);

  if (session?.accessToken) {
    setAccessToken(session.accessToken as string);
  }

  const hasToken = !!session?.accessToken;

  const userQuery = useQuery({
    queryKey: ['auth-user'],
    queryFn: () => api.get<UserProfile>('/users/me'),
    enabled: status === 'authenticated' && hasToken,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (
      userQuery.error instanceof ApiError &&
      userQuery.error.status === 401 &&
      !signingOut.current
    ) {
      signingOut.current = true;
      signOut({ redirect: false }).then(() => {
        signingOut.current = false;
      });
    }
  }, [userQuery.error]);

  const isAuthenticated = userQuery.isSuccess && !!userQuery.data;
  const isLoading = status === 'loading' || userQuery.isLoading;

  return {
    user: userQuery.data,
    isAuthenticated,
    isLoading,
    error: userQuery.error,
    session,
    sessionStatus: status,
  };
}
