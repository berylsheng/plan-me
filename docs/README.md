# Plan-Me documentation

Plan-Me is a mobile day planner. You type an event in plain English ("6 June, 6-8pm, dancing @AZ") and it lands on the calendar. It is moving from a single-device app to accounts with family sharing.

## Specs (living documents — update them in the same PR as the change)

| Doc | What it covers |
|---|---|
| [specs/architecture.md](specs/architecture.md) | Code structure, data model, data flow — current and target |
| [specs/features.md](specs/features.md) | What the app does, feature by feature, with status |
| [specs/infrastructure.md](specs/infrastructure.md) | Environments, backend, builds, release, secrets, CI |

## Design specs (point-in-time decisions)

| Date | Design |
|---|---|
| 06/10/2026 | [Accounts and family sharing](superpowers/specs/2026-10-06-accounts-family-sharing-design.md) |

## Implementation plans

| Date | Plan |
|---|---|
| 06/10/2026 | [FEAT-002 roadmap](superpowers/plans/2026-10-06-feat-002-roadmap.md) — six plans, one per phase |
| 06/10/2026 | [Plan 1: parser extraction and tests](superpowers/plans/2026-10-06-feat-002-plan-1-parser-extraction.md) |
| 06/10/2026 | [Plan 2: Supabase schema and access rules](superpowers/plans/2026-10-06-feat-002-plan-2-supabase-schema.md) |
| 07/10/2026 | [Plan 3: sign-in, sign-up and password reset](superpowers/plans/2026-10-07-feat-002-plan-3-sign-in.md) |
| 09/10/2026 | [Plan 4: events sync, offline first](superpowers/plans/2026-10-09-feat-002-plan-4-sync.md) |
| 12/10/2026 | [Plan 5: family screens and sharing](superpowers/plans/2026-10-12-feat-002-plan-5-family.md) |
| 12/10/2026 | [Plan 6: settings, photos and account deletion](superpowers/plans/2026-10-12-feat-002-plan-6-settings.md) |

## Guides

- [App Store release — step by step](guides/app-store-release.md)
- [Hosted Supabase dev project — your steps](guides/supabase-hosted-setup.md)

## Registry

- [Registry index](registry/INDEX.md) — every feature, bug, and change, with status
- [How to use the registry](registry/README.md)
- [CHANGELOG](../CHANGELOG.md) — what shipped in each release

## Conventions

- Dates: dd/mm/yyyy. Timezone: NZ (Pacific/Auckland). Units: metric.
- Every PR that changes behaviour references a registry ID (e.g. `FEAT-002`) in its title or description.
