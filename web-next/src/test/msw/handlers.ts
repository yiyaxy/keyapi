import { HttpResponse, http } from 'msw';

const okUser = {
  id: 42,
  username: 'alice',
  email: 'alice@example.com',
  display_name: 'Alice',
  role: 1,
  platform_role: 0,
  tenant_role: 0,
  tenant_id: 1,
  group: 'default',
  quota: 100000,
  used_quota: 25000,
};

export const handlers = [
  http.get('/api/user/self', ({ request }) => {
    if (!request.headers.get('new-api-user')) {
      return HttpResponse.json({ success: false, message: 'unauthorized' }, { status: 401 });
    }
    return HttpResponse.json({ success: true, data: okUser });
  }),

  http.post('/api/user/login', async ({ request }) => {
    const body = (await request.json()) as { username?: string; password?: string };
    if (body?.password === 'wrong') {
      return HttpResponse.json({ success: false, message: '密码错误' });
    }
    return HttpResponse.json({
      success: true,
      data: { id: okUser.id, tenant_id: okUser.tenant_id },
    });
  }),

  http.post('/api/user/logout', () => HttpResponse.json({ success: true })),

  http.post('/api/user/register', () => HttpResponse.json({ success: true })),

  http.get('/api/verification', () =>
    HttpResponse.json({ success: true, message: '验证码已发送' })
  ),

  http.get('/api/reset_password', () =>
    HttpResponse.json({ success: true, message: '重置邮件已发送' })
  ),

  http.post('/api/user/reset', () => HttpResponse.json({ success: true, data: 'Gx7kPq2mN9vR' })),

  http.get('/api/oauth/wechat', ({ request }) => {
    const code = new URL(request.url).searchParams.get('code');
    if (!code || code === 'bad') {
      return HttpResponse.json({ success: false, message: '验证码无效' });
    }
    return HttpResponse.json({
      success: true,
      data: { id: okUser.id, tenant_id: okUser.tenant_id },
    });
  }),
];
