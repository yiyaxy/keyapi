import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type BatchCreatedTenant,
  type CreateTenantPayload,
  useBatchCreateTenants,
  useCreateTenant,
} from '@/hooks/usePlatformTenants';
import { ApiError } from '@/lib/api';

const schema = z.object({
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'invalid-slug'),
  admin_username: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_\-.]+$/, 'invalid-username'),
  admin_password: z.string().min(8).max(20),
  admin_email: z.string().email().optional().or(z.literal('')),
  admin_display_name: z.string().max(20).optional().or(z.literal('')),
});
type Values = z.infer<typeof schema>;

type CreateMode = 'single' | 'batch' | 'import';

const CSV_HEADERS = ['名称', 'slug', '管理员用户名', '初始密码', '邮箱', '显示名'];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseImportRow(parts: string[], index: number): CreateTenantPayload {
  const [name, slug, admin_username, admin_password, admin_email, admin_display_name] = parts;
  const parsed = schema.parse({
    name,
    slug,
    admin_username,
    admin_password,
    admin_email: admin_email ?? '',
    admin_display_name: admin_display_name ?? '',
  });
  if (parts.length < 4) {
    throw new Error(`第 ${index + 1} 行至少需要 4 列`);
  }
  return {
    name: parsed.name,
    slug: parsed.slug,
    admin_username: parsed.admin_username,
    admin_password: parsed.admin_password,
    admin_email: parsed.admin_email || undefined,
    admin_display_name: parsed.admin_display_name || undefined,
  };
}

function parseImportText(text: string): CreateTenantPayload[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, '')).filter((row) => !row[0]?.startsWith('#'));
  const dataRows =
    rows.length > 0 &&
    rows[0].some((cell) => CSV_HEADERS.includes(cell)) &&
    rows[0].some((cell) => cell === 'slug')
      ? rows.slice(1)
      : rows;
  return dataRows.map((row, index) => parseImportRow(row, index));
}

