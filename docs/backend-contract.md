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

`{ animals, enclosures, schedules, notes, equipment, weights, events, feeders, lightingPlans, lightingFixtures, lightingMeasurements }`

Mutations use the same endpoint:

- `POST /api/manage` — `{ resource, id?, data }`
- `PATCH /api/manage` — `{ resource, id, data }`
- `DELETE /api/manage` — `{ resource, id, reason? }`

Resources are `animal`, `enclosure`, `schedule`, `note`, `equipment`, `weight`,
`event`, `feeder`, `lightingPlan`, `lightingFixture`, and `lightingMeasurement`. Animals, enclosures, schedules, equipment, and lighting plans are archived
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

`GET /api/feeders/forecast` includes feedings due today as well as upcoming dates.
Each event includes `scheduleId`, allowing the dashboard to match a forecast to the
exact materialized care task. Feeding tasks returned by `GET /api/dashboard` gain a
nullable `feedingGuidance` field. It contains glanceable live guidance such as the
target weight range and allocated feeder, or a shortage/missing-weight message;
the saved care-plan `details` field remains unchanged.

`POST /api/feeders/bulk` is Owner-only and accepts
`{ preySpecies, sizeClass, weightsGrams, addedOn?, notes? }`. It creates one feeder
inventory row for every individual whole-gram weight (maximum 500 per request).

Completing an inventory-tracked feeding atomically creates the husbandry event,
links its forecast-selected feeder in `feeding_assignments`, and marks that feeder
consumed. A tracked feeding with no suitable available feeder returns HTTP 409 instead
of recording an unlinked completion. Plans marked `buyAsNeeded` remain intentionally
untracked. Undo keeps the feeder consumed so completion attribution can be corrected
without double-allocating it; explicitly returning that feeder to `available` in Manage
releases its assignment when the feeder was not actually used.

## Animal profile

`GET /api/animals/:id` returns the structured animal profile, current enclosure,
weights, dedicated notes, equipment, schedules, tasks, feeding history, enclosure
history, legacy event notes, and full auditable event history.
Active equipment assigned either directly to the animal or to its enclosure is included
with `installedOn`, `scope`, and the derived `inUseDays`. Shared enclosure/habitat IDs
are exposed so Shed and Clarity can deep-link to one another with
`?sharedHabitat=<id>`.

Active lighting plans for the animal's enclosure are returned in `lighting`. Each plan includes its fixture links, measurement history, latest UVI, and derived status (`plan-only`, `due`, `verified`, or `review`). Plan sheets are uploaded by the Owner at `POST /api/lighting/plans/:id/sheet`, viewed by signed-in household members with `GET`, and removed by the Owner with `DELETE`. Uploads accept PDF, PNG, JPEG, or WebP files up to 5 MB.

### Light My Reptile exact-setup import

`POST /api/lighting/import` is Owner-only and never contacts Light My Reptile. It validates and decodes the versioned data embedded after `#s=` in an HTTPS `lightmyreptile.com` share URL.

- Preview: `{ action: "preview", sourceUrl, enclosureId? }` returns `{ preview, warnings }`. The preview contains enclosure dimensions, mounting and mesh configuration, lighting level, fixture positions, compact source references, and the preserved canonical URL.
- Import: `{ action: "import", sourceUrl, enclosureId, planName, species?, plannedOn?, updateEnclosureDimensions?, fixtures, derived? }` creates the lighting plan, its immutable source snapshot, new equipment requested during review, and fixture links in one D1 batch. Each enabled preview fixture must have a matching `fixtureKey` resolution using either `equipmentId`, a new equipment `name` (plus optional brand/model/installedOn), or explicit `skip: true`.
- Optional `derived` fields are `simulatorVersion`, `modeledUvi`, `modeledLux`, `modeledPowerDensity`, and the existing target min/max fields. They are stored in the snapshot; target ranges also populate the lighting-plan columns. Modeled results are not written as real meter measurements.

Share versions 1–4 are supported. Binary share versions use catalog hashes, not readable product names, and do not contain the planner’s calculated result panels. The UI must therefore preserve the exact link, show a review step, and never guess a product name. `source_snapshot_json`, `import_status`, and `imported_at` are portable-backup fields. Imported equipment and fixture links retain `source_ref`. The profile’s source URL should be labeled **View or edit exact setup**, not as a generic website link.

## Sign-in throttling

`POST /api/auth/login` allows up to 10 failed household-code attempts in 10 minutes,
then returns HTTP 429 with `Retry-After` for a 15-minute cooldown. A successful login
clears the in-memory household throttle. This is intentionally process-local for the
single-container home-server deployment.

## Backups and restore

- `GET /api/export?format=json` returns schema version 12 with all portable husbandry
  tables, task rewards, payout history, missed-task state, and portable app settings
  (including the care baseline), lighting records, and base64-encoded plan-sheet attachments. Household access-code hashes are deliberately excluded.
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
- New tables/columns are applied by `db/runtime.ts` (self-migrating). Formal migrations
  through `drizzle/0011_neat_korath.sql` also include the transactional feeder-assignment
  uniqueness guards.
