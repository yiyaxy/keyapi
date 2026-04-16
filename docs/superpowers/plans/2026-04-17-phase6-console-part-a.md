# Plan 2 Part A — 租户 Console 前端基础 + 首发两页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端从"0 租户感知"推到"有租户 Console 雏形 + 2 个首发页面（租户信息 / 成员管理）"，让 `/api/tenant/info` / `/api/tenant/members` / `/api/tenant/invite` / `/api/tenant/members (PUT/DELETE)` 变得可用。

**Architecture:**
- 引入前端租户态到 **localStorage** 与 **UserContext**：登录响应里已有 `tenant_id`（backend session 注入），前端只需读取并在 axios 请求头注入 `X-Tenant-Id`。
- 不做租户**切换**（多 membership 用户选择 tenant）— 留给 Part D。Part A 只做"单租户感知"：当前 session 对应哪个 tenant 就操作哪个 tenant。
- 复用 `components/table/users/` 的 **CardPro + Table + Filters + Actions + Hook + Modal** 结构模板，原样搬到 `components/tenant/members/`。
- 路由与侧边栏：新增 `/console/tenant-info` / `/console/tenant-members`，用现有 `AdminRoute`（platform admin 可进；tenant-only admin 暂不放行，Part D 再升级为 `TenantAdminRoute`）。
- 后端 API 已全部就绪（commit `4d7a63e`，router/api-router.go:601-617），本 plan 不改后端代码。

**Tech Stack:** React 18 + Vite + Semi Design UI (`@douyinfe/semi-ui`) + Tailwind + Bun 作为包管理器 + i18next。

**Preconditions:**
- 后端分支在 `dev`，commit ≥ `4d7a63e`（Plan 1 review fixes 已合并）。
- 当前用户是 **platform admin**（role ≥ 10）才能进入菜单；tenant-only admin 放行留到 Part D。
- 项目未部署，不需要迁移或数据回填。

**Non-Goals（Part A 不做，后续 Part B/C/D）：**
- 租户计划页 / 租户配置页（Part B）
- 监控/告警前端（Part C）
- 租户切换器（用户在多个租户间切换，Part D）
- 邀请邮件投递（阶段 A 并行任务，独立 plan）
- 平台级租户管理（`/api/platform/tenants`）— 晚一点做 Part B 时一起

---

## File Structure

**Create（12 个新文件）:**

_Types（1 个）_
- `web/src/types/tenant.ts` — Tenant、TenantMembership、TenantMemberListItem、InviteResponse、TenantRole/Status 常量

_Pages（2 个页面壳）_
- `web/src/pages/Tenant/index.jsx` — 租户信息页（简单包 Card 容器）
- `web/src/pages/TenantMembers/index.jsx` — 成员管理页（包 Table 容器）

_Components（9 个）_
- `web/src/components/tenant/info/TenantInfoCard.jsx` — Semi Card + Form，显示/编辑租户 Name/Status
- `web/src/components/tenant/info/useTenantInfo.js` — fetch `GET /api/tenant/info` + submit `PUT /api/tenant/`
- `web/src/components/tenant/members/index.jsx` — 容器：组合 Filters + Actions + Table + Modals
- `web/src/components/tenant/members/TenantMembersTable.jsx` — Semi Table + 列定义
- `web/src/components/tenant/members/TenantMembersFilters.jsx` — keyword + status 下拉
- `web/src/components/tenant/members/TenantMembersActions.jsx` — "邀请成员"按钮
- `web/src/components/tenant/members/useTenantMembersData.js` — list/invite/updateRole/remove CRUD
- `web/src/components/tenant/members/modals/InviteMemberModal.jsx`
- `web/src/components/tenant/members/modals/EditMemberRoleModal.jsx`

**Modify（4 个）:**
- `web/src/helpers/api.js` — 注入 `X-Tenant-Id` 请求拦截器（从 localStorage.user.tenant_id 读）
- `web/src/context/User/reducer.js` — user object 现已含 tenant_id（backend 已注入 session），前端不需要新字段，但要确认 LOGIN/FETCH_USER 的 payload 透传
- `web/src/App.jsx` — 注册 2 个新路由
- `web/src/hooks/common/useSidebar.js` — 在 `DEFAULT_ADMIN_CONFIG` 新增 `tenant` 分组

**Testing:** 前端无单测基础设施，验证以 `bun run build` + `bun run lint` 通过 + 人工 smoke test checklist 为准。

---

## Task 1：新增 TS 类型定义

**Files:**
- Create: `web/src/types/tenant.ts`

- [ ] **Step 1: 定位 backend 的真实字段**

参考以下后端 struct（已阅读确认）：
- `model/tenant.go:8-15` → `Tenant{id, name, slug, status, created_at, updated_at}`
- `model/tenant_membership.go:319-335` → `TenantMemberListItem{id, tenant_id, user_id, username, display_name, email, tenant_role, platform_role, role (effective), membership_status, status (user), group, quota, used_quota, request_count}`
- `model/tenant_membership.go:26-33` → `TenantRoleMember=1`（common.RoleCommonUser）、`TenantRoleAdmin=10`（common.RoleAdminUser）、`TenantMembershipStatusActive=1`、`Disabled=2`、`Removed=3`

