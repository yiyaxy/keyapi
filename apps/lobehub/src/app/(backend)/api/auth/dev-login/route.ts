/**
 * 仅开发环境可用的一键登录接口。
 * 访问 http://localhost:3010/api/auth/dev-login 即可自动创建并登录测试账号。
 * 生产环境直接返回 404，不会暴露。
 */
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { session as sessions } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import { createNanoId } from '@lobechat/database';
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
    // 1. Upsert 开发测试用户
    const existing = await serverDB
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, DEV_USER_ID))
      .limit(1);

    if (existing.length === 0) {
      await serverDB.insert(users).values({
        id: DEV_USER_ID,
        email: DEV_USER_EMAIL,
        fullName: '本地开发账号',
        username: 'dev_local',
        emailVerified: true,
        lastActiveAt: new Date(),
      });

      const userService = new UserService(serverDB);
      await userService.initUser({
        id: DEV_USER_ID,
        email: DEV_USER_EMAIL,
        username: 'dev_local',
        createdAt: new Date(),
      });
    } else {
      await serverDB
        .update(users)
        .set({ lastActiveAt: new Date() })
        .where(eq(users.id, DEV_USER_ID));
    }

    // 2. 创建新 session（30天有效期）
    const sessionToken = nanoid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await serverDB.insert(sessions).values({
      id: idGen(),
      userId: DEV_USER_ID,
      token: sessionToken,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: '127.0.0.1',
      userAgent: request.headers.get('user-agent') || '',
    });

    // 3. 写 cookie 并跳转首页
    const response = NextResponse.redirect(new URL('/', request.url));
    response.cookies.set('better-auth.session_token', sessionToken, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: false, // 本地开发不用 https
      expires: expiresAt,
    });

    return response;
  } catch (err) {
    console.error('[dev-login] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
