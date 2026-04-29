import { createNanoId } from '@lobechat/database';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { session as sessions } from '@/database/schemas/betterAuth';
import { userSettings, users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import { setBetterAuthSessionCookie } from '@/libs/better-auth/sessionCookie';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
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

type ProviderKeyVaults = Record<string, Record<string, unknown>>;

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
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '<unreadable>');
      console.error(
        `[token-login] whoami HTTP ${res.status} from ${baseUrl}: ${bodyText.slice(0, 200)}`
      );
      return null;
    }

    const body = await res.json();
    if (!body.success || !body.data) {
      console.error('[token-login] whoami returned non-success body:', body);
      return null;
    }

    return body.data as NewApiUserInfo;
  } catch (err) {
    console.error(`[token-login] whoami fetch failed (baseUrl=${baseUrl}):`, err);
    return null;
  }
}

async function decryptKeyVaults(
  encryptedKeyVaults: null | string,
  gateKeeper: KeyVaultsGateKeeper
): Promise<ProviderKeyVaults> {
  if (!encryptedKeyVaults) return {};

  const { plaintext, wasAuthentic } = await gateKeeper.decrypt(encryptedKeyVaults);
  if (!wasAuthentic || !plaintext) return {};

  try {
    return JSON.parse(plaintext) as ProviderKeyVaults;
  } catch (err) {
    console.error('[token-login] failed to parse existing keyVaults:', err);
    return {};
  }
}

async function saveOpenAIKeyVault(userId: string, apiKey: string) {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const existingSettings = await serverDB
    .select({ keyVaults: userSettings.keyVaults })
    .from(userSettings)
    .where(eq(userSettings.id, userId))
    .limit(1);

  const currentKeyVaults = await decryptKeyVaults(
    existingSettings[0]?.keyVaults ?? null,
    gateKeeper
  );
  const currentOpenAIVault =
    currentKeyVaults.openai && typeof currentKeyVaults.openai === 'object'
      ? currentKeyVaults.openai
      : {};

  const nextKeyVaults = {
    ...currentKeyVaults,
    openai: {
      ...currentOpenAIVault,
      apiKey,
    },
  };
  const encryptedKeyVaults = await gateKeeper.encrypt(JSON.stringify(nextKeyVaults));

  await serverDB
    .insert(userSettings)
    .values({ id: userId, keyVaults: encryptedKeyVaults })
    .onConflictDoUpdate({
      set: { keyVaults: encryptedKeyVaults },
      target: userSettings.id,
    });
}

async function handleTokenLogin(
  request: NextRequest,
  token: null | string,
  callbackUrl?: null | string
) {
  if (!token) return buildRedirect(request, callbackUrl);

  const apiUser = await fetchNewApiUser(token);
  if (!apiUser) return buildRedirect(request, callbackUrl);

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

    await saveOpenAIKeyVault(lobeUserId, token);

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

    const response = buildRedirect(request, callbackUrl);
    setBetterAuthSessionCookie({ expiresAt, request, response, sessionToken });

    return response;
  } catch (err) {
    console.error('[token-login] error:', err);
    return buildRedirect(request, callbackUrl);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  return handleTokenLogin(request, searchParams.get('token'), searchParams.get('callbackUrl'));
}

export async function POST(request: NextRequest) {
  const form = await request.formData();

  return handleTokenLogin(
    request,
    form.get('token')?.toString() || null,
    form.get('callbackUrl')?.toString() || null
  );
}

function getPublicOrigin(request: NextRequest): string {
  if (process.env.APP_URL) {
    return new URL(process.env.APP_URL).origin;
  }
  return new URL(request.url).origin;
}

function buildRedirect(request: NextRequest, callbackUrl?: null | string) {
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
  target.searchParams.delete('settings');

  return NextResponse.redirect(target);
}
