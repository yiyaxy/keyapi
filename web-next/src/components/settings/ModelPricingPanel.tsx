import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateOption } from '@/hooks/useOptions';
import { usePublicConfig, type PublicConfig } from '@/hooks/usePublicConfig';

import { MODEL_PRICING_KEYS } from './modelPricingKeys';

// Fields that are {modelName: number} maps. Order = display order in the right panel.
const MODEL_FIELDS = [
  { key: 'ModelPrice', label: { zh: '固定价格（每次 $）', en: 'Fixed price ($/call)' } },
  { key: 'ModelRatio', label: { zh: '模型倍率', en: 'Ratio' } },
  { key: 'CompletionRatio', label: { zh: '补全倍率', en: 'Completion ratio' } },
  { key: 'CacheRatio', label: { zh: '缓存读取倍率', en: 'Cache ratio' } },
  { key: 'CreateCacheRatio', label: { zh: '创建缓存倍率', en: 'Create-cache ratio' } },
  { key: 'ImageRatio', label: { zh: '图片倍率', en: 'Image ratio' } },
  { key: 'AudioRatio', label: { zh: '音频倍率', en: 'Audio ratio' } },
  {
    key: 'AudioCompletionRatio',
    label: { zh: '音频补全倍率', en: 'Audio completion ratio' },
  },
] as const satisfies ReadonlyArray<{
  key: (typeof MODEL_PRICING_KEYS)[number];
  label: { zh: string; en: string };
}>;

type MapOfMaps = Record<string, Record<string, number>>;

// 计费公式（来自 service/quota.go）：
//   QuotaPerUnit = 500_000（1 USD = 50 万 quota）
//
//   模式 A（ModelPrice > 0，按次）：
//     quota = ModelPrice × QuotaPerUnit × GroupRatio
//     => 每次调用花费 = ModelPrice × GroupRatio (USD)
//
//   模式 B（ModelPrice = 0，按 token）：
//     quota = (inputTokens + outputTokens × CompletionRatio + ...) × ModelRatio × GroupRatio
//     每 1M tokens USD = 1_000_000 / 500_000 × <倍率链> = 2 × <倍率链>
//
// 预览里 GroupRatio 统一按 1 算，管理员调整倍率时能快速看到"每 1M 多少钱"。
const QUOTA_PER_UNIT = 500_000;
const TOKENS_PER_MILLION = 1_000_000;
const USD_PER_MILLION_FACTOR = TOKENS_PER_MILLION / QUOTA_PER_UNIT; // = 2

