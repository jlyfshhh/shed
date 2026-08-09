# Shed v1 backend contract

This contract is the handoff surface for the product UI. All write operations below
are server-authorized; hiding a control is never the authorization boundary.

## First-run and roles

- `GET /api/auth/session` returns `{ authenticated, authRequired, setupRequired, capabilities, member }`.
  `GET /api/dashboard`, successful login, and first-run bootstrap expose the same
  capability names so the UI renders from the server policy rather than inferring
  permissions from a role label.
- When `setupRequired` is true, show Head Keeper setup. Submit the display name to
  `POST /api/auth/bootstrap` with `X-Shed-Bootstrap-Token`. Show the returned recovery
  access code once and keep the returned cookie session.
- Internal `Owner` is displayed as **Head Keeper**. Internal `Zookeeper` is displayed
  as **Keeper**.
- Keepers have exactly `care.read` and `care.complete`: they view records and complete
  scheduled tasks under their own identity. Misses, photos, weights, corrections,
  management, import/export, household, lighting, and feeder mutations are Head Keeper-only.
  Every protected route names a capability from `lib/capabilities.ts`; hiding a UI
  control is defense-in-depth, not the authorization boundary.

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
consumed. If no suitable feeder is in tracked stock, Shed still records the care and
returns a shortage note so real husbandry is never lost; plans marked `buyAsNeeded`
remain intentionally untracked.

Completion corrections are two distinct Head Keeper-only operations on
`/api/tasks/complete`:

- `PATCH { taskId, dueDate, targetMemberId, reason? }` changes who receives credit.
  The completion remains active, the captured reward amount transfers with that
  attribution, the consumed feeder stays consumed, and the previous event row is
  written to `husbandry_event_revisions`.
- `DELETE { taskId, dueDate, reason? }` means the care did not happen. It voids the
  completion with correcting actor/reason, removes it from allowance calculations,
  and atomically releases its feeding assignment and returns its feeder to available
  inventory.

## Animal profile

`GET /api/animals/:id` returns the structured animal profile, current enclosure,
weights, dedicated notes, equipment, schedules, tasks, feeding history, enclosure
history, legacy event notes, and full auditable event history.
Active equipment assigned either directly to the animal or to its enclosure is included
with `installedOn`, `scope`, and the derived `inUseDays`.

The `enclosures.shared_habitat_id` column still exists and is still carried by the
portable backup, but nothing reads it: it only ever fed the retired Clarity
deep-link. It is left in place so no existing export loses data — drop it in a
deliberate migration if it stays unused.

### Animal photos

One portrait per animal, stored base64 in `animal_photos` keyed by `animal_id`.

- `GET /api/animals/:id/photo` returns the image bytes with an `ETag` of the row's `updated_at` and `Cache-Control: private, max-age=31536000`; it answers `304` to a matching `If-None-Match` and `404` when there is no photo. Callers cache-bust with `?v=<photoUpdatedAt>`.
- `POST` accepts `{ dataUrl }` — a base64 `data:` URL limited to JPEG, PNG, or WebP. SVG is refused, since it would be served back under its own mime type. The client downscales to a 1200px JPEG first; the server caps the encoded payload at 2.8 MB as a backstop.
- `DELETE` removes it.

Both photo writes and `POST /api/weights` are Head Keeper-only when authentication is enabled. Keepers receive the portrait and weight history from the read APIs but are not shown write controls. A deliberately auth-off install still exposes the full management surface because it has no accounts to elevate.

`GET /api/animals/:id` and `GET /api/dashboard` expose `photoUpdatedAt` (null when unset) rather than image bytes, so the dashboard payload stays small. The rows are portable-backup data in the JSON bundle and are deliberately excluded from the CSV export.

Active lighting plans for the animal's enclosure are returned in `lighting`. Each plan includes its fixture links, measurement history, latest UVI, and derived status (`plan-only`, `due`, `verified`, or `review`). Plan sheets are uploaded by the Owner at `POST /api/lighting/plans/:id/sheet`, viewed by signed-in household members with `GET`, and removed by the Owner with `DELETE`. Uploads accept PDF, PNG, JPEG, or WebP files up to 5 MB.

