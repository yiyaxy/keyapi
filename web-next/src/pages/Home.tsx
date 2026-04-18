import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { applyTheme, getStoredTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

function ThemeToggle() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme);

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  const options: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: t('theme.light') },
    { value: 'dark', icon: Moon, label: t('theme.dark') },
    { value: 'system', icon: Monitor, label: t('theme.system') },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.toggle')}
      className="inline-flex items-center gap-1 rounded-md border border-line p-1"
    >
      {options.map(({ value, icon: Icon, label }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(value)}
            className={cn(
              'inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-13 transition-colors',
              active
                ? 'bg-bg-2 text-fg-0'
                : 'text-fg-1 hover:bg-bg-1 hover:text-fg-0'
            )}
          >
            <Icon size={14} strokeWidth={1.5} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className="h-10 w-10 rounded-sm border border-line"
        style={{ background: `var(${varName})` }}
      />
      <div className="min-w-0">
        <div className="text-13 text-fg-0">{name}</div>
        <div className="mono text-12 text-fg-2">{varName}</div>
      </div>
    </div>
  );
}

export default function Home() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex min-h-full max-w-[960px] flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="eyebrow">{t('app.name')}</div>
          <h1 className="h1 mt-1">{t('home.scaffold.ok')}</h1>
          <p className="muted mt-2">{t('home.scaffold.desc')}</p>
        </div>
        <ThemeToggle />
      </header>

      <section className="rounded-md border border-line bg-bg-1 p-6">
        <div className="eyebrow">{t('home.balance.label')}</div>
        <div className="money money-xl mt-2">
          $1,284<span className="text-fg-1">.50</span>
        </div>
        <p className="subtle mt-2 text-13">{t('home.balance.note')}</p>
      </section>

      <section className="rounded-md border border-line bg-bg-1 p-6">
        <div className="eyebrow mb-4">Tokens</div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Swatch name="Page" varName="--bg-0" />
          <Swatch name="Card" varName="--bg-1" />
          <Swatch name="Inset" varName="--bg-2" />
          <Swatch name="Hover" varName="--bg-3" />
          <Swatch name="Primary" varName="--primary" />
          <Swatch name="Accent" varName="--accent" />
          <Swatch name="Border" varName="--border" />
          <Swatch name="Focus" varName="--focus-ring" />
        </div>
      </section>
    </div>
  );
}
