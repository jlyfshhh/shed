# Shed v1 backend contract

This contract is the handoff surface for the product UI. All write operations below
are server-authorized; hiding a control is never the authorization boundary.

## First-run and roles

- `GET /api/auth/session` returns `{ authenticated, authRequired, setupRequired, member }`.
- When `setupRequired` is true, show Head Keeper setup. Submit the display name to
  `POST /api/auth/bootstrap` with `X-Shed-Bootstrap-Token`. Show the returned recovery
  access code once and keep the returned cookie session.
- Internal `Owner` is displayed as **Head Keeper**. Internal `Zookeeper` is displayed
  as **Keeper**.
- Keepers view records and complete scheduled tasks. Only the Head Keeper may use the
  management, import/export, household, history correction, or feeder mutation APIs.

## Owner management API

`GET /api/manage` returns the complete editable catalog:

`{ animals, enclosures, schedules, notes, equipment, weights, events, feeders }`

Mutations use the same endpoint:

- `POST /api/manage` — `{ resource, id?, data }`
- `PATCH /api/manage` — `{ resource, id, data }`
- `DELETE /api/manage` — `{ resource, id, reason? }`

Resources are `animal`, `enclosure`, `schedule`, `note`, `equipment`, `weight`,
`event`, and `feeder`. Animals, enclosures, schedules, and equipment are archived
instead of erased. Events are voided and retained. Editing an event writes its previous
state to `husbandry_event_revisions`. Notes, unconsumed feeder rows, and mistaken weight
rows may be deleted.

### Schedule recurrence

Every schedule needs `animalId`, `taskType`, `title`, `frequency`, and `startDate`.
Supported frequencies:

- `daily`
- `weekly` with `weekdaysJson`, such as `[1,3,6]` (Sunday is 0)
- `interval` with `intervalDays`
- `monthly` with `dayOfMonth`
- `once`

Optional feeder forecasting fields on feeding schedules are `preySpecies`,
`preyDescription`, `preySizeClass`, `targetPercent`, `minimumPercent`,
`maximumPercent`, and `buyAsNeeded`. `preySizeClass` matches a tracked inventory
size such as `hopper` or `large pinky`; leave it blank for percentage-based sizing.
Percent values are decimals: 5% is `0.05`.

## Animal profile

`GET /api/animals/:id` returns the structured animal profile, current enclosure,
weights, dedicated notes, equipment, schedules, tasks, feeding history, enclosure
history, legacy event notes, and full auditable event history.

## Backups and restore

- `GET /api/export?format=json` returns schema version 10 with all portable husbandry
  tables, task rewards, payout history, missed-task state, and portable app settings
  (including the care baseline). Household access-code hashes are deliberately excluded.
- `GET /api/export?format=csv` provides a flat open-format copy.
- `POST /api/import` accepts `{ mode: "merge"|"replace", confirmation?, bundle }`.
  Replace mode requires `confirmation: "REPLACE"`. Restore never imports or changes
  access-code hashes. Existing household profiles are matched by id or name; restored
  Keeper profiles that do not exist yet are created disabled and require a new code
  before they can sign in.

## UI completion checklist

The Head Keeper UI needs: first-run setup; animal and enclosure editors; schedule
builder; animal profile/baseball card; add/edit notes, equipment, weight, event, and
feeder forms; archive/void confirmations; JSON backup download and restore; feeder
forecast configuration; and validation/error/success states. Keeper UI remains focused
on viewing records and completing care.

## Task earnings ("allowance") — added by Claude 2026-07-21

Optional per-keeper earnings. When a member has `earning_enabled`, completing a task
adds a reward to their (derived) balance.

- Amount: `care_schedules.reward_cents` overrides the household default in
  `app_settings.default_reward_cents` (seeded at `25`). The reward is snapshotted onto
  `husbandry_events.reward_cents` at completion, so later changes don't rewrite history.
- Balance = sum of non-voided completion `reward_cents` for the member minus their
  `reward_payouts`. Voiding a completion removes its reward automatically.
- `GET /api/auth/session` is unchanged; `GET /api/dashboard` `viewer` gains
  `earningEnabled` and `balanceCents` (null for non-earners).
- `GET /api/household/members` (Owner) gains `defaultRewardCents` and, per member,
  `earningEnabled`, `balanceCents`, `earnedCents`, `paidCents`.
- `PATCH /api/household/members/:id` (Owner) accepts `earningEnabled`.
- `GET|PATCH /api/household/rewards` (Owner) reads/sets `{ defaultRewardCents }`
  (0–100000).
- `POST /api/household/members/:id/payout` (Owner) `{ amountCents?, note? }` records a
  payout (defaults to the full balance) and clears the owed balance.
- `POST /api/tasks/complete` returns `rewardCents` and the member's `balanceCents`.
- `/api/manage` schedule resource accepts `rewardCents`.
- New tables/columns are applied by `db/runtime.ts` (self-migrating). A formal drizzle
  migration still needs `npm run db:generate` against the updated `db/schema.ts`.
