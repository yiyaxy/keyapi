# Console UI Kit

High-fidelity recreation of the **new-api developer console** — the authenticated app where users manage keys, watch usage, top up balance, and run the Playground.

## Files

- `index.html` — the live click-through prototype. Open this to navigate the kit.
- `App.jsx` — top-level shell + view router.
- `Sidebar.jsx`, `Topbar.jsx` — navigation chrome.
- `Dashboard.jsx` — landing view: hero balance, spend chart, quick stats, recent logs.
- `Keys.jsx` — API key table + create-key sheet.
- `Playground.jsx` — model picker + chat-style runner with streamed mock response.
- `Billing.jsx` — top-up amounts, current plan, invoices.
- `tokens.js` — re-export of design-system tokens for inline use.

## Surfaces covered
1. Dashboard — *Money is the hero*: 48-px balance, 30-day spend, request volume, status of upstream channels.
2. API Keys — table with copy / revoke / quota; create-key side sheet.
3. Playground — model selector, chat composer, streamed completion.
4. Billing — top-up presets, invoices, plan selection.

## Out of scope (intentional)
Marketing pages, admin/tenant management screens, channel monitor — these aren't part of the buyer-facing console.