function downloadTenantTemplate() {
  const rows = [
    CSV_HEADERS,
    ['示例租户', 'tenant-a', 'tenant_a_admin', 'ChangeMe123', 'admin@example.com', '租户管理员'],
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tenant-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function CreateTenantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('platform');
  const create = useCreateTenant();
  const batchCreate = useBatchCreateTenants();
  const [mode, setMode] = useState<CreateMode>('single');
  const [batchCount, setBatchCount] = useState('10');
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchCreatedTenant[]>([]);
  const [importRows, setImportRows] = useState<CreateTenantPayload[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      slug: '',
      admin_username: '',
      admin_password: '',
      admin_email: '',
      admin_display_name: '',
    },
  });

  async function onSubmit(values: Values) {
    try {
      await create.mutateAsync({
        name: values.name,
        slug: values.slug,
        admin_username: values.admin_username,
        admin_password: values.admin_password,
        admin_email: values.admin_email || undefined,
        admin_display_name: values.admin_display_name || undefined,
      });
      toast.success(t('create.success'));
      form.reset();
      onOpenChange(false);
    } catch {
      /* banner */
    }
  }

  function parseBatchCount(): number | null {
    const count = Number(batchCount);
    if (!Number.isInteger(count) || count < 1 || count > 100) return null;
    return count;
  }

  function requestBatchConfirm() {
    setBatchError(null);
    setBatchResult([]);
    if (parseBatchCount() == null) {
      setBatchError('批量生成数量必须在 1-100 之间。');
      return;
    }
    setBatchConfirmOpen(true);
  }

  async function onBatchSubmit() {
    const count = parseBatchCount();
    if (count == null) {
      setBatchError('批量生成数量必须在 1-100 之间。');
      return;
    }
    setBatchConfirmOpen(false);
    setBatchError(null);
    try {
      const result = await batchCreate.mutateAsync({ count });
      setBatchResult(result.items ?? []);
      toast.success(`已批量创建 ${result.total ?? result.items.length} 个租户`);
    } catch (error) {
      const message =
        error instanceof ApiError ? (error.backendMessage ?? error.message) : String(error);
      setBatchError(message);
    }
  }

  async function onImportFile(file: File | undefined) {
    setImportError(null);
    setImportRows([]);
    setImportFileName(file?.name ?? '');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setImportError('请上传模板另存后的 CSV 文件。');
      return;
    }
    try {
      const text = await file.text();
      const rows = parseImportText(text);
      if (rows.length === 0) {
        setImportError('文件里没有可导入的租户数据。');
        return;
      }
      setImportRows(rows);
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? '文件内容格式有误，请检查名称、slug、用户名、密码和邮箱格式。'
          : error instanceof Error
            ? error.message
            : '文件内容格式有误。';
      setImportError(message);
    }
  }

  async function onImportSubmit() {
    setImportError(null);
    if (importRows.length === 0) {
      setImportError('请先上传填写好的模板。');
      return;
    }

    let created = 0;
    try {
      for (const payload of importRows) {
        await create.mutateAsync(payload);
        created += 1;
      }
      toast.success(`已创建 ${created} 个租户`);
      setImportRows([]);
      setImportFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      form.reset();
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof ApiError ? (error.backendMessage ?? error.message) : String(error);
      setImportError(`已创建 ${created} 个，后续创建失败：${message}`);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('create.title')}</DialogTitle>
          </DialogHeader>
          {create.error instanceof ApiError && (
            <InlineBanner
              level='danger'
              message={create.error.backendMessage ?? create.error.message}
            />
          )}
          {importError && <InlineBanner level='danger' message={importError} />}
          {batchError && <InlineBanner level='danger' message={batchError} />}
          <div className='grid grid-cols-3 gap-2 rounded-md bg-bg-1 p-1'>
            <Button
              type='button'
              variant={mode === 'single' ? 'secondary' : 'ghost'}
              onClick={() => setMode('single')}
            >
              单个创建
            </Button>
            <Button
              type='button'
              variant={mode === 'batch' ? 'secondary' : 'ghost'}
              onClick={() => setMode('batch')}
            >
              批量生成
            </Button>
            <Button
              type='button'
              variant={mode === 'import' ? 'secondary' : 'ghost'}
              onClick={() => setMode('import')}
            >
              Excel 导入
            </Button>
          </div>
          {mode === 'single' ? (
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='ct-name'>{t('create.name')}</Label>
                <Input id='ct-name' autoFocus {...form.register('name')} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ct-slug'>{t('create.slug')}</Label>
                <Input id='ct-slug' {...form.register('slug')} />
                <div className='text-12 text-fg-2'>{t('create.slug.hint')}</div>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ct-admin-username'>初始管理员用户名</Label>
                <Input id='ct-admin-username' {...form.register('admin_username')} />
                <div className='text-12 text-fg-2'>
                  字母/数字/下划线/连字符/点，1-20 位。该账号自动成为此租户的 admin。
                </div>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ct-admin-password'>初始管理员密码</Label>
                <Input
                  id='ct-admin-password'
                  type='password'
                  autoComplete='new-password'
                  {...form.register('admin_password')}
                />
                <div className='text-12 text-fg-2'>
                  8-20 位，创建后请及时通知该租户使用人并修改。
                </div>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ct-admin-email'>管理员邮箱（可选）</Label>
                <Input id='ct-admin-email' type='email' {...form.register('admin_email')} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ct-admin-display'>管理员显示名（可选）</Label>
                <Input id='ct-admin-display' {...form.register('admin_display_name')} />
              </div>
              <DialogFooter>
                <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
                  {t('create.cancel')}
                </Button>
                <Button type='submit' disabled={create.isPending}>
                  {t('create.submit')}
                </Button>
              </DialogFooter>
            </form>
          ) : mode === 'batch' ? (
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='ct-batch-count'>批量生成数量</Label>
                <Input
                  id='ct-batch-count'
                  type='number'
                  min={1}
                  max={100}
                  value={batchCount}
                  onChange={(event) => setBatchCount(event.target.value)}
                />
                <div className='text-12 text-fg-2'>
                  只需要填写数量，系统会自动生成租户名称、slug、管理员账号和初始密码。单次最多 100
                  个。
                </div>
              </div>
              {batchResult.length > 0 && (
                <div className='rounded-md border border-line'>
                  <div className='border-b border-line px-3 py-2 text-13 text-fg-1'>
                    已生成 {batchResult.length} 个账号，请保存初始密码。
                  </div>
                  <div className='max-h-56 overflow-auto'>
                    <table className='w-full text-left text-12'>
                      <thead className='bg-bg-1 text-fg-2'>
                        <tr>
                          <th className='px-3 py-2 font-medium'>租户</th>
                          <th className='px-3 py-2 font-medium'>slug</th>
                          <th className='px-3 py-2 font-medium'>账号</th>
                          <th className='px-3 py-2 font-medium'>初始密码</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchResult.map((row) => (
                          <tr key={row.tenant.slug} className='border-t border-line'>
                            <td className='px-3 py-2'>{row.tenant.name}</td>
                            <td className='px-3 py-2 font-mono'>{row.tenant.slug}</td>
                            <td className='px-3 py-2 font-mono'>{row.admin_username}</td>
                            <td className='px-3 py-2 font-mono'>{row.admin_password}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
                  {t('create.cancel')}
                </Button>
                <Button
                  type='button'
                  disabled={batchCreate.isPending}
                  onClick={requestBatchConfirm}
                >
                  批量生成
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className='space-y-4'>
              <div className='space-y-3 rounded-md border border-line bg-bg-1 p-3'>
                <div>
                  <div className='text-14 font-medium text-fg-0'>下载模板后用 Excel 填写</div>
                  <div className='mt-1 text-12 text-fg-2'>
                    模板字段：名称、slug、管理员用户名、初始密码、邮箱、显示名。前 4 列必填。
                  </div>
                </div>
                <Button type='button' variant='secondary' onClick={downloadTenantTemplate}>
                  下载 Excel 模板
                </Button>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ct-import'>上传填写后的 CSV</Label>
                <Input
                  ref={fileInputRef}
                  id='ct-import'
                  type='file'
                  accept='.csv,text/csv'
                  onChange={(event) => void onImportFile(event.target.files?.[0])}
                />
                <div className='text-12 text-fg-2'>
                  Excel 打开模板填写后，请另存为 CSV 再上传。当前文件：
                  {importFileName || '未选择'}。
                </div>
              </div>
              {importRows.length > 0 && (
                <div className='rounded-md border border-line'>
                  <div className='border-b border-line px-3 py-2 text-13 text-fg-1'>
                    将创建 {importRows.length} 个租户
                  </div>
                  <div className='max-h-40 overflow-auto'>
                    <table className='w-full text-left text-12'>
                      <thead className='bg-bg-1 text-fg-2'>
                        <tr>
                          <th className='px-3 py-2 font-medium'>名称</th>
                          <th className='px-3 py-2 font-medium'>slug</th>
                          <th className='px-3 py-2 font-medium'>管理员</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.slice(0, 5).map((row) => (
                          <tr key={row.slug} className='border-t border-line'>
                            <td className='px-3 py-2'>{row.name}</td>
                            <td className='px-3 py-2 font-mono'>{row.slug}</td>
                            <td className='px-3 py-2'>{row.admin_username}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importRows.length > 5 && (
                    <div className='border-t border-line px-3 py-2 text-12 text-fg-2'>
                      仅预览前 5 行。
                    </div>
                  )}
                </div>
              )}
              <DialogFooter>
                <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
                  {t('create.cancel')}
                </Button>
                <Button
                  type='button'
                  disabled={create.isPending || importRows.length === 0}
                  onClick={() => void onImportSubmit()}
                >
                  导入创建
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={batchConfirmOpen}
        title='确认批量生成'
        body={`即将自动生成 ${parseBatchCount() ?? 0} 个租户及对应管理员账号。确认后会立即创建，初始密码只会在本次结果中展示。`}
        confirmLabel='确认生成'
        danger={false}
        isPending={batchCreate.isPending}
        onOpenChange={setBatchConfirmOpen}
        onConfirm={() => void onBatchSubmit()}
      />
    </>
  );
}
