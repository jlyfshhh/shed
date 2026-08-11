# QC handoff — 2026-08-10

Written for the next QC sweep. Everything below is on `main` in the relevant
repo and deployed to the Pi unless it says otherwise. Where I verified
something, this says how, because two of the bugs found today were bugs in my
own verification rather than in the code.

## Read this part first

Four things here are worth more scrutiny than the rest.

**0. The privacy scan has been checking nothing.** `scripts/privacy-scan.sh`
passes when no denylist is configured, so that forks and outside pull requests
are not blocked by a secret they cannot have. Reasonable in itself — but as of
2026-08-10 **all three repositories have zero Actions secrets configured**, so
`PRIVACY_DENYLIST` was never set and the CI step had been passing while
scanning nothing. That is a false green on the single guard that exists to keep
real names out of public repositories.

The scan now raises a GitHub warning annotation when it is unconfigured, and
honours `PRIVACY_SCAN_STRICT=1` to fail instead. Strict is **not** wired into
the workflow yet, deliberately: turning it on before the secret exists would
redden every build. **The action needed is the keeper setting the
`PRIVACY_DENYLIST` secret on all three repositories, after which strict should
be switched on for pushes and same-repo pull requests.** I did not set it — it
contains exactly the strings that must not pass through anything unnecessary.

Worth confirming during the sweep that no name has actually reached a public
repo in the window where the scan was inert. The history rewrite on 2026-08-09
removed one from all 87 commits, but that was found by hand, not by this scan.

**1. The BLE scanner runs as root, deliberately.** `bask` `ffcce5d`. Splitting
the scanner off the web service (QC-12) moved it to an unprivileged uid, and
BlueZ grants `AdvertisementMonitor1` — the interface passive scanning needs —
to root only, refusing other clients at D-Bus authentication. The container
started clean and recorded nothing for about seven hours. A local D-Bus policy
for the unprivileged uid does not fix it; the rejection is at authentication.

`tests/test_container_boundary.py` previously asserted the broken arrangement,
so it could never have caught this. It now pins `user: "0:0"` and
`cap_add: DAC_OVERRIDE` for the scanner, keeps full hardening asserted for the
web service, and checks the scanner's compensating isolation
(`network_mode: none`, no ports, read-only socket mount). **If a future
hardening pass wants this back on a normal user, that test is the argument to
answer first.**

**2. My verification was the actual failure, twice.** I confirmed "15/15
enclosures fresh (<15 min)" immediately after a restart — those were
pre-restart readings still inside the window, so the check could not fail.
Later I declared a publish complete by listing recent workflow runs before the
new run existed. Both are the same shape: a condition that was already true.
Freshness is now checked by sampling twice and confirming the age actually
moves; deploys are confirmed by comparing image digests before and after.
**Worth checking whether any other health check in these repos has the same
shape.**

**3. Backup coverage was silently incomplete.** `shed` `b00e766`. The skip
columns and `husbandry_events.outcome` were added to the schema earlier the
same day but never added to the backup manifest, so every backup taken since
was discarding them — a restore would have brought the database back with
skips erased and refused meals turned into ordinary completions.
`tests/backup-covers-schema.test.ts` now reads the `CREATE TABLE` and
`addMissingColumns` statements out of `db/runtime.ts` and fails if the manifest
misses a column or claims one that does not exist. I confirmed it fails when
the bug is reintroduced, naming all five columns, rather than trusting a green
check.

## Shed

| Commit | What |
| --- | --- |
| `d4ffdcc` | Skip and refused as first-class task outcomes |
| `b00e766` | Task-card layout fix, shed logging, backup manifest fix |
| `469a44e` | Dependabot: workflow action bumps |
| `447d954` | Portrait-led profile hero |
| `f675a35` | Repeated name removed, sex symbols aligned |
| `f41a772` | Privacy scan no longer passes silently when unconfigured |
| `43d1f01` | Skipped work leaves the day's list; lights stop raising a chore |

### Skip did not actually remove the task (`43d1f01`)

Shipped on 2026-08-09, reported by the keeper on 2026-08-11. The overdue query
excluded skipped work but the today query did not, and the day view never read
the column, so a skipped task stayed on the list, stayed in "N remaining", and
stayed in the completion percentage — a day containing a skip could not reach
100%. The wall display had the same gap.

Worth noting for the sweep: this is the third time today a disposition was
handled in one query and missed in another. `skipped_at` is now honoured in the
dashboard today list, the dashboard overdue list, the display today list, the
display overdue list, and the husbandry score. **If a fourth surface appears,
it needs the same treatment, and there is no single place that enforces it.**
A shared helper for "tasks that still need doing" would be the real fix.

### Adding a light raised a chore (`43d1f01`)

Creating or editing lighting equipment queued a "Verify lighting" care task for
every resident animal of the enclosure, due that day. Recording a fixture is
bookkeeping and the keeper had to clear the task by hand. Equipment changes now
only touch the enclosure's lighting plans. **Plan changes still queue
verification** — a plan states the targets a measurement is checked against —
which is a judgement call the keeper may want revisited.

### Rue's feeding moved to Mon/Wed/Fri (live data, 2026-08-11)

Not a code change: `cgd-rue` went from `interval`/2 days to `weekly` with
`[1,3,5]`. Two things came out of it that generalise:

- The lookback window **materialised the new pattern backwards** and created a
  Monday task for the previous day, inventing a feeding that was never on the
  plan. Moving the schedule's `start_date` to the changeover date stops that.
  Any schedule reshape has the same hazard.
- The task the old rule had already generated for today was no longer a
  feeding day. It was marked skipped with a reason rather than deleted, as was
  the back-filled artefact, so the history stays honest and neither counts
  against Rue's husbandry score.

