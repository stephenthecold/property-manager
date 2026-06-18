---
name: competitive-audit
description: >-
  Compare this property-management project against enterprise/SMB products
  (AppFolio, Buildium, Yardi, DoorLoop, Propertyware, RealPage, Entrata) to find
  feature GAPS, POLISH opportunities, and COHESION improvements. Fans out
  parallel domain agents, synthesizes a deduplicated prioritized backlog grounded
  in real files, and updates docs/IMPROVEMENT_BACKLOG.md. Use when asked to
  "compare to enterprise", "what should we add/build next", "audit gaps", "do a
  competitive analysis", or to refresh the improvement backlog.
---

# Competitive audit

Produce a grounded, prioritized improvement backlog by comparing this codebase to leading property-management products. The durable output is `docs/IMPROVEMENT_BACKLOG.md`.

## 1. Fan out one read-only agent per domain

Launch `Explore` agents **in parallel** (background is fine), one per domain. Default domains:

1. Accounting, GL & owner/trust accounting
2. Payments, autopay & collections
3. Leasing lifecycle (templates, e-sign, renewals, move-in/out, deposits)
4. Tenant portal & resident experience
5. Maintenance, work orders, vendors & inspections
6. Listings, applications & screening (leasing funnel)
7. Communications, notifications & automation
8. Reporting, analytics & dashboards
9. Owner / portfolio management & multi-entity
10. Platform: RBAC/security, settings, search, navigation, mobile/UX, integrations/API

Give every agent this contract (fill in the domain + the files to look at):

> Context: `/home/user/property-manager`, a single-org rental property-management app (Next.js 16 + Prisma 7/Postgres, integer-cents ledger as source of truth). Read `CLAUDE.md`, `docs/ROADMAP.md`, `docs/PHASE5_PLAN.md`, and `docs/IMPROVEMENT_BACKLOG.md` first. Then, for **<DOMAIN>** (look at `<FILES>`), compare to AppFolio/Buildium/Yardi/DoorLoop/Propertyware/RealPage/Entrata and produce items in three buckets — **GAP** (a feature they have that we lack), **POLISH** (present but rough), **COHESION** (should tie to the rest of the app). Ground EVERY item in a real file/dir. Tag **V**alue (H/M/L) and **E**ffort (S/M/L) given our seams (`sourceType/sourceId`, provider interfaces, `AppSettings` flags, capability layer, ledger reversals). Flag anything touching a hot zone (money/ledger, payments, auth, schema/migrations). You may web-search but don't block on it. **Do not modify any files.** Output: (1) CURRENT STATE — 2-3 sentences with file refs; (2) TOP ITEMS (max 8), each one line: `[GAP|POLISH|COHESION] V:_ E:_ — Title — why + file/seam`, ordered by value-to-effort.

## 2. Synthesize — and verify, don't trust

- **Cross-check every notable claim against the repo** before recording it (agents sometimes assert a model/field exists). Drop or correct anything that doesn't check out.
- **Deduplicate** overlapping findings into a smaller set of *initiatives* (e.g. "owner statements" + "owner entity" + "distributions" → one Owner/portfolio initiative).
- **Flag hot zones** (🔥) per `CLAUDE.md` so they get the ask-first + blast-radius treatment when built.

## 3. Filter by operator context, then write the backlog

Prioritization depends on *who runs it* and *what they value* — if that isn't already captured in `docs/IMPROVEMENT_BACKLOG.md`, run **`/feature-intake`** (or a short `AskUserQuestion`) to learn: own-properties vs manage-for-owners, and parity vs cohesion vs small-operator-ROI. Then write/refresh `docs/IMPROVEMENT_BACKLOG.md` with: focus areas (chosen) and deferred initiatives (with the *reason*, so they're not re-litigated).

## 4. Hand off

Recommend a first batch and offer to turn picks into specs via **`/feature-intake`**. Per the CLAUDE.md Working agreement, this skill is research only — it must not edit code, only docs.