function parseNum(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

type PreviewCurrency = 'USD' | 'CNY' | 'CUSTOM';

// 把 USD 原值按当前币种换算并格式化。精度随数值量级自适应：
//   < 0.01 → 6 位，< 1 → 4 位，其它 → 2 位。
// 对非 USD 币种，直接用 cfg 里配置的汇率与符号。
function fmtAmount(
  usd: number,
  currency: PreviewCurrency,
  cfg: PublicConfig
): string {
  let value = usd;
  let symbol = '$';
  if (currency === 'CNY') {
    value = usd * (cfg.usd_exchange_rate || 1);
    symbol = '¥';
  } else if (currency === 'CUSTOM') {
    value = usd * (cfg.custom_currency_exchange_rate || 1);
    symbol = cfg.custom_currency_symbol || '¤';
  }
  if (value === 0) return `${symbol}0`;
  const abs = Math.abs(value);
  if (abs < 0.01) return `${symbol}${value.toFixed(6)}`;
  if (abs < 1) return `${symbol}${value.toFixed(4)}`;
  return `${symbol}${value.toFixed(2)}`;
}

function PricingPreview({
  draft,
  lang,
}: {
  draft: Record<string, string>;
  lang: string;
}) {
  const zh = lang.startsWith('zh');
  const tt = (z: string, e: string) => (zh ? z : e);
  const cfg = usePublicConfig();

  // 币种切换：默认跟随系统 quota_display_type；TOKENS 回落到 USD（显示
  // quota 整数在预览场景没直观意义）。cfg 中未配汇率时隐藏对应按钮。
  const [currency, setCurrency] = useState<PreviewCurrency>(() => {
    if (cfg.quota_display_type === 'CNY') return 'CNY';
    if (cfg.quota_display_type === 'CUSTOM') return 'CUSTOM';
    return 'USD';
  });
  const availableCurrencies = useMemo<PreviewCurrency[]>(() => {
    const out: PreviewCurrency[] = ['USD'];
    if (cfg.usd_exchange_rate > 0) out.push('CNY');
    if (
      cfg.custom_currency_symbol &&
      cfg.custom_currency_symbol !== '¤' &&
      (cfg.custom_currency_exchange_rate ?? 0) > 0
    )
      out.push('CUSTOM');
    return out;
  }, [
    cfg.usd_exchange_rate,
    cfg.custom_currency_symbol,
    cfg.custom_currency_exchange_rate,
  ]);
  if (!availableCurrencies.includes(currency)) {
    setCurrency('USD');
  }

  const currencyLabel = (c: PreviewCurrency): string => {
    if (c === 'USD') return 'USD $';
    if (c === 'CNY') return 'CNY ¥';
    return cfg.custom_currency_symbol || 'CUSTOM';
  };

  const currencySwitcher =
    availableCurrencies.length > 1 ? (
      <div className='flex items-center gap-1 rounded-md border border-line bg-bg-0 p-0.5'>
        {availableCurrencies.map((c) => (
          <button
            key={c}
            type='button'
            onClick={() => setCurrency(c)}
            className={`rounded px-2 py-0.5 font-mono text-11 tabular-nums transition-colors ${
              c === currency
                ? 'bg-accent text-bg-0'
                : 'text-fg-2 hover:bg-bg-1 hover:text-fg-0'
            }`}
          >
            {currencyLabel(c)}
          </button>
        ))}
      </div>
    ) : null;

  const conversionNote =
    currency === 'USD' ? null : (
      <span className='ml-1'>
        {tt(
          `（按 1 USD = ${
            currency === 'CNY'
              ? cfg.usd_exchange_rate
              : cfg.custom_currency_exchange_rate
          } ${
            currency === 'CNY' ? '¥' : cfg.custom_currency_symbol ?? ''
          } 换算）`,
          `(converted at 1 USD = ${
            currency === 'CNY'
              ? cfg.usd_exchange_rate
              : cfg.custom_currency_exchange_rate
          } ${currency === 'CNY' ? '¥' : cfg.custom_currency_symbol ?? ''})`
        )}
      </span>
    );

  const price = parseNum(draft.ModelPrice);
  const ratio = parseNum(draft.ModelRatio);
  const completion = parseNum(draft.CompletionRatio);
  const cache = parseNum(draft.CacheRatio);
  const createCache = parseNum(draft.CreateCacheRatio);

  // 模式 A：ModelPrice > 0 → 按次计费
  if (price !== null && price > 0) {
    return (
      <div className='space-y-1.5 rounded-md border border-line bg-bg-1 p-3'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2 text-12 font-medium text-fg-0'>
            <span className='rounded bg-accent px-1.5 py-0.5 text-11 text-bg-0'>
              {tt('按次计费', 'Per-call')}
            </span>
            {tt('费用预览（GroupRatio = 1）', 'Cost preview (GroupRatio = 1)')}
          </div>
          {currencySwitcher}
        </div>
        <div className='font-mono text-14 tabular-nums text-fg-0'>
          {fmtAmount(price, currency, cfg)}{' '}
          <span className='text-11 text-fg-2'>
            / {tt('每次调用', 'per call')}
          </span>
        </div>
        <div className='text-11 text-fg-2'>
          {tt(
            '按次模式下 token 倍率不生效；实际计费会再乘分组倍率。',
            'In per-call mode, token ratios are ignored; actual cost also multiplies by group ratio.'
          )}
          {conversionNote}
        </div>
      </div>
    );
  }

  // 模式 B：需要至少填了 ModelRatio
  if (ratio === null) {
    return (
      <div className='rounded-md border border-dashed border-line bg-bg-1 p-3'>
        <div className='text-12 text-fg-2'>
          {tt(
            '填写"模型倍率"后显示每 1M tokens 的费用预览',
            'Set "Ratio" to see per-1M-tokens cost preview'
          )}
        </div>
      </div>
    );
  }

  const inputUSD = USD_PER_MILLION_FACTOR * ratio;
  const outputUSD =
    completion !== null ? USD_PER_MILLION_FACTOR * ratio * completion : null;
  const cacheReadUSD =
    cache !== null ? USD_PER_MILLION_FACTOR * ratio * cache : null;
  const cacheWriteUSD =
    createCache !== null
      ? USD_PER_MILLION_FACTOR * ratio * createCache
      : null;

  const Row = ({
    label,
    value,
  }: {
    label: string;
    value: number | null;
  }) => (
    <div className='flex items-baseline justify-between gap-2'>
      <span className='text-11 text-fg-2'>{label}</span>
      <span
        className={`font-mono text-13 tabular-nums ${
          value === null ? 'text-fg-2' : 'text-fg-0'
        }`}
      >
        {value === null ? '—' : fmtAmount(value, currency, cfg)}
      </span>
    </div>
  );

  return (
    <div className='space-y-2 rounded-md border border-line bg-bg-1 p-3'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2 text-12 font-medium text-fg-0'>
          <span className='rounded bg-accent px-1.5 py-0.5 text-11 text-bg-0'>
            {tt('按 token 计费', 'Per-token')}
          </span>
          {tt(
            '费用预览（每 1M tokens，GroupRatio = 1）',
            'Cost preview (per 1M tokens, GroupRatio = 1)'
          )}
        </div>
        {currencySwitcher}
      </div>
      <div className='grid grid-cols-2 gap-x-4 gap-y-1.5'>
        <Row label={tt('输入', 'Input')} value={inputUSD} />
        <Row label={tt('输出', 'Output')} value={outputUSD} />
        <Row label={tt('缓存读取', 'Cache hit')} value={cacheReadUSD} />
        <Row label={tt('缓存写入', 'Cache write')} value={cacheWriteUSD} />
      </div>
      <div className='text-11 text-fg-2'>
        {tt(
          '实际计费 = 预览值 × 分组倍率。此处假设分组倍率 = 1。',
          'Actual cost = preview × group ratio; this assumes group ratio = 1.'
        )}
        {conversionNote}
      </div>
    </div>
  );
}

function parseMap(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const n = Number(v);
        if (!Number.isNaN(n)) out[k] = n;
      }
      return out;
    }
  } catch {
    /* fall-through */
  }
  return {};
}

