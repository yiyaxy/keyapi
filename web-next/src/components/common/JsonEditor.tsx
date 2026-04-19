import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// JsonEditor wraps a Textarea with a "Format" button and live parse-error
// feedback. It keeps the string-in/string-out contract of the plain
// Textarea so it's drop-in with react-hook-form — we never mutate the
// value silently; "format" only fires when the admin clicks the button.

export function JsonEditor({
  value,
  onChange,
  rows = 4,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation('channels');

  // Compute parse status once per value change. An empty value is treated
  // as valid — the field is optional almost everywhere we use this.
  const parseError = useMemo<string | null>(() => {
    if (!value.trim()) return null;
    try {
      JSON.parse(value);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, [value]);

  function format() {
    if (!value.trim()) return;
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2));
    } catch {
      // leave value untouched; the error line already tells the user
    }
  }

  return (
    <div className='space-y-1.5'>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className='font-mono text-12'
      />
      <div className='flex items-center justify-between gap-2'>
        <p className='text-12 text-danger'>{parseError ? `JSON: ${parseError}` : ''}</p>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={format}
          disabled={disabled || !value.trim() || Boolean(parseError)}
        >
          {t('form.json.format')}
        </Button>
      </div>
    </div>
  );
}
