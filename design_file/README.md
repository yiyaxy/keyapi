# new-api Design System

Design system for the **new-api frontend rewrite** — a multi-tenant AI gateway / API key management SaaS for paying developer-grade users.

> ⚠ This system describes the **new** stack (Vite 6 + React 19 + Tailwind + shadcn/ui). The legacy `web/` Semi-based UI is not covered here.

## Sources

- **Codebase (read-only mount):** `web/` — the legacy React 18 + Semi Design app. Pages under `web/src/pages/*` (Dashboard, Token, TopUp, Playground, Subscription, Tenant…) gave us the IA. Components under `web/src/components/{dashboard,topup,layout,playground,tenant}/`.
- **Design briefs:** `web/.impeccable.md` and `web/CLAUDE.md` (legacy stack), and the `Design Context — new-api (frontend rewrite)` brief shipped with this project (the authoritative source for the **new** stack and the basis of every token here).
- **Brand asset:** `web/public/logo.png` → copied to `assets/logo.png`.

## Index

| File | Purpose |
|---|---|
| `colors_and_type.css` | Single source of truth for color, radius, spacing, motion, type tokens. Light + dark, OKLCH only. |
| `fonts/fonts.css` | Webfont loader. Substitutes Be Vietnam Pro / JetBrains Mono for General Sans / Commit Mono (see Caveats). |
| `assets/logo.png` | Brand mark. |
| `preview/*.html` | Spec cards rendered in the Design System tab. |
| `ui_kits/console/` | High-fi recreation of the developer console (sidebar, dashboard, keys, billing, playground). |
| `SKILL.md` | Cross-compatible Skill manifest. |

## Brand snapshot

Three words: **technical · sharp · modern.** The product is a developer tool, not an enterprise admin panel. Money is the visual hero on every screen. The whole UI lives in cool greys with one chromatic accent (a graphite-sage green) reserved for links, selection, and the single most important number per view.

Reference quality: Anthropic Console, Linear, OpenAI Platform, Vercel, Stripe.
Anti-references: rainbow tags, glassmorphism, big-red-and-gold reporting tables, cartoon icons, chat-bubble warmth.

## CONTENT FUNDAMENTALS

### Voice
- **Verb-first, short, present tense.** Not "Please click here to begin recharging your account" — "Top up" or "Add funds".
- **No customer-service register.** Banned: "尊敬的用户", "亲", "小主", "Hi there!", emoji greetings, exclamation marks (except in real errors).
- **Confidence > enthusiasm.** "This charge will renew on Apr 1" — not "Great news! Your subscription is all set 🎉".
- **English technical terms stay English** in both zh and en copy: API Key, Token, Quota, Playground, Channel, Tenant. Don't translate them.
- **Numbers do the talking.** Where copy and a number compete for the same line, demote the copy.
- **First/second person:** address the user as "you" / 「你」, never "the user" / 「用户」 in UI; admin views may use "members" / 「成员」.

### Tone by surface
| Surface | Tone | Example |
|---|---|---|
| Dashboard hero | Quiet fact | `$1,284.50 remaining · resets May 1` |
| Empty state | Action-prompting | `No keys yet. Create one →` |
| Error toast | Diagnostic | `401 from upstream · channel #4 disabled` |
| Confirmation | Imperative | `Revoke key sk-…V8j2?` |
| Success | Past tense fact | `Topped up $50.00` (no celebration) |
| Onboarding | Encouraging but flat | `Generate a key, then ship a request.` |

### Casing
- **Sentence case** everywhere — buttons, headings, menu items.
- Brand names keep their canonical casing: `new-api`, `OpenAI`, `Anthropic`, `gpt-4o`.
- Acronyms uppercase: `API`, `JSON`, `RPM`, `SLA`.

### Emoji
**No.** Brand has no emoji. The only Unicode glyphs allowed in product surfaces are arrows (`→ ↑ ↓`), bullets (`·`), and the en/em dash (`– —`). Status is communicated by icon + colored dot + label, never by emoji.

### Numbers
- Currency: ISO-4217 prefix, two decimals, comma thousands: `$1,284.50`, `¥9,432.10`.
- Tokens / requests: comma thousands, no decimals: `9,432,108 tokens`.
- Percentages: integer with `%` (`92%`); one decimal only when the difference matters (`0.4%`).
- Always `tabular-nums` so columns align.

## VISUAL FOUNDATIONS

### Color
- **Mode:** light default, follows system, dark theme is first-class. Both themes maintain ≥4.5:1 text contrast and ≥3:1 large-element contrast.
- **Surfaces:** layered cool greys `bg-0 → bg-1 → bg-2 → bg-3`. Hierarchy is built with backgrounds and borders, **not stacked shadows**.
- **Text:** `text-0 / text-1 / text-2`. No fourth tier — if you need it, you're cheating density.
- **Brand:** the CTA color is near-black charcoal (`oklch(0.22 .010 260)`); in dark mode it inverts to near-white. There is exactly **one chromatic accent** (`oklch(0.65 .16 160)`, a graphite-sage green) — used for links, selection, the focused control, and the single most important number per screen.
- **Semantics:** danger / warn / success / info each have a base + soft-background pair. They're never used purely by color — always `dot + label + background` so the meaning survives color blindness and grayscale.
- **Charts:** semantic series `data-0 → data-7`, defined separately for light and dark.

