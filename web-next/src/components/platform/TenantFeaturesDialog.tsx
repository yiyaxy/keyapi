import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  useTenantFeatures,
  useUpdateTenantFeatures,
  type TenantFeatures,
} from '@/hooks/usePlatformTenants';

// TenantFeaturesDialog lets a platform admin flip per-tenant feature toggles.
// Currently exposes a single switch — chat_history view — but the layout
// supports stacking more switches as new opt-in features land. Each switch
// is a controlled local-state copy; save commits the diff in one PUT.
export function TenantFeaturesDialog({
  open,
  tenantId,
  tenantName,
  onOpenChange,
}: {
  open: boolean;
  tenantId: number;
  tenantName: string;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('platform');
  const features = useTenantFeatures(open ? tenantId : null);
  const update = useUpdateTenantFeatures(tenantId);

  const [draft, setDraft] = useState<TenantFeatures>({ chat_history: false });

  useEffect(() => {
    if (features.data) setDraft(features.data);
  }, [features.data]);

  const dirty = features.data != null && draft.chat_history !== features.data.chat_history;

  const onSave = () => {
    if (!features.data) return;
    const patch: Partial<TenantFeatures> = {};
    if (draft.chat_history !== features.data.chat_history) {
      patch.chat_history = draft.chat_history;
    }
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    update.mutate(patch, {
      onSuccess: () => {
        toast.success(t('features.toast.saved', { defaultValue: '已保存' }));
        onOpenChange(false);
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {t('features.title', {
              name: tenantName,
              defaultValue: '功能开关 · {{name}}',
            })}
          </DialogTitle>
        </DialogHeader>
        <p className='text-12 text-fg-2'>
          {t('features.hint', {
            defaultValue: '为该租户开通需要平台管理员授权的功能。关闭后租户管理员立即失去访问。',
          })}
        </p>

        <div className='space-y-4 py-2'>
          {features.isPending ? (
            <Skeleton className='h-12 w-full' />
          ) : (
            <label className='flex items-start justify-between gap-4 rounded-md border border-line p-3'>
              <div className='flex-1'>
                <div className='text-13 font-medium text-fg-0'>
                  {t('features.chat_history.label', {
                    defaultValue: '对话记录查看',
                  })}
                </div>
                <div className='mt-1 text-12 text-fg-2'>
                  {t('features.chat_history.desc', {
                    defaultValue:
                      '允许该租户管理员访问 /admin/chat-history 页面。仅当全局录制开启时才会有数据。',
                  })}
                </div>
              </div>
              <Switch
                checked={draft.chat_history}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, chat_history: v }))}
                disabled={features.isPending || update.isPending}
              />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            {t('features.cancel', { defaultValue: '取消' })}
          </Button>
          <Button type='button' onClick={onSave} disabled={!dirty || update.isPending}>
            {t('features.save', { defaultValue: '保存' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
