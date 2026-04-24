import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import {
  FormulaPills,
  formatRatio,
  parseChannelModels,
  readChannelRatio,
  resolveEffectiveMarkup,
} from '@/components/channels/FormulaPills';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDeleteTenantPlatformChannelMarkup,
  useUpsertTenantPlatformChannelMarkup,
  type TenantPlatformChannelMarkup,
} from '@/hooks/useTenantBilling';
import type { Channel } from '@/hooks/useChannels';
import type { PricingRow } from '@/hooks/usePricing';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDisplayUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

type TenantMarkupEditDialogProps = {
  open: boolean;
  channel: Channel | null;
  override?: TenantPlatformChannelMarkup;
  planMarkup: number;
  pricingRows: PricingRow[];
  groupRatios: Record<string, number>;
  pricingPending?: boolean;
  pricingError?: boolean;
  onOpenChange: (open: boolean) => void;
};

type TenantMarkupEditDialogBodyProps = Omit<TenantMarkupEditDialogProps, 'open'> & {
  channel: Channel;
};

function parseMarkupInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sameRatio(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0001;
}

function previewUsd(
  row: PricingRow,
  groupRatio: number,
  markup: number,
  channelRatio: number
): number {
  const multiplier = groupRatio * markup * channelRatio;
  if (row.quota_type === 1) {
    return row.model_price * multiplier;
  }
  return row.model_ratio * 2 * multiplier;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function TenantMarkupEditDialogBody({
  channel,
  override,
  planMarkup,
  pricingRows,
  groupRatios,
  pricingPending = false,
  pricingError = false,
  onOpenChange,
}: TenantMarkupEditDialogBodyProps) {
  const { t } = useTranslation('channels');
  const cfg = usePublicConfig();
  const upsert = useUpsertTenantPlatformChannelMarkup();
  const remove = useDeleteTenantPlatformChannelMarkup();
  const effective = useMemo(
    () => resolveEffectiveMarkup(channel, override, planMarkup),
    [channel, override, planMarkup]
  );
  const initialValue =
    override && override.enabled && override.markup_ratio > 0
      ? override.markup_ratio
      : effective.value;
  const [inputValue, setInputValue] = useState(String(initialValue));
  const [expandedGroups, setExpandedGroups] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsedMarkup = parseMarkupInput(inputValue);
  const invalidInput = inputValue.trim().length > 0 && parsedMarkup === null;
  const previewMarkup = parsedMarkup ?? effective.value;
  const channelRatio = readChannelRatio(channel);
  const matchedPricing = useMemo(() => {
    const byName = new Map(pricingRows.map((row) => [row.model_name, row] as const));
    return parseChannelModels(channel.models)
      .map((model) => byName.get(model))
      .filter((row): row is PricingRow => Boolean(row));
  }, [channel.models, pricingRows]);
  const mergedGroups = useMemo(() => {
    const groups = { default: 1, ...groupRatios };
    return Object.entries(groups).sort(([left], [right]) => {
      if (left === 'default') return -1;
      if (right === 'default') return 1;
      return left.localeCompare(right);
    });
  }, [groupRatios]);
  const optionalGroups = mergedGroups.filter(([group]) => group !== 'default');
  const visibleGroups = useMemo(() => {
    const next = ['default', ...selectedGroups];
    return next.filter((group, index) => next.indexOf(group) === index);
  }, [selectedGroups]);

  async function handleUpsert() {
    if (parsedMarkup == null) return;
    try {
      await upsert.mutateAsync({
        channel_id: channel.id,
        markup_ratio: parsedMarkup,
        enabled: true,
      });
      toast.success(t('tenant_markup_dialog.save_success'));
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function handleDelete() {
    if (!override) {
      onOpenChange(false);
      return;
    }
    try {
      await remove.mutateAsync(channel.id);
      toast.success(t('tenant_markup_dialog.clear_success'));
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function toggleGroup(group: string, checked: boolean) {
    setSelectedGroups((current) => {
      if (checked) {
        return [...current, group].filter((item, index, list) => list.indexOf(item) === index);
      }
      return current.filter((item) => item !== group);
    });
  }

  function onSave() {
    if (parsedMarkup == null) return;
    if (planMarkup > 0 && sameRatio(parsedMarkup, planMarkup)) {
      setConfirmOpen(true);
      return;
    }
    void handleUpsert();
  }

  const saving = upsert.isPending || remove.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('tenant_markup_dialog.title', { channelName: channel.name })}</DialogTitle>
        <DialogDescription>{t('tenant_markup_dialog.input_help')}</DialogDescription>
      </DialogHeader>

      <div className='space-y-4'>
        <section className='space-y-3 rounded-md border border-line bg-bg-1 p-4'>
          {(
            [
              {
                key: 'tenant_channel',
                label: t('tenant_markup_dialog.priority_chain.tenant_channel'),
                value:
                  override && override.enabled && override.markup_ratio > 0
                    ? formatRatio(override.markup_ratio)
                    : t('tenant_markup_dialog.priority_chain.not_set'),
              },
              {
                key: 'channel',
                label: t('tenant_markup_dialog.priority_chain.channel'),
                value:
                  channel.markup_ratio && channel.markup_ratio > 0
                    ? formatRatio(channel.markup_ratio)
                    : t('tenant_markup_dialog.priority_chain.not_set'),
              },
              {
                key: 'plan',
                label: t('tenant_markup_dialog.priority_chain.plan'),
                value:
                  planMarkup > 0
                    ? formatRatio(planMarkup)
                    : t('tenant_markup_dialog.priority_chain.not_set'),
              },
            ] as const
          ).map((item) => (
            <div key={item.key} className='flex items-center justify-between gap-3 text-13'>
              <div className='flex items-center gap-2'>
                <span
                  className={cn(
                    'size-2 rounded-full',
                    effective.source === item.key ? 'bg-emerald-500' : 'bg-bg-3'
                  )}
                />
                <span className='text-fg-1'>{item.label}</span>
              </div>
              <div className='flex items-center gap-3'>
                <span className='tabular-nums text-fg-0'>{item.value}</span>
                {item.key === 'tenant_channel' ? (
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    disabled={!override || saving}
                    onClick={() => void handleDelete()}
                  >
                    {t('tenant_markup_dialog.clear_override')}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}

          <div className='mt-2 border-t border-line pt-3 text-13'>
            <div className='text-12 text-fg-2'>
              {t('tenant_markup_dialog.channel_ratio_extra.title')}
            </div>
            <div className='mt-1 flex items-center justify-between gap-3'>
              <div className='flex items-center gap-2'>
                <span className='size-2 rounded-full bg-bg-3' />
                <span className='text-fg-1'>
                  {t('tenant_markup_dialog.channel_ratio_extra.label')}
                </span>
              </div>
              <span className='tabular-nums text-fg-0'>{formatRatio(channelRatio)}</span>
            </div>
            <p className='mt-1 text-12 text-fg-2'>
              {t('tenant_markup_dialog.channel_ratio_extra.help')}
            </p>
          </div>
        </section>

        <section className='space-y-2'>
          <Label htmlFor='tenant-markup-input'>{t('tenant_markup_dialog.input_label')}</Label>
          <Input
            id='tenant-markup-input'
            type='number'
            min={0}
            step='0.01'
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            className={cn(
              invalidInput ? 'border-destructive focus-visible:ring-destructive' : undefined
            )}
          />
          <p className='text-12 text-fg-2'>{t('tenant_markup_dialog.input_help')}</p>
          {invalidInput ? (
            <p className='text-12 text-destructive'>
              {t('tenant_markup_dialog.validation.invalid')}
            </p>
          ) : null}
        </section>

        <section className='space-y-2'>
          <div className='text-13 font-medium text-fg-0'>
            {t('tenant_markup_dialog.formula_title')}
          </div>
          <FormulaPills
            channel={channel}
            markup={previewMarkup}
            source='tenant_channel'
            pricingRows={pricingRows}
            groupRatios={groupRatios}
            groupRatioError={pricingError}
            forceShowChannelRatio
          />
        </section>

        <section className='space-y-3 rounded-md border border-line bg-bg-1 p-4'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
              <div className='font-medium text-fg-0'>{t('tenant_markup_dialog.preview.title')}</div>
              <div className='text-12 text-fg-2'>
                {t('tenant_markup_dialog.preview.per_million_tokens')}
              </div>
            </div>
            {optionalGroups.length > 0 && (
              <div className='flex items-center gap-2'>
                <Checkbox
                  id='tenant-markup-expand-groups'
                  checked={expandedGroups}
                  onCheckedChange={(checked) => {
                    const next = checked === true;
                    setExpandedGroups(next);
                    if (!next) setSelectedGroups([]);
                  }}
                />
                <Label htmlFor='tenant-markup-expand-groups'>
                  {t('tenant_markup_dialog.preview.expand_groups')}
                </Label>
                {expandedGroups && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type='button' size='sm' variant='secondary'>
                        {t('tenant_markup_dialog.preview.select_groups')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='w-56 space-y-2'>
                      {optionalGroups.map(([group, ratio]) => {
                        const checked = selectedGroups.includes(group);
                        return (
                          <label
                            key={group}
                            className='flex items-center justify-between gap-2 text-13'
                          >
                            <span className='flex items-center gap-2'>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(next) => toggleGroup(group, next === true)}
                              />
                              <span>{group}</span>
                            </span>
                            <span className='tabular-nums text-fg-2'>{formatRatio(ratio)}</span>
                          </label>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
          </div>

          {pricingPending ? (
            <div className='space-y-2'>
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
            </div>
          ) : pricingError ? (
            <InlineBanner level='warn' message={t('tenant_markup_dialog.preview.loading_failed')} />
          ) : matchedPricing.length === 0 ? (
            <div className='rounded-md border border-dashed border-line bg-bg-0 p-4 text-13 text-fg-2'>
              {t('tenant_markup_dialog.preview.empty')}
            </div>
          ) : (
            <div className='overflow-x-auto rounded-md border border-line'>
              <table className='w-full border-collapse text-13 tabular-nums'>
                <thead>
                  <tr className='border-b border-line bg-bg-0 text-left text-12 uppercase text-fg-2'>
                    <th className='px-3 py-2 font-medium'>
                      {t('tenant_markup_dialog.preview.model')}
                    </th>
                    {visibleGroups.map((group) => (
                      <th key={group} className='px-3 py-2 text-right font-medium'>
                        {group} {formatRatio(groupRatios[group] ?? (group === 'default' ? 1 : 1))}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matchedPricing.map((row) => (
                    <tr key={row.model_name} className='border-b border-line last:border-b-0'>
                      <td className='px-3 py-3'>
                        <div className='font-mono text-fg-0'>{row.model_name}</div>
                        <div className='text-11 text-fg-2'>
                          {row.quota_type === 1
                            ? t('tenant_markup_dialog.preview.per_call')
                            : t('tenant_markup_dialog.preview.per_million_tokens_short')}
                        </div>
                      </td>
                      {visibleGroups.map((group) => (
                        <td key={group} className='px-3 py-3 text-right'>
                          {fmtDisplayUsd(
                            previewUsd(
                              row,
                              groupRatios[group] ?? (group === 'default' ? 1 : 1),
                              previewMarkup,
                              channelRatio
                            ),
                            cfg
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <DialogFooter>
        <Button
          type='button'
          variant='secondary'
          onClick={() => void handleDelete()}
          disabled={saving || !override}
        >
          {t('tenant_markup_dialog.clear_override')}
        </Button>
        <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
          {t('tenant_markup_dialog.cancel')}
        </Button>
        <Button type='button' onClick={onSave} disabled={saving || parsedMarkup == null}>
          {t('tenant_markup_dialog.save')}
        </Button>
      </DialogFooter>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className='max-w-[520px]'>
          <DialogHeader>
            <DialogTitle>{t('tenant_markup_dialog.confirm_title')}</DialogTitle>
            <DialogDescription>
              {t('tenant_markup_dialog.confirm_equal_to_plan', {
                plan: formatRatio(planMarkup),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type='button' variant='secondary' onClick={() => setConfirmOpen(false)}>
              {t('tenant_markup_dialog.cancel')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              onClick={() => {
                setConfirmOpen(false);
                void handleDelete();
              }}
            >
              {t('tenant_markup_dialog.clear_instead')}
            </Button>
            <Button
              type='button'
              onClick={() => {
                setConfirmOpen(false);
                void handleUpsert();
              }}
            >
              {t('tenant_markup_dialog.keep_override')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TenantMarkupEditDialog({
  open,
  channel,
  override,
  planMarkup,
  pricingRows,
  groupRatios,
  pricingPending = false,
  pricingError = false,
  onOpenChange,
}: TenantMarkupEditDialogProps) {
  const dialogKey = channel
    ? `${channel.id}:${override?.updated_at ?? 0}:${planMarkup}:${open ? 'open' : 'closed'}`
    : 'empty';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-[900px] overflow-y-auto'>
        {channel ? (
          <TenantMarkupEditDialogBody
            key={dialogKey}
            channel={channel}
            override={override}
            planMarkup={planMarkup}
            pricingRows={pricingRows}
            groupRatios={groupRatios}
            pricingPending={pricingPending}
            pricingError={pricingError}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
