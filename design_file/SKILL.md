---
name: new-api Design System
description: Design tokens, type, color, spacing, component patterns, and voice/tone rules for the new-api developer console (LLM gateway / API key SaaS). Load this when designing any new-api surface — console, dashboard, API key manager, playground, billing, or marketing.
---

# new-api Design System Skill

You are designing for **new-api**, a multi-tenant LLM gateway console. The visual language is **technical, sharp, and modern** — closer to Linear, Anthropic Console, and Vercel than to legacy admin panels.

## Core files in this project
- `colors_and_type.css` — single source of truth for all tokens (color, type, spacing, radii, motion). Light + dark, OKLCH only. **Always link this file; never inline duplicate tokens.**
- `fonts/fonts.css` — webfont loader. Substitutes Be Vietnam Pro / JetBrains Mono for General Sans / Commit Mono.
- `assets/logo.png` — brand mark.
- `preview/*.html` — spec cards (type, color, spacing, components, brand). Copy patterns from here.
- `ui_kits/console/` — reference hi-fi for a working console (sidebar, dashboard, keys, playground, billing). Reuse its components.
- `README.md` — full written spec. Read this before starting substantial work.

## Quick rules (do not break)

### Color
- **One chromatic accent.** `oklch(0.65 0.16 160)` (graphite-sage green) — reserved for links, selection, focused control, and the single most important number per screen. Never decorative.
- CTA color is **near-black** (`--primary`), not the accent. In dark mode it inverts.
- Hierarchy from layered cool greys: `--bg-0 → --bg-1 → --bg-2`. Cards get `--bg-1` against `--bg-0` + 1-px border — no stacked shadows.
- Three text tiers only: `--text-0 / --text-1 / --text-2`.
- Semantic states (`success / warn / danger / info`) always render as `colored dot + label + soft background` — never color-only.

### Type
- Families: `var(--font-sans)` (General Sans / Be Vietnam Pro) and `var(--font-mono)` (Commit Mono / JetBrains Mono). **Banned:** Inter, Roboto, Arial, Helvetica, Lato, IBM Plex, Space Grotesk, Instrument, Fraunces.
- Scale: 12 / 13 / 14 / 16 / 18 / 20 / 24 / 32 / 48. No clamp.
- Weights: 400 body, 500 labels/active, **600 max** for headings and money. Never 700+.
- Money is the visual hero. Always use `.money` or `.num` class (tabular-nums, tnum+cv11+ss01 features).

### Spacing
- 8-px base. Blessed gaps in console: **12, 16, 24.** Larger spacing is for marketing only.
- Card padding: 16 (dense) or 24 (hero).
- Form rhythm: 12 between label→field, 16 between fields, 24 before submit.

### Borders, radii, shadow
- Radii: `--r-xs 4` (tags), `--r-sm 6` (inputs/buttons), `--r-md 8` (cards/menus), `--r-lg 12` (modals only), `--r-pill 9999` (dots/chips).
- Single 1-px border at `--border`; on hover/focus swap to `--border-strong` or `--accent`.
- Three shadow tokens total: `--shadow-sm` / `--shadow-md` / `--shadow-pop`. Cards default to **no shadow.**
- **No left-color-bar accent borders** — that's the loudest AI-design tell.

### Motion
- 120ms `ease-out` for color, 180ms `ease-out-quart` for layout-free transitions.
- `transform` and `opacity` only — never animate `width/height/top/left`.
- Respect `prefers-reduced-motion`.

### Iconography
- **Lucide only**, 1.5 stroke weight, 16 px in rows, 18–20 px in headers. Use `@lobehub/icons` only for vendor/model brand marks (OpenAI, Anthropic, Google). No hand-rolled SVG.
- Icons inherit `currentColor`. Never hardcode fill.
- **No emoji.** Allowed Unicode: `→ ↑ ↓ · – —`. Nothing else.

## Voice & copy
- Verb-first, sentence case, present tense. "Top up", not "Click here to add funds".
- No enthusiasm, no exclamation marks (except real errors), no customer-service register.
- Numbers do the talking. If copy competes with a number on the same line, shorten the copy.
- English technical terms (API Key, Token, Quota, Playground, Channel, Tenant) stay English in both zh and en copy.
- Currency: `$1,284.50` (ISO prefix, 2 decimals, comma thousands). Token counts: no decimals, comma thousands. Always tabular-nums.

## When designing a new surface

1. **Read `README.md`** in full for anything non-trivial.
2. **Link `fonts/fonts.css` then `colors_and_type.css`** in `<head>`. Never redefine tokens.
3. **Start from a component in `preview/` or `ui_kits/console/`.** If the pattern exists, match it exactly — button styles, tables, form fields, pills.
4. **Respect the token ladder.** Use `var(--bg-1)` not `#f7f7f7`; use `var(--text-1)` not `rgb(100,100,100)`; use `var(--r-sm)` not `6px`.
5. **Money gets prominence.** Every dashboard/billing surface leads with a big tabular-nums currency readout.
6. **Dark mode is first-class.** The tokens handle it automatically when `html.dark` or `@media (prefers-color-scheme: dark)` applies.

## Quick snippet — page shell

```html
<link rel="stylesheet" href="fonts/fonts.css" />
<link rel="stylesheet" href="colors_and_type.css" />
<style>
  body { background: var(--bg-0); color: var(--text-0); font-family: var(--font-sans); }
</style>
```

## What to ask the user
If the ask is ambiguous, clarify:
- Which surface? (console view, marketing page, email, modal)
- Light, dark, or both?
- Is this for a paid-feature flow (money is hero) or a setting/admin view (dense, quieter)?
- Does it need i18n (zh + en)? If so, CJK font stack kicks in.

## Don't
- Don't import Inter, Roboto, or any banned font "just to be safe".
- Don't add gradients, glassmorphism, noise textures, or backdrop blur to console surfaces.
- Don't invent a new accent color. One accent. If you think you need two, you don't.
- Don't use emoji, rainbow status pills, or colorful spot illustrations.
- Don't put a colored left-border accent bar on cards.
- Don't stack shadows to build hierarchy. Use background + border.