### Light My Reptile exact-setup import

`POST /api/lighting/import` is Owner-only and never contacts Light My Reptile. It validates and decodes the versioned data embedded after `#s=` in an HTTPS `lightmyreptile.com` share URL.

- Preview: `{ action: "preview", sourceUrl, enclosureId? }` returns `{ preview, warnings }`. The preview contains enclosure dimensions, mounting and mesh configuration, lighting level, fixture positions, compact source references, and the preserved canonical URL.
- Import: `{ action: "import", sourceUrl, enclosureId, planName, species?, plannedOn?, updateEnclosureDimensions?, fixtures, derived? }` creates the lighting plan, its immutable source snapshot, new equipment requested during review, and fixture links in one D1 batch. Each enabled preview fixture must have a matching `fixtureKey` resolution using either `equipmentId`, a new equipment `name` (plus optional brand/model/installedOn), or explicit `skip: true`.
- Optional `derived` fields are `simulatorVersion`, `modeledUvi`, `modeledLux`, `modeledPowerDensity`, and the existing target min/max fields. They are stored in the snapshot; target ranges also populate the lighting-plan columns. Modeled results are not written as real meter measurements.

Share versions 1–4 are supported. Binary share versions carry a 3-byte catalog hash per fixture rather than a product name, and never contain the planner’s calculated result panels — UVI, lux, and W/m² are still computed at render and must be read or measured separately.

`lib/light-my-reptile-catalog.ts` resolves those hashes to product names, from a mapping the Light My Reptile developer supplied on 2026-08-06. `decodeLightMyReptileUrl` attaches the result to each fixture as `product: { name, brand, model } | null`; the brand is split off the name using a known-brand list, and a test asserts every catalogued product resolves one. The lookup is a bundled table, so decoding still makes no network call.

This is a snapshot of someone else's catalog, so treat an unresolved hash as normal — it is probably a product added since. `unnamedFixtures(snapshot)` returns the enabled fixtures still needing a name; the preview warns about exactly those, the review step stays, and the import falls back to manual entry for them. Never invent a name for an unknown hash. When the developer sends an updated list, edit that one file.

The import creates equipment using the resolved name/brand/model unless review supplies its own, so a fully catalogued link imports with no typing. Imported equipment and fixture links retain `source_ref`, and the review step re-uses existing equipment matching that reference, so re-importing the same setup links the same records instead of duplicating them. `source_snapshot_json`, `import_status`, and `imported_at` are portable-backup fields. The profile’s source URL should be labeled **View or edit exact setup**, not as a generic website link.

## Room display feed (Haven)

`GET /api/display` is the only route Bask calls, and the only one authenticated
by a shared secret rather than a household session. It requires
`X-Shed-Display-Token` matching the `SHED_DISPLAY_TOKEN` binding, compared in
constant time. Without the binding it answers `503`; with a wrong token, `401`.
Responses are `no-store` and `X-Content-Type-Options: nosniff`.

The payload is `{ date, generatedAt, summary: { total, completed, remaining,
overdue }, tasks[], overdue[] }`. **Both task arrays carry exactly six fields** —
`animalName`, `species`, `taskType`, `title`, `details`, `dueDate` — and nothing
else. That projection is the privacy boundary the README describes: no member
ids or names, no access codes, no reward or earnings data, no completion or
event identifiers, no history, and no write path of any kind.

`details` carries the same dynamic feeder guidance the household dashboard
shows, so the wall display and Shed never disagree about a feeding.

**If you add a column to either query, project it away here unless the wall
display genuinely needs it.** The feed is read by a device that is, by design,
visible to anyone standing in the room.

## Copying care routines to a new animal

`POST /api/care/copy-routines` is Head Keeper-only and creates the selected plans in
one idempotent D1 batch. When an animal is created, or from the empty state of its Care plans tab, Shed offers the
active plans kept by other animals of the same species, deduplicated on
`task_type` + lowercased `title`.

