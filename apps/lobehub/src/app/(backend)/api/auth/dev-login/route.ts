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

const DEV_USER_ID = 'dev_local_user';
const DEV_USER_EMAIL = 'dev@local.dev';

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const existing = await serverDB
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, DEV_USER_ID))
      .limit(1);

    if (existing.length === 0) {
      await serverDB.insert(users).values({
        id: DEV_USER_ID,
        email: DEV_USER_EMAIL,
        emailVerified: true,
        fullName: 'Local Dev User',
        lastActiveAt: new Date(),
        username: 'dev_local',
      });

      const userService = new UserService(serverDB);
      await userService.initUser({
        createdAt: new Date(),
        email: DEV_USER_EMAIL,
        id: DEV_USER_ID,
        username: 'dev_local',
      });
    } else {
      await serverDB
        .update(users)
        .set({ lastActiveAt: new Date() })
        .where(eq(users.id, DEV_USER_ID));
    }

    const sessionToken = nanoid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await serverDB.insert(sessions).values({
      createdAt: new Date(),
      expiresAt,
      id: idGen(),
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1',
      token: sessionToken,
      updatedAt: new Date(),
      userAgent: request.headers.get('user-agent') || '',
      userId: DEV_USER_ID,
    });

    const response = NextResponse.redirect(getCallbackUrl(request));
    setBetterAuthSessionCookie({ expiresAt, request, response, sessionToken });

    return response;
  } catch (err) {
    console.error('[dev-login] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function getCallbackUrl(request: NextRequest) {
  const url = new URL(request.url);
  const callbackUrl = url.searchParams.get('callbackUrl');
  const fallbackUrl = new URL('/', url.origin);

  if (!callbackUrl) return fallbackUrl;

  try {
    const parsedCallbackUrl = new URL(callbackUrl, url.origin);
    return parsedCallbackUrl.origin === url.origin ? parsedCallbackUrl : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}
