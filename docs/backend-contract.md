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
`preyDescription`, `targetPercent`, `minimumPercent`, `maximumPercent`, and
`buyAsNeeded`. Percent values are decimals: 5% is `0.05`.

## Animal profile

`GET /api/animals/:id` returns the structured animal profile, current enclosure,
weights, dedicated notes, equipment, schedules, tasks, feeding history, enclosure
history, legacy event notes, and full auditable event history.

## Backups and restore

- `GET /api/export?format=json` returns schema version 8 with all portable husbandry
  tables. Household access-code hashes are deliberately excluded.
- `GET /api/export?format=csv` provides a flat open-format copy.
- `POST /api/import` accepts `{ mode: "merge"|"replace", confirmation?, bundle }`.
  Replace mode requires `confirmation: "REPLACE"`. Restore never changes household
  credentials.

## UI completion checklist

The Head Keeper UI needs: first-run setup; animal and enclosure editors; schedule
builder; animal profile/baseball card; add/edit notes, equipment, weight, event, and
feeder forms; archive/void confirmations; JSON backup download and restore; feeder
forecast configuration; and validation/error/success states. Keeper UI remains focused
on viewing records and completing care.
