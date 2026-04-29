import { createNanoId } from '@lobechat/database';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { session as sessions } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import { setBetterAuthSessionCookie } from '@/libs/better-auth/sessionCookie';
import { UserService } from '@/server/services/user';

const nanoid = createNanoId(32);
const idGen = createNanoId(16);

interface NewApiUserInfo {
  display_name: string;
  email: string;
  id: number;
  tenant_id: number;
  username: string;
}

async function fetchNewApiUser(token: string): Promise<NewApiUserInfo | null> {
  const baseUrl = process.env.NEW_API_BASE_URL;
  if (!baseUrl) {
    console.error('[token-login] NEW_API_BASE_URL is not set');
    return null;
  }

  try {
    const res = await fetch(`${baseUrl}/api/app/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
    });
    if (!res.ok) return null;

    const body = await res.json();
    if (!body.success || !body.data) return null;

    return body.data as NewApiUserInfo;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const settings = searchParams.get('settings');
  const callbackUrl = searchParams.get('callbackUrl');

  if (!token) {
    return buildRedirect(request, settings, callbackUrl);
  }

  const apiUser = await fetchNewApiUser(token);
  if (!apiUser) {
    return buildRedirect(request, settings, callbackUrl);
  }

  const lobeUserId = `newapi_${apiUser.id}`;
  const email = apiUser.email?.trim() || `newapi_${apiUser.id}@internal.local`;
  const displayName = apiUser.display_name?.trim() || apiUser.username || `user${apiUser.id}`;

  try {
    const existingUsers = await serverDB
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, lobeUserId))
      .limit(1);

    const isNew = existingUsers.length === 0;

    if (isNew) {
      await serverDB.insert(users).values({
        id: lobeUserId,
        email,
        emailVerified: true,
        fullName: displayName,
        lastActiveAt: new Date(),
        username: `newapi_${apiUser.id}`,
      });

      const userService = new UserService(serverDB);
      await userService.initUser({
        createdAt: new Date(),
        email,
        id: lobeUserId,
        username: `newapi_${apiUser.id}`,
      });
    } else {
      await serverDB
        .update(users)
        .set({ lastActiveAt: new Date() })
        .where(eq(users.id, lobeUserId));
    }

    const sessionToken = nanoid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await serverDB.insert(sessions).values({
      createdAt: new Date(),
      expiresAt,
      id: idGen(),
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '',
      token: sessionToken,
      updatedAt: new Date(),
      userAgent: request.headers.get('user-agent') || '',
      userId: lobeUserId,
    });

    const response = buildRedirect(request, settings, callbackUrl);
    setBetterAuthSessionCookie({ expiresAt, request, response, sessionToken });

    return response;
  } catch (err) {
    console.error('[token-login] error:', err);
    return buildRedirect(request, settings, callbackUrl);
  }
}

// 反代后 request.url 是容器内监听地址（http://0.0.0.0:3210/...），
// 直接拿来跳转浏览器会进 0.0.0.0。优先用 APP_URL 拿公网 origin，
// 没设置时（典型是 next dev）才退回 request.url。
function getPublicOrigin(request: NextRequest): string {
  if (process.env.APP_URL) {
    return new URL(process.env.APP_URL).origin;
  }
  return new URL(request.url).origin;
}

function buildRedirect(request: NextRequest, settings: string | null, callbackUrl?: null | string) {
  const origin = getPublicOrigin(request);
  let target = new URL('/', origin);

  if (callbackUrl) {
    try {
      const parsedCallbackUrl = new URL(callbackUrl, origin);
      if (parsedCallbackUrl.origin === origin) {
        target = parsedCallbackUrl;
      }
    } catch {
      // Ignore invalid callback URLs.
    }
  }

  target.searchParams.delete('token');
  if (settings) {
    target.searchParams.set('settings', settings);
  }

  return NextResponse.redirect(target);
}
