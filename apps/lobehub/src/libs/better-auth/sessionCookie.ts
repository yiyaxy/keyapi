import { createHmac } from 'node:crypto';

import { type NextRequest, type NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';

interface SetBetterAuthSessionCookieOptions {
  expiresAt: Date;
  request: NextRequest;
  response: NextResponse;
  sessionToken: string;
}

const getBetterAuthSecret = () => authEnv.AUTH_SECRET || process.env.BETTER_AUTH_SECRET;

const signCookieValue = (value: string) => {
  const secret = getBetterAuthSecret();
  if (!secret)
    throw new Error('AUTH_SECRET or BETTER_AUTH_SECRET is required to sign session cookie');

  const signature = createHmac('sha256', secret).update(value).digest('base64');
  return encodeURIComponent(`${value}.${signature}`);
};

export const setBetterAuthSessionCookie = ({
  expiresAt,
  request,
  response,
  sessionToken,
}: SetBetterAuthSessionCookieOptions) => {
  const secure = new URL(request.url).protocol === 'https:';
  const cookieName = `${secure ? '__Secure-' : ''}better-auth.session_token`;
  const cookie = [
    `${cookieName}=${signCookieValue(sessionToken)}`,
    'Path=/',
    `Expires=${expiresAt.toUTCString()}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');

  response.headers.append('Set-Cookie', cookie);
};