function snapshot(values: Record<string, string>): MapOfMaps {
  const result: MapOfMaps = {};
  for (const f of MODEL_FIELDS) result[f.key] = parseMap(values[f.key]);
  return result;
}

function allModelNames(maps: MapOfMaps): string[] {
  const set = new Set<string>();
  for (const key of Object.keys(maps)) {
    for (const name of Object.keys(maps[key] ?? {})) set.add(name);
  }
  return [...set].sort();
}

function fieldsOf(
  maps: MapOfMaps,
  model: string
): Record<string, string> {
  // Values shown in the form — empty string if the model is not present in that map.
  const out: Record<string, string> = {};
  for (const f of MODEL_FIELDS) {
    const v = maps[f.key]?.[model];
    out[f.key] = v === undefined ? '' : String(v);
  }
  return out;
}

export function ModelPricingPanel({
  values,
  onSaved,
}: {
  values: Record<string, string>;
  onSaved: (key: string, next: string) => void;
}) {
  const { t, i18n } = useTranslation('settings');
  const update = useUpdateOption();

  const maps = useMemo(() => snapshot(values), [values]);
  const models = useMemo(() => allModelNames(maps), [maps]);

  const [selected, setSelected] = useState<string | null>(models[0] ?? null);
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  // 本地已添加、但还没 Save 的模型名。addModel() 会往里塞，Save 后该名字
  // 进入 models（来自 props），下一次 render 里被清理。列表和重置守卫都要
  // 把它当"已存在"看待，避免刚加的新模型被守卫误伤掉。
  const [justAdded, setJustAdded] = useState<Set<string>>(() => new Set());

  // Render-time 清理：已经进入 saved models 的条目从 justAdded 移除。
  const staleJustAdded = useMemo(
    () => [...justAdded].filter((n) => models.includes(n)),
    [justAdded, models]
  );
  if (staleJustAdded.length > 0) {
    const next = new Set(justAdded);
    for (const n of staleJustAdded) next.delete(n);
    setJustAdded(next);
  }

  // 左侧列表 + 重置守卫看的是 models ∪ justAdded。
  const displayModels = useMemo(() => {
    if (justAdded.size === 0) return models;
    const extras = [...justAdded].filter((n) => !models.includes(n));
    return extras.length > 0 ? [...extras, ...models] : models;
  }, [models, justAdded]);

  // 当前选中的模型如果既不在 saved models 里、也不在 justAdded 里（真正消失
  // 了，比如刚被删除），才 fallback 到第一项。
  if (selected && !displayModels.includes(selected)) {
    setSelected(displayModels[0] ?? null);
  }

  const baseline = selected ? fieldsOf(maps, selected) : null;
  const [draft, setDraft] = useState<Record<string, string>>(baseline ?? {});

  // When selection changes, reset draft.
  // React pattern: key the right-hand form by selected model so it remounts naturally.
  // Here instead we detect divergence and reset via an effect-less derived check.
  const selectedKey = selected ?? '';
  const [lastKey, setLastKey] = useState(selectedKey);
  if (lastKey !== selectedKey) {
    setLastKey(selectedKey);
    setDraft(baseline ?? {});
  }

  const filteredModels = useMemo(() => {
    if (!filter) return displayModels;
    const q = filter.toLowerCase();
    return displayModels.filter((m) => m.toLowerCase().includes(q));
  }, [displayModels, filter]);

  const dirtyKeys = useMemo(() => {
    if (!selected || !baseline) return [] as string[];
    return MODEL_FIELDS.map((f) => f.key).filter(
      (k) => (draft[k] ?? '') !== (baseline[k] ?? '')
    );
  }, [draft, baseline, selected]);

  function addModel() {
    const name = newName.trim();
    if (!name) return;
    if (!models.includes(name)) {
      // 加入 justAdded 后，渲染期重置守卫会放行这个 selected，
      // Save 之后才从 maps 派生出来合并回 models。
      setJustAdded((prev) => {
        if (prev.has(name)) return prev;
        const next = new Set(prev);
        next.add(name);
        return next;
      });
      setSelected(name);
      setDraft({
        ModelPrice: '',
        ModelRatio: '',
        CompletionRatio: '',
        CacheRatio: '',
        CreateCacheRatio: '',
        ImageRatio: '',
        AudioRatio: '',
        AudioCompletionRatio: '',
      });
    } else {
      setSelected(name);
    }
    setNewName('');
  }

  async function saveOne(optionKey: string, updatedMap: Record<string, number>) {
    const json = JSON.stringify(updatedMap);
    await new Promise<void>((resolve, reject) => {
      update.mutate(
        { key: optionKey, value: json },
        {
          onSuccess: () => {
            onSaved(optionKey, json);
            resolve();
          },
          onError: (e) => reject(e),
        }
      );
    });
  }

  async function save() {
    if (!selected) return;
    const errors: string[] = [];
    for (const key of dirtyKeys) {
      const raw = (draft[key] ?? '').trim();
      const next = { ...(maps[key] ?? {}) };
      if (raw === '') {
        delete next[selected];
      } else {
        const n = Number(raw);
        if (Number.isNaN(n)) {
          errors.push(key);
          continue;
        }
        next[selected] = n;
      }
      try {
        await saveOne(key, next);
      } catch (e) {
        errors.push((e as Error).message || key);
      }
    }
    if (errors.length > 0) {
      toast.error(errors.join(', '));
    } else {
      toast.success(t('toast.save.success'));
    }
  }

  async function deleteModel() {
    if (!selected) return;
    for (const f of MODEL_FIELDS) {
      if (maps[f.key]?.[selected] === undefined) continue;
      const next = { ...(maps[f.key] ?? {}) };
      delete next[selected];
      try {
        await saveOne(f.key, next);
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    }
    toast.success(t('toast.save.success'));
    setSelected(null);
  }

  function revert() {
    if (baseline) setDraft(baseline);
  }

  const lang = i18n.language;
  return (
    <div className='space-y-3 border-b border-line py-3 last:border-b-0'>
      <div>
        <div className='text-13 font-medium'>{t('model_pricing.title')}</div>
        <div className='text-12 text-fg-2'>{t('model_pricing.sub')}</div>
      </div>
      <div className='grid gap-4 md:grid-cols-[260px_1fr]'>
        <aside className='flex max-h-[520px] flex-col rounded-md border border-line bg-bg-0'>
          <div className='space-y-2 border-b border-line p-2'>
            <Input
              placeholder={t('model_pricing.search')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className='flex gap-1'>
              <Input
                placeholder={t('model_pricing.new_placeholder')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addModel();
                  }
                }}
                className='flex-1'
              />
              <Button
                type='button'
                size='sm'
                variant='secondary'
                onClick={addModel}
              >
                {t('kv.add')}
              </Button>
            </div>
            <div className='text-11 text-fg-2'>
              {displayModels.length} {t('model_pricing.total')}
            </div>
          </div>
          <div className='flex-1 overflow-y-auto py-1'>
            {filteredModels.length === 0 ? (
              <div className='p-4 text-center text-12 text-fg-2'>
                {t('model_pricing.empty')}
              </div>
            ) : (
              <ul>
                {filteredModels.map((m) => (
                  <li key={m}>
                    <button
                      type='button'
                      onClick={() => setSelected(m)}
                      className={`w-full truncate px-3 py-1.5 text-left font-mono text-12 ${
                        m === selected
                          ? 'bg-bg-1 text-fg-0'
                          : 'text-fg-1 hover:bg-bg-1'
                      }`}
                    >
                      {m}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
        <section className='min-w-0 rounded-md border border-line bg-bg-0 p-4'>
          {selected ? (
            <div className='space-y-3'>
              <div className='flex items-center justify-between gap-2'>
                <div className='min-w-0'>
                  <div className='truncate font-mono text-14'>{selected}</div>
                  <div className='text-11 text-fg-2'>
                    {dirtyKeys.length > 0
                      ? t('model_pricing.dirty', { count: dirtyKeys.length })
                      : t('model_pricing.clean')}
                  </div>
                </div>
                <div className='flex gap-1'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-danger'
                    onClick={deleteModel}
                    disabled={update.isPending}
                  >
                    {t('model_pricing.delete')}
                  </Button>
                  {dirtyKeys.length > 0 && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={revert}
                    >
                      {t('action.revert')}
                    </Button>
                  )}
                  <Button
                    type='button'
                    size='sm'
                    disabled={dirtyKeys.length === 0 || update.isPending}
                    onClick={save}
                  >
                    {update.isPending
                      ? t('action.saving')
                      : t('action.save')}
                  </Button>
                </div>
              </div>
              <PricingPreview draft={draft} lang={lang} />
              <div className='grid gap-3 sm:grid-cols-2'>
                {MODEL_FIELDS.map((f) => {
                  const label = lang.startsWith('zh')
                    ? f.label.zh
                    : f.label.en;
                  const dirty = dirtyKeys.includes(f.key);
                  return (
                    <div key={f.key} className='space-y-1'>
                      <Label
                        htmlFor={`mp-${f.key}`}
                        className='flex items-center gap-2 text-12'
                      >
                        {label}
                        {dirty && (
                          <span className='rounded-sm bg-warn px-1 text-11 text-bg-0'>
                            {t('model_pricing.changed')}
                          </span>
                        )}
                      </Label>
                      <Input
                        id={`mp-${f.key}`}
                        type='number'
                        step='any'
                        className='tabular-nums'
                        value={draft[f.key] ?? ''}
                        placeholder={t('model_pricing.unset')}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [f.key]: e.target.value,
                          }))
                        }
                      />
                      <div className='font-mono text-11 text-fg-2'>{f.key}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className='py-12 text-center text-13 text-fg-2'>
              {t('model_pricing.pick_hint')}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