Copied: `taskType`, `title`, `details`, `frequency`, `intervalDays`,
`weekdaysJson`, `dayOfMonth`, prey fields, percentage fields, `buyAsNeeded`,
`rewardCents`. **Not** copied: `startDate` (set to today) and `endDate`.

**Feeding plans pick their source rather than taking any sibling's.** A feeding
plan encodes portion and cadence for the animal it was written for, and in a real
collection those diverge sharply — the household's light ball pythons eat every
14 days at 10% of body weight, the heavy ones monthly at 5%. Copying an arbitrary
sibling would hand a yearling an adult's schedule. So the source is the sibling
closest in **weight**, or closest in **age** when the new animal has not been
weighed, falling back to the first only when neither is known. The reason is
shown on the row.

The comparison uses the household's own recorded plans, not any assumption of
ours about the species — if you rewrite what a ball python eats, the matching
follows automatically. Non-feeding plans are the same job on any animal and take
the first match.

Portions stay percentage-based, so they track the animal's own weight from then
on. An animal with no weight recorded gets an explicit warning that portions
cannot be calculated until one is logged.

## Care baseline

`POST /api/care/start-fresh` (Owner) does two things, and the first is
destructive: it **deletes** every `care_tasks` row due before today that has no
completion event, then sets `care_start_date` to today via `setCareStartDate`.
Returns `{ saved, startDate, cleared }` where `cleared` is the row count.

Tasks with a completion event are left alone, so recorded history survives
intact — only un-acted-on backlog is removed, which is why it counts as neither
done nor missed rather than as a pile of misses. Overdue calculation and task
materialisation then clamp to the new baseline.

## Marking work missed

`POST /api/tasks/miss` is Head Keeper-only. With `{ taskId, dueDate }` it
marks one task; with `{ all: true }` it sweeps every task due before today that has no
completion event. Both set `missed_at` plus the member id and name, and both
skip tasks that already have an event, so marking missed can never overwrite
recorded care.

## Feeder reorder acknowledgement

`POST /api/feeders/order` (Owner) writes `feeder_order_placed_at` to
`app_settings`; `DELETE` clears it. `GET /api/feeders/forecast` returns
`reorderAcknowledged`, true only while the mark is set, no `feeder_inventory`
row has an `added_on` later than it, and it is under 30 days old — so the nudge
returns on its own when stock arrives or the order never does. Deliberately not
in `PORTABLE_APP_SETTING_KEYS`: it is transient state, not husbandry data.

## Contribution report

`GET /api/household/contributions` (Owner) takes `from` and `to` dates and
returns per-member completion counts plus the individual completions behind
them. It reads `husbandry_events`, so voided entries are excluded.

## Health

`GET /api/health` is unauthenticated and used by the Docker healthcheck. It
touches the database and returns `{ "status": "ok" }`, or `503` with
`{ "status": "unavailable" }`. Bask's equivalent returns `{ "ok": true,
"status": "ok" }` so both apps answer the same probe shape.

## Sign-in throttling

`POST /api/auth/login` uses bounded in-memory limits for the exact submitted code
(5 failures in 10 minutes), an optional trusted source (10 in 10 minutes), and a
loose household-wide work ceiling (120 in 10 minutes, with a one-minute block).
Blocked responses are HTTP 429 with `Retry-After` and `Cache-Control: no-store`.

Direct LAN mode does **not** trust `CF-Connecting-IP`, `X-Real-IP`, or
`X-Forwarded-For`: Fetch does not expose the TCP peer, so those values are
caller-controlled. It omits the source scope rather than grouping every phone into
one `unknown` bucket; per-code and global protection remain active. An administrator
may set `SHED_TRUSTED_PROXY_IP_HEADER` to exactly one allowlisted header only when
the Shed origin cannot be reached except through a trusted proxy that strips and
overwrites it. Valid values are `cf-connecting-ip`, `x-real-ip`, and
`x-forwarded-for`.

Throttle maps are capped at 512 source/code keys and state is intentionally
process-local. A container or Worker restart clears it. Persisting every failed
unauthenticated request would turn login into a database-write amplifier; the
24-random-byte access codes remain the primary credential defense.

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