- [ ] **Step 2: 创建 tenant.ts**

文件内容完整如下：
```typescript
// Tenant model types — keep in sync with model/tenant.go and model/tenant_membership.go.

export const TenantStatus = {
  Active: 1,
  Suspended: 2,
  Deleted: 3,
} as const;
export type TenantStatusValue = (typeof TenantStatus)[keyof typeof TenantStatus];

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  status: TenantStatusValue;
  created_at: number;
  updated_at: number;
}

export const TenantRole = {
  Member: 1,  // common.RoleCommonUser
  Admin: 10,  // common.RoleAdminUser
} as const;
export type TenantRoleValue = (typeof TenantRole)[keyof typeof TenantRole];

export const TenantMembershipStatus = {
  Active: 1,
  Disabled: 2,
  Removed: 3,
} as const;
export type TenantMembershipStatusValue =
  (typeof TenantMembershipStatus)[keyof typeof TenantMembershipStatus];

export interface TenantMembership {
  id: number;
  tenant_id: number;
  user_id: number;
  role: TenantRoleValue;
  status: TenantMembershipStatusValue;
  invited_by: number;
  created_at: number;
  updated_at: number;
}

export interface TenantMemberListItem {
  id: number;
  tenant_id: number;
  user_id: number;
  username: string;
  display_name: string;
  email: string;
  tenant_role: TenantRoleValue;
  platform_role: number;
  role: number; // effective role
  membership_status: TenantMembershipStatusValue;
  status: number; // user.status
  group: string;
  quota: number;
  used_quota: number;
  request_count: number;
}

// POST /api/tenant/invite response (union)
export interface InviteJoinedResponse {
  status: 'joined';
  user_id: number;
  email: string;
}
export interface InviteCreatedResponse {
  status: 'invited';
  email: string;
  token: string;
}
export type InviteResponse = InviteJoinedResponse | InviteCreatedResponse;
```

- [ ] **Step 3: 在 api.ts 中 re-export**

编辑 `web/src/types/api.ts`，在文件末尾追加：
```typescript
export * from './tenant';
```
（若文件末尾已有 `export` 语句块则保留并追加上述行）

- [ ] **Step 4: 类型检查**

```bash
cd web && bun run build 2>&1 | tail -20
```
期望：无 TypeScript 类型错误（即使 .jsx 文件多，tenant.ts 本身应被 vite 正确处理）。

- [ ] **Step 5: Commit**

```bash
git add web/src/types/tenant.ts web/src/types/api.ts
git commit -m "feat(tenant-ui): add TypeScript types for Tenant/TenantMembership

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：在 axios 实例注入 X-Tenant-Id header

**Files:**
- Modify: `web/src/helpers/api.js`（在现有 API 实例 header 配置附近）

**背景：** 后端 TenantResolve 中间件优先从 `X-Tenant-Id` header 读租户；其次从 subdomain；最后 fallback session。前端登录后 session 里已有 tenant_id，但显式发 header 更稳（防止跨域/代理吃掉 cookie）。

- [ ] **Step 1: 读取 api.js 确认现状**

Read `web/src/helpers/api.js:1-50`。确认：
- 创建了一个名为 `API` 的 axios 实例（约 L18-30）
- headers 中已有 `New-API-User: getUserIdFromLocalStorage()`
- 没有 request 拦截器（或只有 GET 去重逻辑）

记录 axios 实例定义的行号区间。

- [ ] **Step 2: 添加读 tenant_id 的 helper**

在 `getUserIdFromLocalStorage()` 函数之后新增：
```javascript
function getTenantIdFromLocalStorage() {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return '';
    const u = JSON.parse(raw);
    // backend Session 注入的 user payload 里已有 tenant_id
    if (u && typeof u.tenant_id === 'number' && u.tenant_id > 0) {
      return String(u.tenant_id);
    }
    return '';
  } catch (e) {
    return '';
  }
}
```

- [ ] **Step 3: 在 API 实例的 headers 里加上 X-Tenant-Id**

把 axios.create 调用中的 headers 从：
```javascript
headers: {
  'New-API-User': getUserIdFromLocalStorage(),
  'Cache-Control': 'no-store',
},
```
改为：
```javascript
headers: {
  'New-API-User': getUserIdFromLocalStorage(),
  'X-Tenant-Id': getTenantIdFromLocalStorage(),
  'Cache-Control': 'no-store',
},
```

- [ ] **Step 4: 处理登录态变更后 header 不同步**

axios 实例的默认 headers 在实例创建时就固化。登录/登出后需要刷新。在 `API` 实例定义之后，新增一个请求拦截器覆盖：
```javascript
API.interceptors.request.use((config) => {
  const uid = getUserIdFromLocalStorage();
  const tid = getTenantIdFromLocalStorage();
  if (uid) config.headers['New-API-User'] = uid;
  if (tid) {
    config.headers['X-Tenant-Id'] = tid;
  } else {
    // 没有 tenant_id 时不发该 header，后端 fallback 到默认租户
    delete config.headers['X-Tenant-Id'];
  }
  return config;
});
```

**注意**：如果文件中已有其他 `API.interceptors.request.use(...)` 调用，合并到已有拦截器里，不要叠加多个。

- [ ] **Step 5: 编译验证**

```bash
cd web && bun run build 2>&1 | tail -10
```
期望：无错误。

- [ ] **Step 6: Commit**

```bash
git add web/src/helpers/api.js
git commit -m "feat(tenant-ui): inject X-Tenant-Id header on all API calls

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：租户信息页 — Hook