### Type
- **Sans:** General Sans (body, UI, headings, money). Substituted with Be Vietnam Pro until the real woff2 is dropped in `fonts/`.
- **CJK:** HarmonyOS Sans SC. Fallback: PingFang SC, Microsoft YaHei.
- **Mono:** Commit Mono (code, API keys, log timestamps, optional tabular numbers). Substituted with JetBrains Mono.
- **Scale (rem-fixed, no clamp):** 12 / 13 / 14 / 16 / 18 / 20 / 24 / 32 / 48.
- **Weights:** 400 body, 500 labels and active states, **600 max** for headings and money. Never 700+.
- **Banned families:** Inter, Roboto, Arial, Helvetica Neue, Lato, IBM Plex, Space Grotesk, Instrument, Fraunces.

### Spacing
- **8-px base, three blessed gaps:** 12, 16, 24. Larger spacing only for marketing pages — not in the console.
- Card inner padding `16` (compact rows) or `24` (hero card). Gap between cards: `16` mobile, `24` desktop.
- Form vertical rhythm: `12` between label and field, `16` between fields, `24` before submit.

### Backgrounds & imagery
- **No full-bleed photos** in console surfaces. Marketing pages may carry one quiet hero.
- **No gradients** on text, on borders, or on cards. (Banned: `background-clip: text`, gradient hero metrics, sparkline gradients.)
- **No textures, no noise overlays, no glassmorphism, no blur balls.**
- Empty states use a single 1-bit line illustration (Lucide-style outline) on `bg-1`, never a colorful spot illustration.

### Borders, radii
- **Radii small:** `xs 4` for tags, `sm 6` for inputs and buttons, `md 8` for cards and menus, `lg 12` for modal/sheet only. Pill `9999` for status dots and chips.
- **Single 1-px border** at `--border`; on hover or focus, swap color (`--border-strong` or `--accent`) instead of doubling up.
- **No left-color-bar accent borders.** That is one of the loudest AI-design tells.

### Shadows / elevation
Three shadows total. `shadow-sm` (table rows, sticky headers), `shadow-md` (popovers, dropdowns), `shadow-pop` (modal, command palette, toast). Cards default to **no shadow** — they're delineated by `bg-1` against `bg-0` plus a 1-px border.

### Hover, press, focus
- **Hover:** background shifts up one surface step (`bg-1 → bg-2`), or text deepens by one tier (`text-1 → text-0`). Never opacity-fade.
- **Press:** brief darken (`bg-2 → bg-3`) — no scale / shrink animation.
- **Focus:** 2-px outline at `--focus-ring` (a neutral cyan distinct from `--accent`), 2-px offset.
- **Transitions:** 120ms `ease-out` for color, 180ms `ease-out-quart` for everything else; `transform` and `opacity` only — never animate layout.
- `prefers-reduced-motion` zeros out all durations.

### Transparency / blur
Used **only** for: modal scrim (rgba black 50%), tooltip background (`bg-1` 90%), the popover border-glow on focused command palette. No frosted nav bars. No backdrop blur on cards.

### Layout rules
- App shell: 240-px collapsible left sidebar, 56-px top bar, content fluid to a 1280-px max.
- Tables: full-width inside their card; sticky header; never horizontal scroll without a hint.
- Forms: single column up to ~600px; two columns only when fields are tightly paired (city + zip).

## ICONOGRAPHY

**System:** [Lucide](https://lucide.dev) at **1.5 stroke**, 16 px in dense rows, 18–20 px in headers. The legacy app mixed `@douyinfe/semi-icons`, `lucide-react`, and `@lobehub/icons` — for the rewrite we collapse to **Lucide only**, with `@lobehub/icons` reserved for vendor/model brand marks (OpenAI, Anthropic, Google, etc.) where Lucide has no equivalent.

- **No emoji** anywhere in the product.
- **Allowed Unicode glyphs:** `→ ↑ ↓ · – —`. Nothing else.
- **No PNG icons** in UI surfaces — exceptions: payment-method marks (Apple Pay, Google Pay, card brands) which are in `assets/payments/` for legal/likeness reasons.
- **No hand-rolled SVG** unless replacing the brand mark or a vendor logo. If something is missing from Lucide, search Lucide first, then `@lobehub/icons` for vendor marks, then ask.
- **Rendering:** `currentColor`, never hardcoded fill — icons inherit the surrounding text color.

## Caveats / open

- **Fonts substituted.** General Sans (Fontshare) and Commit Mono (OFL) are referenced in CSS but not bundled — `fonts/fonts.css` falls back to Be Vietnam Pro and JetBrains Mono via Google Fonts. **Please drop the real woff2 files into `fonts/` to get the intended look.**
- **HarmonyOS Sans SC** is referenced in the font stack but not bundled (license + 8 MB weight). Decision pending: bundle subsets, host on CDN, or fall back to PingFang/system.
- **Marketing site** — only the authenticated console is covered here. Marketing/pricing/landing live elsewhere and will need their own kit when in scope.
- **Logo wordmark** — the existing `logo.png` is a colored gradient mark that conflicts with the "no gradients" rule. Treated as legacy; flag for redesign.

## Help me iterate
Tell me what's off — color hue, accent intensity, font substitute, density of cards, any token that doesn't match the Linear/Anthropic feel you're after — and I'll cut a v2.
