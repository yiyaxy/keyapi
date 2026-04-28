import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { session as sessions } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import { createNanoId } from '@lobechat/database';
import { UserService } from '@/server/services/user';

const nanoid = createNanoId(32);
const idGen = createNanoId(16);

interface NewApiUserInfo {
  id: number;
  username: string;
  email: string;
  display_name: string;
  tenant_id: number;
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
      // 不跟踪重定向，快速失败
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

  // token 缺失 → 直接跳首页（无感降级）
  if (!token) {
    return buildRedirect(request, settings);
  }

  // 1. 向 new-api 验证 token 并获取用户信息
  const apiUser = await fetchNewApiUser(token);
  if (!apiUser) {
    return buildRedirect(request, settings);
  }

  // 2. 构建 LobeHub 用户的稳定 ID（前缀防止与 BetterAuth 内置 ID 冲突）
  const lobeUserId = `newapi_${apiUser.id}`;
  const email = apiUser.email?.trim() || `newapi_${apiUser.id}@internal.local`;
  const displayName = apiUser.display_name?.trim() || apiUser.username || `用户${apiUser.id}`;

  try {
    // 3. Upsert 用户（首次自动创建，后续只更新活跃时间）
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
        fullName: displayName,
        username: `newapi_${apiUser.id}`,
        emailVerified: true,
        lastActiveAt: new Date(),
      });

      // 触发 initUser（分析上报等），与 BetterAuth OAuth 登录一致
      const userService = new UserService(serverDB);
      await userService.initUser({
        id: lobeUserId,
        email,
        username: `newapi_${apiUser.id}`,
        createdAt: new Date(),
      });
    } else {
      await serverDB
        .update(users)
        .set({ lastActiveAt: new Date() })
        .where(eq(users.id, lobeUserId));
    }

    // 4. 创建 BetterAuth 会话
    const sessionToken = nanoid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天

    await serverDB.insert(sessions).values({
      id: idGen(),
      userId: lobeUserId,
      token: sessionToken,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '',
      userAgent: request.headers.get('user-agent') || '',
    });

    // 5. 设置 session cookie 并跳转
    const response = buildRedirect(request, settings);
    response.cookies.set('better-auth.session_token', sessionToken, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: expiresAt,
    });
    return response;
  } catch (err) {
    console.error('[token-login] error:', err);
    // 出错时降级：不带 session 跳转，用户仍可匿名使用（settings 里的 key 仍有效）
    return buildRedirect(request, settings);
  }
}

function buildRedirect(request: NextRequest, settings: string | null) {
  const origin = new URL(request.url).origin;
  const target = new URL('/', origin);
  if (settings) {
    target.searchParams.set('settings', settings);
  }
  return NextResponse.redirect(target);
}
