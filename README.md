# QuoteOS (BahaOS)

A multi-tenant, configurable **quote-generation and lead-qualification engine** for
professional-service businesses - "Stripe Checkout for professional-service quotes".

```
Visitor → dynamic questions → deterministic pricing / human review → lead capture
        → CRM record → automated follow-up → consultation → analytics
```

Build once, configure per client (branding + services + questions + pricing + rules +
templates), deploy repeatedly. The first vertical recipe is **Accounting** (bookkeeping,
payroll, VAT, tax, audit, advisory).

## Quick start

Requirements: Node 22, PostgreSQL 14+.

```bash
cp .env.example .env            # set DATABASE_URL and BETTER_AUTH_SECRET
npm install
npx prisma migrate deploy       # or: npm run db:migrate (development)
npm run db:seed                 # Executive Financials Demo (fictional data)
npm run dev
```

| URL | What |
|---|---|
| `/q/executive-financials` | Public quote funnel (org's active template) |
| `/q/executive-financials?template=modern` / `premium` | Same engine, other templates |
| `/q/executive-financials?service=bookkeeping&utm_source=instagram&utm_campaign=bookkeeping-september` | Deep link with attribution |
| `/dashboard` | Admin (sign in `demo@quoteos.dev` / `demo-password-123`) |

All demo prices and data are fictional and are **not** recommendations of real accounting fees.

## Commands

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` · `npm run lint` | TypeScript · ESLint |
| `npm test` | All tests (unit + integration) |
| `npm run test:unit` | Pure engine tests (no DB) |
| `npm run test:integration` | Service + HTTP tests against `quoteos_test` (`TEST_DATABASE_URL`; the DB name must end in `_test`, tables are truncated between tests) |
| `npm run db:seed -- --reset` | Recreate only the demo organization |

Scheduled job: `POST /api/cron/abandon` with `Authorization: Bearer $CRON_SECRET` every ~10 minutes marks idle sessions abandoned and fires `QUOTE_ABANDONED`.

## Architecture

```
src/core/          Pure, framework-free engine (runs in browser and server; no I/O)
  conditions/        JSON condition DSL: all/any/not + eq, gt, between, in, contains, exists…
  questions/         Visibility (decision tree), answer validation, pruning, formatting, lint
  pricing/           Deterministic integer-cents rules engine + human-readable rule preview
  quote/             Outcome resolver: PRICE | RANGE | REVIEW | CONTACT (the only place that decides if a price is shown)
  leads/             Qualification: score, intent, tags, review flag, owner routing
  config/            Portable QuoteConfig schema (import/export, recipes, AI proposals) + pricing customization
src/server/        Prisma-bound, tenant-scoped services
  authz.ts           Membership → OrgContext (404 across tenants, role checks)
  services/          quote-flow, config-admin, config-io, leads, analytics, automations, ai-config, organizations, webhooks
  providers/         Email, WhatsApp, SMS, Calendar, CRM, AI, Analytics interfaces + implementations
src/recipes/       Vertical recipes (Accounting implemented; Insurance/Agency/Solar/Contractor planned)
src/templates/     UI templates (Professional, Modern, Premium) - presentation only
src/components/    funnel/ (headless useQuoteFunnel hook + shared step renderer), dashboard/
src/app/           Next.js routes: /q/[org], /dashboard/…, /api/public/…, /api/orgs/…
prisma/            Schema, migrations, demo seed
```

### Key guarantees

- **Multi-tenant.** Every tenant row carries `organizationId`; staff services take an
  `OrgContext` from authorization, never an org id from the client. Cross-tenant ids return 404.
- **Configuration over code.** Services, questions, conditions, pricing rules, lead rules,
  message templates, automations, branding and template choice all live in the database and
  round-trip through the `QuoteConfig` JSON format.
- **Deterministic, server-side pricing.** The browser never sends prices. At completion the
  server re-validates every answer, recomputes visibility, prunes hidden answers and runs the
  engine. AI never produces prices; assistant replies are additionally filtered for amounts.
- **Immutable quotes.** A quote stores the answers snapshot, service snapshot and the full
  calculation (including every rule definition it evaluated and a fingerprint). Changing rules
  only affects new quotes; `Quote` pricing fields are never updated.
- **Human review.** `HUMAN_REVIEW`/`CONTACT_ONLY` services never run pricing; `REQUIRE_REVIEW`
  rules downgrade instant quotes. Review leads are `NEEDS_REVIEW` and staff are always notified
  (via automation, or a built-in fallback if none is configured).
- **Attribution.** UTM parameters, referrer and landing page are captured at session start
  (referrer-derived source when no UTM; otherwise `direct`) and copied onto the lead.
- **Swappable UI.** `useQuoteFunnel` holds all flow logic; templates are a shell + skin.

### Money
Integer minor units (`…Cents`) everywhere. Multiplicative steps round half away from zero;
totals are clamped at zero and at an optional minimum price. Pipeline analytics are summed per
billing period and never mix monthly with one-time values.

### Adding things
- **A vertical**: add `src/recipes/<vertical>.ts` exporting a `QuoteConfigInput`, register it in `src/recipes/index.ts`.
- **A template**: add a key to `src/templates/registry.ts` and a shell+skin component to `src/templates/index.tsx`.
- **A messaging vendor** (e.g. WhatsApp): implement `WhatsAppProvider` in `src/server/providers` and select it in `createDefaultProviders()`.
- **Claude-powered AI**: set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`; it falls back to the offline heuristic provider on error.

### Booking webhook
`POST /api/webhooks/booking/{org}` with headers `x-quoteos-timestamp` (unix seconds, ±5 min) and
`x-quoteos-signature: sha256=HMAC_SHA256(webhookSecret, "{timestamp}.{rawBody}")`; body
`{ "event": "booking.created", "provider": "calendly", "externalId": "…", "startsAt": "ISO", "email": "…" }`.
Idempotent per `externalId`.
