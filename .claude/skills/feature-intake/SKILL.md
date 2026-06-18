---
name: feature-intake
description: >-
  Turn a feature idea or a docs/IMPROVEMENT_BACKLOG.md item into a built change
  the right way for THIS codebase. Interviews the user to fix scope through their
  lens (own-vs-manage-for-owners, small-operator-ROI vs parity, must-haves, their
  own touch), then produces a codebase-aligned spec + plan — attaching to existing
  seams, flagging hot-zone blast radius, and stating a verification plan — before
  any code is written. Use when the user says "let's build X", "spec this", "add a
  feature", or picks an item off the backlog.
---

# Feature intake → spec

Bridge a rough idea to a clean, conventions-aligned build. Don't start coding until the spec is agreed.

## 1. Interview (use AskUserQuestion — keep it tight)

Learn only what changes the design:
- **Scope** — the smallest version that delivers the value; what's explicitly OUT (v1).
- **Operator lens** — does it serve an owner-operator or a manager-for-owners? Optimize for small-operator ROI unless told otherwise (skip enterprise-only complexity).
- **Their touch** — where do they want their own stamp (tenant-facing voice/flow, staff workflow, defaults)? Always offer "Other" for custom direction and features you didn't list.
- **Surfacing** — should it be a module flag (`AppSettings.modules`) so it can be toggled?

## 2. Write the spec (align to CLAUDE.md conventions)

Cover, briefly:
- **Problem & value** (one paragraph) and **scope in/out**.
- **Data model & seam** — attach to existing seams rather than reshaping schema: `sourceType/sourceId`, provider interfaces (`SmsProvider`/`EmailProvider`/`PaymentGateway`/storage), `AppSettings` flags/modules, the capability layer, ledger **reversals** (never edits/deletes), append-only `AuditLog`. New tables should be additive + nullable.
- **Money/ledger rules** if relevant — integer cents via `lib/money.ts`; balance math stays in pure `lib/accounting/*` (clock-injected, unit-tested); services only bridge Prisma ↔ pure logic; idempotency keys for anything chargeable.
- **Auth** — gate mutations/sensitive pages with `requireCapability` (API: `authorizeApiCapability`); add a new capability if needed. Portal/payer features go through the separate session lanes, scoped per tenant/payer.
- **UI** — lists via `DataTable`, add/edit via `FormDialog`; both themes; money crosses the RSC boundary as strings.
- **Hot-zone check** — if it touches money/ledger, payments, auth, portal/payer sessions, schema/migrations, or audit/billing-worker: **STOP and write the blast radius** (what breaks, who's affected, reversibility) and get a go-ahead BEFORE building (Working agreement).
- **Verification plan** — state it up front per the CLAUDE.md Verification section: the mechanical gate (`typecheck`/`test`/`lint`, `prisma:generate` after schema edits), which skills (`/code-review`, `/security-review` for any sensitive surface, `/run` or `/verify` to render user-visible behaviour), and the live DB+session recipe if it can't be checked on types alone.

## 3. Confirm, then build

Present the plan (ExitPlanMode when in plan mode), get approval, then implement in a feature branch. Migrations are hand-written additive SQL when no DB is available (`prisma generate` runs offline). After building, **run the stated verification and report results** — and if no DB/browser is available, say so and flag for a visual check rather than claiming success on types alone. Update `docs/IMPROVEMENT_BACKLOG.md` (mark the item done) and the roadmap as appropriate.