**Files:**
- Create: `web/src/components/tenant/info/useTenantInfo.js`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p web/src/components/tenant/info
```

- [ ] **Step 2: 编写 hook**

文件内容完整如下：
```javascript
import { useState, useCallback, useEffect } from 'react';
import { API, showError, showSuccess } from '../../../helpers';

/**
 * 当前租户信息的 fetch/update hook。
 * GET  /api/tenant/info  → { success, data: Tenant }
 * PUT  /api/tenant/       → { success, data: Tenant }
 */
export function useTenantInfo() {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/tenant/info');
      if (res?.data?.success) {
        setTenant(res.data.data);
      } else {
        showError(res?.data?.message || '加载租户信息失败');
      }
    } catch (err) {
      showError(err?.message || '加载租户信息失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(
    async ({ name, status }) => {
      setSubmitting(true);
      try {
        const payload = {};
        if (typeof name === 'string' && name.trim() !== '') payload.name = name.trim();
        if (typeof status === 'number' && status > 0) payload.status = status;
        const res = await API.put('/api/tenant/', payload);
        if (res?.data?.success) {
          setTenant(res.data.data);
          showSuccess('租户信息已更新');
          return true;
        }
        showError(res?.data?.message || '更新失败');
        return false;
      } catch (err) {
        showError(err?.message || '更新失败');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  return { tenant, loading, submitting, reload: load, update };
}
```

- [ ] **Step 3: 确认 helpers 可用**

```bash
grep -n "showError\|showSuccess\|export.*API" web/src/helpers/index.js web/src/helpers/api.js 2>&1 | head -20
```
期望：`API`、`showError`、`showSuccess` 均能从 `../../../helpers` 解构导入。如 `helpers/index.js` 没有 re-export，则需改相对路径为具体文件（如 `from '../../../helpers/api'`）。记录实际发现的路径。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/tenant/info/useTenantInfo.js
git commit -m "feat(tenant-ui): add useTenantInfo hook

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：租户信息页 — Card 组件

**Files:**
- Create: `web/src/components/tenant/info/TenantInfoCard.jsx`

- [ ] **Step 1: 编写组件**

文件内容完整如下：
```jsx
import React, { useEffect } from 'react';
import { Card, Form, Button, Typography, Tag, Spin } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { useTenantInfo } from './useTenantInfo';

const statusTag = (t, status) => {
  if (status === 1) return <Tag color='green'>{t('启用')}</Tag>;
  if (status === 2) return <Tag color='orange'>{t('已停用')}</Tag>;
  if (status === 3) return <Tag color='red'>{t('已删除')}</Tag>;
  return <Tag>{t('未知')}</Tag>;
};

export default function TenantInfoCard() {
  const { t } = useTranslation();
  const { tenant, loading, submitting, update } = useTenantInfo();
  const formRef = React.useRef();

  useEffect(() => {
    if (tenant && formRef.current) {
      formRef.current.formApi.setValues({
        name: tenant.name,
        status: tenant.status,
      });
    }
  }, [tenant]);

  if (loading && !tenant) {
    return (
      <Card style={{ minHeight: 240 }}>
        <Spin />
      </Card>
    );
  }

  if (!tenant) {
    return (
      <Card>
        <Typography.Text type='danger'>{t('未能加载租户信息')}</Typography.Text>
      </Card>
    );
  }

  const handleSubmit = async (values) => {
    await update({ name: values.name, status: Number(values.status) });
  };

  return (
    <Card
      title={t('租户信息')}
      headerExtraContent={statusTag(t, tenant.status)}
    >
      <Form
        getFormApi={(api) => (formRef.current = { formApi: api })}
        onSubmit={handleSubmit}
        labelPosition='left'
        labelWidth={100}
      >
        <Form.Input field='name' label={t('名称')} rules={[{ required: true, message: t('名称必填') }]} />
        <Form.Input field='slug' label={t('唯一标识')} disabled initValue={tenant.slug} />
        <Form.Select field='status' label={t('状态')}>
          <Form.Select.Option value={1}>{t('启用')}</Form.Select.Option>
          <Form.Select.Option value={2}>{t('停用')}</Form.Select.Option>
        </Form.Select>
        <Form.Section text={`ID: ${tenant.id}`}>
          <Typography.Text type='tertiary'>
            {t('创建于')} {new Date(tenant.created_at * 1000).toLocaleString()}
          </Typography.Text>
        </Form.Section>
        <Button htmlType='submit' theme='solid' type='primary' loading={submitting}>
          {t('保存修改')}
        </Button>
      </Form>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/tenant/info/TenantInfoCard.jsx
git commit -m "feat(tenant-ui): add TenantInfoCard view/edit component

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：租户信息页 — Page 壳

**Files:**
- Create: `web/src/pages/Tenant/index.jsx`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p web/src/pages/Tenant
```

- [ ] **Step 2: 编写页面**

文件内容完整如下：
```jsx
import React from 'react';
import TenantInfoCard from '../../components/tenant/info/TenantInfoCard';

export default function TenantPage() {
  return (
    <div style={{ padding: 16 }}>
      <TenantInfoCard />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Tenant/index.jsx
git commit -m "feat(tenant-ui): add Tenant info page shell

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：成员管理页 — 数据 Hook

**Files:**
- Create: `web/src/components/tenant/members/useTenantMembersData.js`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p web/src/components/tenant/members/modals
```

- [ ] **Step 2: 编写 hook**

文件内容完整如下：
```javascript
import { useState, useCallback, useEffect } from 'react';
import { API, showError, showSuccess } from '../../../helpers';

const DEFAULT_PAGE_SIZE = 20;

/**
 * 成员列表 + invite + updateRole + updateStatus + remove 的复合 hook。
 * 列表接口返回 { success, data: { page_size, total, items: TenantMemberListItem[] } }。
 */
export function useTenantMembersData() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState(0); // 0 = 全部
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (keyword) params.set('keyword', keyword);
      if (statusFilter > 0) params.set('status', String(statusFilter));
      const res = await API.get(`/api/tenant/members?${params.toString()}`);
      if (res?.data?.success) {
        const d = res.data.data || {};
        setItems(d.items || []);
        setTotal(typeof d.total === 'number' ? d.total : 0);
      } else {
        showError(res?.data?.message || '加载成员失败');
      }
    } catch (err) {
      showError(err?.message || '加载成员失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, statusFilter]);

  const invite = useCallback(async ({ email, role }) => {
    try {
      const res = await API.post('/api/tenant/invite', { email, role });
      if (res?.data?.success) {
        const d = res.data.data || {};
        if (d.status === 'joined') {
          showSuccess('已将现有用户加入本租户');
        } else if (d.status === 'invited') {
          showSuccess(`邀请已创建，token: ${d.token}`);
        }
        await load();
        return d;
      }
      showError(res?.data?.message || '邀请失败');
      return null;
    } catch (err) {
      showError(err?.message || '邀请失败');
      return null;
    }
  }, [load]);

  const updateRoleOrStatus = useCallback(
    async ({ user_id, role, status }) => {
      try {
        const body = { user_id };
        if (typeof role === 'number' && role > 0) body.role = role;
        if (typeof status === 'number' && status > 0) body.status = status;
        const res = await API.put('/api/tenant/members', body);
        if (res?.data?.success) {
          showSuccess('已更新');
          await load();
          return true;
        }
        showError(res?.data?.message || '更新失败');
        return false;
      } catch (err) {
        showError(err?.message || '更新失败');
        return false;
      }
    },
    [load],
  );

  const remove = useCallback(
    async (user_id) => {
      try {
        const res = await API.delete('/api/tenant/members', { data: { user_id } });
        if (res?.data?.success) {
          showSuccess('已移除成员');
          await load();
          return true;
        }
        showError(res?.data?.message || '移除失败');
        return false;
      } catch (err) {
        showError(err?.message || '移除失败');
        return false;
      }
    },
    [load],
  );

  useEffect(() => {
    load();
  }, [load]);

  return {
    items,
    total,
    page,
    pageSize,
    keyword,
    statusFilter,
    loading,
    setPage,
    setPageSize,
    setKeyword,
    setStatusFilter,
    reload: load,
    invite,
    updateRoleOrStatus,
    remove,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/tenant/members/useTenantMembersData.js
git commit -m "feat(tenant-ui): add useTenantMembersData hook with list/invite/update/remove

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：成员管理页 — Invite Modal

**Files:**
- Create: `web/src/components/tenant/members/modals/InviteMemberModal.jsx`

- [ ] **Step 1: 编写 Modal**

文件内容完整如下：
```jsx
import React, { useState, useRef } from 'react';
import { Modal, Form, Typography, Banner } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

export default function InviteMemberModal({ visible, onClose, onInvite }) {
  const { t } = useTranslation();
  const formApiRef = useRef();
  const [submitting, setSubmitting] = useState(false);
  const [lastToken, setLastToken] = useState('');

  const handleOk = async () => {
    const api = formApiRef.current;
    if (!api) return;
    const values = await api.validate();
    setSubmitting(true);
    try {
      const result = await onInvite({ email: values.email, role: Number(values.role) });
      if (result && result.status === 'invited' && result.token) {
        setLastToken(result.token);
      } else if (result && result.status === 'joined') {
        setLastToken('');
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setLastToken('');
    onClose();
  };

  return (
    <Modal
      title={t('邀请成员')}
      visible={visible}
      onOk={handleOk}
      onCancel={handleClose}
      confirmLoading={submitting}
      okText={t('发送邀请')}
    >
      <Form getFormApi={(api) => (formApiRef.current = api)} labelPosition='left' labelWidth={100}>
        <Form.Input
          field='email'
          label={t('邮箱')}
          rules={[
            { required: true, message: t('邮箱必填') },
            { type: 'email', message: t('邮箱格式不正确') },
          ]}
        />
        <Form.Select field='role' label={t('角色')} initValue={1}>
          <Form.Select.Option value={1}>{t('普通成员')}</Form.Select.Option>
          <Form.Select.Option value={10}>{t('租户管理员')}</Form.Select.Option>
        </Form.Select>
      </Form>
      {lastToken ? (
        <Banner
          type='info'
          description={
            <Typography.Text copyable={{ content: lastToken }}>
              {t('用户未注册，邀请 token 已生成（48 小时有效）：')} {lastToken}
            </Typography.Text>
          }
          style={{ marginTop: 12 }}
        />
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/tenant/members/modals/InviteMemberModal.jsx
git commit -m "feat(tenant-ui): add InviteMemberModal component

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 8：成员管理页 — EditMemberRole Modal

**Files:**
- Create: `web/src/components/tenant/members/modals/EditMemberRoleModal.jsx`

- [ ] **Step 1: 编写 Modal**

文件内容完整如下：
```jsx
import React, { useRef, useEffect } from 'react';
import { Modal, Form } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

export default function EditMemberRoleModal({ visible, member, onClose, onSubmit }) {
  const { t } = useTranslation();
  const formApiRef = useRef();

  useEffect(() => {
    if (visible && member && formApiRef.current) {
      formApiRef.current.setValues({
        role: member.tenant_role,
        status: member.membership_status,
      });
    }
  }, [visible, member]);

  if (!member) return null;

  const handleOk = async () => {
    const api = formApiRef.current;
    if (!api) return;
    const values = await api.validate();
    const ok = await onSubmit({
      user_id: member.user_id,
      role: Number(values.role),
      status: Number(values.status),
    });
    if (ok) onClose();
  };

  return (
    <Modal title={t('编辑成员')} visible={visible} onOk={handleOk} onCancel={onClose} okText={t('保存')}>
      <Form getFormApi={(api) => (formApiRef.current = api)} labelPosition='left' labelWidth={100}>
        <Form.Input field='user' label={t('用户')} disabled initValue={`${member.display_name || member.username} <${member.email}>`} />
        <Form.Select field='role' label={t('角色')}>
          <Form.Select.Option value={1}>{t('普通成员')}</Form.Select.Option>
          <Form.Select.Option value={10}>{t('租户管理员')}</Form.Select.Option>
        </Form.Select>
        <Form.Select field='status' label={t('状态')}>
          <Form.Select.Option value={1}>{t('启用')}</Form.Select.Option>
          <Form.Select.Option value={2}>{t('禁用')}</Form.Select.Option>
        </Form.Select>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/tenant/members/modals/EditMemberRoleModal.jsx
git commit -m "feat(tenant-ui): add EditMemberRoleModal component

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 9：成员管理页 — Filters 组件

**Files:**
- Create: `web/src/components/tenant/members/TenantMembersFilters.jsx`

- [ ] **Step 1: 编写组件**

文件内容完整如下：
```jsx
import React from 'react';
import { Input, Select, Space } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

export default function TenantMembersFilters({
  keyword,
  onKeywordChange,
  statusFilter,
  onStatusFilterChange,
}) {
  const { t } = useTranslation();
  return (
    <Space>
      <Input
        prefix={null}
        placeholder={t('搜索用户名/邮箱/昵称')}
        value={keyword}
        onChange={onKeywordChange}
        style={{ width: 260 }}
        showClear
      />
      <Select
        value={statusFilter}
        onChange={onStatusFilterChange}
        style={{ width: 140 }}
      >
        <Select.Option value={0}>{t('全部状态')}</Select.Option>
        <Select.Option value={1}>{t('启用')}</Select.Option>
        <Select.Option value={2}>{t('禁用')}</Select.Option>
        <Select.Option value={3}>{t('已移除')}</Select.Option>
      </Select>
    </Space>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/tenant/members/TenantMembersFilters.jsx
git commit -m "feat(tenant-ui): add TenantMembersFilters component

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 10：成员管理页 — Actions 组件

**Files:**
- Create: `web/src/components/tenant/members/TenantMembersActions.jsx`

- [ ] **Step 1: 编写组件**

文件内容完整如下：
```jsx
import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

export default function TenantMembersActions({ onInviteClick, onRefresh }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button theme='solid' type='primary' onClick={onInviteClick}>
        {t('邀请成员')}
      </Button>
      <Button onClick={onRefresh}>{t('刷新')}</Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/tenant/members/TenantMembersActions.jsx
git commit -m "feat(tenant-ui): add TenantMembersActions component

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 11：成员管理页 — Table 组件

**Files:**
- Create: `web/src/components/tenant/members/TenantMembersTable.jsx`

- [ ] **Step 1: 编写组件**

文件内容完整如下：
```jsx
import React from 'react';
import { Table, Tag, Button, Popconfirm, Space } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

const roleTag = (t, role) => {
  if (role === 10) return <Tag color='blue'>{t('租户管理员')}</Tag>;
  if (role === 1) return <Tag>{t('普通成员')}</Tag>;
  return <Tag color='grey'>{t('未知')}</Tag>;
};

const statusTag = (t, status) => {
  if (status === 1) return <Tag color='green'>{t('启用')}</Tag>;
  if (status === 2) return <Tag color='orange'>{t('禁用')}</Tag>;
  if (status === 3) return <Tag color='red'>{t('已移除')}</Tag>;
  return <Tag>{t('未知')}</Tag>;
};

export default function TenantMembersTable({
  items,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
  onEditClick,
  onRemoveClick,
}) {
  const { t } = useTranslation();
  const columns = [
    { title: t('用户'), dataIndex: 'username', render: (v, r) => (
      <div>
        <div>{r.display_name || r.username}</div>
        <div style={{ color: '#999', fontSize: 12 }}>{r.email}</div>
      </div>
    ) },
    { title: t('角色'), dataIndex: 'tenant_role', render: (v) => roleTag(t, v) },
    { title: t('状态'), dataIndex: 'membership_status', render: (v) => statusTag(t, v) },
    { title: t('分组'), dataIndex: 'group' },
    { title: t('已用额度'), dataIndex: 'used_quota', render: (v) => (v ?? 0).toLocaleString() },
    { title: t('请求数'), dataIndex: 'request_count' },
    {
      title: t('操作'),
      render: (_, r) => (
        <Space>
          <Button size='small' onClick={() => onEditClick(r)}>{t('编辑')}</Button>
          <Popconfirm
            title={t('确认移除该成员？')}
            onConfirm={() => onRemoveClick(r)}
          >
            <Button size='small' type='danger'>{t('移除')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  return (
    <Table
      rowKey='id'
      loading={loading}
      dataSource={items}
      columns={columns}
      pagination={{
        currentPage: page,
        pageSize,
        total,
        onChange: onPageChange,
        showTotal: true,
      }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/tenant/members/TenantMembersTable.jsx
git commit -m "feat(tenant-ui): add TenantMembersTable component

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 12：成员管理页 — 容器组件

**Files:**
- Create: `web/src/components/tenant/members/index.jsx`

- [ ] **Step 1: 编写容器**

文件内容完整如下：
```jsx
import React, { useState } from 'react';
import { Card, Space } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { useTenantMembersData } from './useTenantMembersData';
import TenantMembersActions from './TenantMembersActions';
import TenantMembersFilters from './TenantMembersFilters';
import TenantMembersTable from './TenantMembersTable';
import InviteMemberModal from './modals/InviteMemberModal';
import EditMemberRoleModal from './modals/EditMemberRoleModal';

export default function TenantMembers() {
  const { t } = useTranslation();
  const {
    items,
    total,
    page,
    pageSize,
    keyword,
    statusFilter,
    loading,
    setPage,
    setKeyword,
    setStatusFilter,
    reload,
    invite,
    updateRoleOrStatus,
    remove,
  } = useTenantMembersData();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  return (
    <div style={{ padding: 16 }}>
      <Card title={t('租户成员')}>
        <Space vertical align='start' style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <TenantMembersFilters
              keyword={keyword}
              onKeywordChange={setKeyword}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />
            <TenantMembersActions
              onInviteClick={() => setInviteOpen(true)}
              onRefresh={reload}
            />
          </div>
          <TenantMembersTable
            items={items}
            loading={loading}
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onEditClick={(row) => setEditTarget(row)}
            onRemoveClick={(row) => remove(row.user_id)}
          />
        </Space>
      </Card>
      <InviteMemberModal
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={invite}
      />
      <EditMemberRoleModal
        visible={!!editTarget}
        member={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={updateRoleOrStatus}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/tenant/members/index.jsx
git commit -m "feat(tenant-ui): wire TenantMembers container component

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 13：成员管理页 — Page 壳

**Files:**
- Create: `web/src/pages/TenantMembers/index.jsx`

- [ ] **Step 1: 创建目录 + 编写页面**

```bash
mkdir -p web/src/pages/TenantMembers
```

`web/src/pages/TenantMembers/index.jsx` 内容完整如下：
```jsx
import React from 'react';
import TenantMembers from '../../components/tenant/members';

export default function TenantMembersPage() {
  return <TenantMembers />;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/TenantMembers/index.jsx
git commit -m "feat(tenant-ui): add TenantMembers page shell

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 14：注册路由到 App.jsx

**Files:**
- Modify: `web/src/App.jsx`

- [ ] **Step 1: 定位 import 区**

```bash
grep -n "lazy\|import.*pages/" web/src/App.jsx | head -30
```
期望：看到 `lazy(() => import('./pages/Xxx'))` 的模式。

- [ ] **Step 2: 追加 lazy import**

在现有 pages lazy import 块末尾追加两行：
```javascript
const Tenant = lazy(() => import('./pages/Tenant'));
const TenantMembers = lazy(() => import('./pages/TenantMembers'));
```

- [ ] **Step 3: 追加路由**

定位现有 `<Route path='/console/xxx' element={<AdminRoute>...`} 块，参考其结构追加两条：
```jsx
<Route
  path='/console/tenant-info'
  element={
    <AdminRoute>
      <Tenant />
    </AdminRoute>
  }
/>
<Route
  path='/console/tenant-members'
  element={
    <AdminRoute>
      <TenantMembers />
    </AdminRoute>
  }
/>
```

插入位置：与现有 admin 路由块（如 `/console/user` 附近）相邻。

- [ ] **Step 4: 编译验证**

```bash
cd web && bun run build 2>&1 | tail -20
```
期望：无错误。

- [ ] **Step 5: Commit**

```bash
git add web/src/App.jsx
git commit -m "feat(tenant-ui): register /console/tenant-info and /console/tenant-members routes

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 15：侧边栏新增 tenant 分组

**Files:**
- Modify: `web/src/hooks/common/useSidebar.js`

- [ ] **Step 1: 定位 DEFAULT_ADMIN_CONFIG**

```bash
grep -n "DEFAULT_ADMIN_CONFIG\|admin.*\\[\|key:.*'admin'" web/src/hooks/common/useSidebar.js | head -20
```
读取上下文约 60 行，理解现有菜单项结构（可能是 `{ key, label, icon, path }` 对象数组）。

- [ ] **Step 2: 新增 tenant 菜单项**

在 `DEFAULT_ADMIN_CONFIG` 的 admin 分组里，紧邻 `user` / `subscription` 项之后，追加：
```javascript
{
  key: 'tenant-info',
  label: '租户信息',  // i18n 通过 useTranslation 在组件中完成，sidebar label 按现有风格保持中文字面量即可
  icon: 'IconBriefcase',  // 若现有图标命名不同则换成任意合适图标
  path: '/console/tenant-info',
},
{
  key: 'tenant-members',
  label: '租户成员',
  icon: 'IconUserGroup',
  path: '/console/tenant-members',
},
```

**关键点**：以现有项的 key/label/icon/path 字段为准，不要引入新字段。

- [ ] **Step 3: 编译验证**

```bash
cd web && bun run build 2>&1 | tail -20
```
期望：无错误。

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/common/useSidebar.js
git commit -m "feat(tenant-ui): add tenant-info/tenant-members to admin sidebar

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 16：整体构建 + lint 验证

**Files:**（本任务不修改文件）

- [ ] **Step 1: 全量构建**

```bash
cd web && bun run build 2>&1 | tail -30
```
期望：`dist/` 生成，无 error；可以有 warning。

- [ ] **Step 2: Lint**

```bash
cd web && bun run lint 2>&1 | tail -30
```
期望：新增文件无 lint error。若有现有文件的预存 warning 允许保留，但**新增文件不能引入新 error**。

- [ ] **Step 3: 检查静态导入关系**

```bash
grep -rn "@douyinfe/semi-ui\|from '.*tenant" web/src/components/tenant web/src/pages/Tenant web/src/pages/TenantMembers 2>&1 | head -40
```
期望：每个 import 的相对路径都能解析到实际文件。

---

## Task 17：Smoke test checklist（手动）

**Files:**（本任务不修改代码，列出人工验证清单）

- [ ] **Step 1: 后端运行**

```bash
# 在项目根目录
go run main.go
```
期望：默认监听 :3000，日志显示 `Server running on :3000`。

- [ ] **Step 2: 前端运行**

```bash
cd web && bun run dev
```
期望：Vite dev server 启动，浏览器自动打开 `http://localhost:5173` 或提示访问。

- [ ] **Step 3: 登录平台管理员**

- 登录 root/admin 账号（role ≥ 10）
- 打开浏览器 DevTools → Network → 任意 API 请求
- **验证**：Request Headers 应含 `X-Tenant-Id: 1`（或当前租户 id）

- [ ] **Step 4: 租户信息页**

- 左侧侧边栏点击"租户信息"
- **验证**：
  - 页面显示 Name / Slug / Status / ID / CreatedAt
  - 修改 Name 后点"保存修改"，Toast 显示"租户信息已更新"，重新加载后值持久
  - Slug 字段 disabled（不可编辑）

- [ ] **Step 5: 成员管理页**

- 左侧点击"租户成员"
- **验证**：
  - 列表显示当前用户自己（至少 1 行）
  - 搜索框输入邮箱片段，列表能筛选
  - 状态下拉切换到"启用"/"禁用"/"已移除"各自刷新列表
  - 分页器显示 total 正确

- [ ] **Step 6: 邀请成员**

- 点击"邀请成员"
- 情形 A：输入已存在的用户邮箱
  - 提交后 Toast："已将现有用户加入本租户"
  - 列表出现该用户
- 情形 B：输入未注册邮箱
  - 提交后 Banner 显示邀请 token（可复制）
  - 列表不变（因为用户还没 accept）

- [ ] **Step 7: 编辑成员角色/状态**

- 在成员行点"编辑"
- 切换角色为"租户管理员"，点"保存"
- **验证**：Toast 显示"已更新"，列表角色列变化
- 编辑自己会触发错误（后端拒绝，Toast 显示"不能修改自己的租户成员身份"）

- [ ] **Step 8: 移除成员**

- 在**非自己**的成员行点"移除"，Popconfirm 后确认
- **验证**：Toast 显示"已移除成员"，该行 status 变为"已移除"或从列表消失

- [ ] **Step 9: 记录发现的问题**

如测试中遇到问题，记录到 `docs/superpowers/plans/2026-04-17-phase6-console-part-a.md` 文末"已知问题"段落（待 Part A follow-up 修复）。

---

## Task 18：更新状态文档

**Files:**
- Modify: `docs/superpowers/plans/2026-04-16-completion-status.md`

- [ ] **Step 1: 更新 Phase 6 状态**

把 Phase 6 行从：
```
| Phase 6 | 前端 SaaS 后台 | 未开始 | 0% |
```
改为：
```
| Phase 6 | 前端 SaaS 后台 | **Part A 已完成（租户信息 + 成员管理）** | 15% |
```

然后在 "## Phase 6：前端 SaaS 后台 — 未开始" 段落把标题改为：
```
## Phase 6：前端 SaaS 后台 ⚠️ 15%
```

正文调整为：
```
- ✅ Part A（2026-04-17）：TS 类型、X-Tenant-Id header 注入、租户信息页（/console/tenant-info）、成员管理页（/console/tenant-members）
- Session 中有 tenant_id，前端已通过 header 透传；仍缺用户跨租户切换 UI（Part D）
- 缺：租户计划页、租户配置页、品牌配置、自定义域名（Part B）
- 缺：监控/告警前端（Part C）
- 现有 `/console/topup`、`/console/site-rpm`、`InvoiceAdmin`、`RebateSettings` 仍是通用后台页面，尚未 Console 化
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-04-16-completion-status.md
git commit -m "docs(tenant-ui): mark Phase 6 Part A (tenant info + members) complete

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## 风险与注意事项

1. **依赖 user payload 里已有 tenant_id**：前端读 `localStorage.getItem('user').tenant_id`。若后端登录响应没有该字段，Task 2 的拦截器会不发 `X-Tenant-Id`，后端 TenantResolve 会 fallback 到 session。**在 Task 17 Smoke test Step 3 必须用 DevTools 核实 header 真的发出**。若没有，回头在登录 API 包装处手动把 tenant_id 写入 user object。

2. **AdminRoute 也允许 tenant-only admin 访问是伪命题**：当前 `AdminRoute` 只认 `role >= 10` 的平台角色。tenant-only admin（`platform role < 10` 但 `tenant_role >= 10`）暂时进不来菜单。Part D 会补 `TenantAdminRoute`。Part A 先只给 platform admin 使用。

3. **TS 在 .jsx 中的使用**：新增的 `tenant.ts` 是 TypeScript，现有项目以 .jsx 为主。Vite 已内置 TS 支持，import 路径可省略 `.ts` 后缀。若构建报 Cannot find module，在 `vite.config.js` 的 `resolve.extensions` 确认含 `.ts`（项目默认应已有）。

4. **Semi Design 组件命名差异**：如 `Popconfirm` 在某些 Semi 版本叫 `Popover` + 手写确认；本 plan 按 `Popconfirm` 写。若项目 Semi 版本无此组件，降级为 `Modal.confirm`。

5. **i18n 不完整**：本 plan 的 `t('中文')` 直接把中文当 key，依赖项目现有的 fallback 回中文 key 行为。不立刻补其他语言 JSON。后续 Part 中批量补 key 映射。

6. **邀请邮件不投递**：Task 7 的 Invite modal 若用户未注册会显示 token，运维需手动复制发送给用户。邮件投递是阶段 A 独立 plan，不在本 Part 范围。

7. **列表分页 keyword/status 变化时重置 page**：当前 `setKeyword`/`setStatusFilter` 不会把 page 归零。若 page=3 且结果只有 1 页会显示空列表。接受此小瑕疵（用户再点一次"刷新"或翻页即可），Part A follow-up 可修。

8. **跨租户数据泄漏风险**：本 plan 所有接口都是 tenant-scoped 后端自己做了隔离。前端只负责带 header。**不要**在前端组装 cross-tenant 的列表（当前也没这么做）。

---

## 完成后的状态快照

- Phase 6 完成度 0% → 15%
- 前端首次具备租户感知（header + user session）
- 2 个租户 admin 页面可用：租户信息（view/edit name/status）、成员管理（list/invite/update/remove）
- Part A 未覆盖：计划页、配置页、监控前端、租户切换器、邀请邮件投递（分别由 Part B/C/D + 阶段 A 独立 plan 跟进）