**There is no UI for changing a schedule's shape safely** — this was done in
SQL against the live database, with a backup taken first and the result checked
through `scheduleIsDue` rather than by reading the rule. Worth considering
whether the manage console should handle the start-date move itself.

### Skip and refused (`d4ffdcc`)

Skip is a third disposition, not a flavour of missed: a skipped task leaves the
husbandry-score denominator entirely, so skipping does not lower the score.
Refused logs the attempt and consumes the rat inventory but records that the
animal did not eat; the animal then waits for its next regular scheduled meal —
there is no retry-gap machinery, which was a misread on my part that got
removed before anything was built on it. `tests/dispositions.test.ts` mirrors
the score query and asserts skip does not lower the score, missed does, an
all-skipped animal scores `null`, and a refusal counts as done for scheduling.

### Shed logging (`b00e766`)

New `shed_events` table, `POST /api/sheds`, and a Log shed button on the animal
profile mirroring weight logging. Quality is the retained signal — anything
other than a clean one-piece shed is flagged, and the interval since the
previous shed appears once there are two to compare.

**Owner-only, and that was a judgement call worth reviewing.** A shed cannot be
corrected from the profile once saved, which is the same reason weights are
Owner-only, and `tests/capabilities.test.ts` pins Zookeeper to read plus
completion on purpose. I first gave Zookeepers the capability, the test caught
it, and I backed it out rather than widening who can write records as a side
effect of adding a feature. **If sheds should be Zookeeper-writable, that is a
policy decision for the keeper, and it probably wants a correction path first.**

Interval arithmetic parses dates as UTC midnight so a daylight-saving boundary
inside the interval cannot round the answer to the wrong day, and a shed cannot
be recorded for a date that has not happened yet.

### Layout and photos (`b00e766`, `447d954`, PR #4)

- The Skip/Refused buttons I added put the card's buttons inside a wrapper,
  which broke the mobile layout: it relied on `.complete-button` being a direct
  grid child so `grid-column: 1 / -1` could span it. As a flex child that
  declaration is inert. The wrapper now spans the card.
- Animal photos were not filling their frames. The frame takes its height from
  `aspect-ratio`, and the image's `height: 100%` resolved as `auto` against it,
  so `object-fit: cover` never engaged. Portrait photos overflowed and were
  cropped, which looked correct by accident; a 3:1 panoramic rendered a third
  of its proper height. Images are now inset to the frame. **The same mistake
  is easy to repeat anywhere an image sits in an `aspect-ratio` box.**
- The profile leads with the portrait at full width when one exists, and keeps
  the compact glyph layout when there is not.
- Sex symbols were glued into the label string, so nothing could style them and
  they sat off the line. `animalFacts` returns `{ label, symbol? }` and the chip
  centres the symbol in a flex line.

A note on CSS ordering, since it bit me: `.task-actions` is declared later in
`globals.css` than the mobile media query, and a media query adds no
specificity, so the later rule wins. My media-query flex rules never applied
and the layout was correct by accident. Worth a scan for the same pattern.

### Verification available to repeat

- 118/118 tests, lint clean.
- Layout and photo work rendered in headless Chromium on the Pi at 390px,
  900px and 1280px, against wide, tall, square and exact-ratio images, plus
  the no-photo fallback. No browser was available on the Mac.
- `shed_events` migration confirmed against the live database after deploy:
  table and index present, skip/outcome columns intact, row counts and
  `PRAGMA integrity_check` unchanged.
- New route confirmed live from outside the container (401, not 404), and the
  new CSS confirmed present in the served stylesheet.

## Bask

`ffcce5d` — scanner root fix, described above. Verified on the Pi with 15/15
enclosures fresh across two samples 90s apart and continuous flushes.

`7b5c71b` — concurrency, service-worker and import-schema follow-ups from the
earlier QC round.

## Known open items

- **`POST /api/weights` returns 500, not 401**, when the body is absent or
  malformed. Pre-existing; `POST /api/sheds` handles the same input correctly.
  Both call `requireCapability` before `request.json()`, so the difference is
  probably inside `lib/household-auth.ts`. An unauthenticated caller should get
  401 and malformed JSON should get 400, never 500. Worth checking every POST
  route for the same pattern.
- **QC-21** Bask alert delivery, **QC-22** network exposure and headers beyond
  session expiry, **QC-30** accessibility review — not started.
- **QC-32** host updates — deferred by the keeper, to be scheduled rather than
  applied ad hoc.
- The Pi is running an image one publish behind `latest` on Shed, because the
  most recent publish rebuilt identical application code (only workflow files
  changed). Deliberate: no functional difference, and redeploying production
  for a no-op is churn.
- `~/shed/backups` on the Pi is stale leftover from before backups moved to a
  separate mounted device. Real backups land on the mounted device via
  `animal-app-backup.timer` nightly, and today's was verified restorable
  (`integrity_check` ok, row counts matching live). **Do not read the stale
  folder as evidence that backups have stopped — it fooled me for a while.**

## Environment notes that cost me time

- iCloud Drive access was revoked mid-session and never recovered, so all of
  today's work was done in a fresh clone from GitHub. The keeper's local
  working copies are untouched and need a `git pull`.
- Local Python is 3.14 (deferred annotations); CI uses 3.12 (eager). A missing
  import can pass locally and fail CI.
- macOS ships bash 3.2; the Pi and CI use bash 5. `mapfile` is absent on 3.2,
  and a comment inside a line continuation is a syntax error on 5.
- `docker logs --since` filters on Docker's UTC timestamps while the app logs
  local time; do not read a mismatch as a dead scanner.
