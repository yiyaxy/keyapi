import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '.dark'],
  theme: {
    extend: {
      colors: {
        bg: {
          0: 'var(--bg-0)',
          1: 'var(--bg-1)',
          2: 'var(--bg-2)',
          3: 'var(--bg-3)',
        },
        fg: {
          0: 'var(--text-0)',
          1: 'var(--text-1)',
          2: 'var(--text-2)',
          inv: 'var(--text-inv)',
        },
        line: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          fg: 'var(--primary-fg)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          fg: 'var(--accent-fg)',
          soft: 'var(--accent-soft)',
        },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)' },
        data: {
          0: 'var(--data-0)',
          1: 'var(--data-1)',
          2: 'var(--data-2)',
          3: 'var(--data-3)',
          4: 'var(--data-4)',
          5: 'var(--data-5)',
          6: 'var(--data-6)',
          7: 'var(--data-7)',
        },
        ring: 'var(--focus-ring)',
        // shadcn compatibility aliases (bridge shadcn's CSS var names to design tokens)
        'primary-foreground': 'var(--primary-fg)',
        'accent-foreground': 'var(--accent-fg)',
        secondary: 'var(--bg-2)',
        'secondary-foreground': 'var(--text-0)',
        background: 'var(--bg-1)',
        foreground: 'var(--text-0)',
        muted: 'var(--bg-2)',
        'muted-foreground': 'var(--text-1)',
        card: 'var(--bg-1)',
        'card-foreground': 'var(--text-0)',
        popover: 'var(--bg-1)',
        'popover-foreground': 'var(--text-0)',
        destructive: 'var(--danger)',
        'destructive-foreground': 'var(--text-inv)',
        input: 'var(--border)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        pill: 'var(--r-pill)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        pop: 'var(--shadow-pop)',
      },
      transitionDuration: {
        fast: '120ms',
        DEFAULT: '180ms',
        slow: '280ms',
      },
    },
  },
  plugins: [],
} satisfies Config;
