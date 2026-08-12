# Shed on the App Store — planning notes

Started 2026-08-11. This is a decision document, not a roadmap yet. The
roadmap depends on one choice, and everything else follows from it.

## The choice that decides everything

Shed today is a self-hosted web app. One household runs one instance on one
Raspberry Pi, and the data never leaves the house. "Put it on the App Store"
can mean three quite different products, and they are not variations on a
theme — they are different amounts of work, different running costs, and
different obligations to strangers.

### A. A client for people who already self-host

The app talks to a Shed instance the user runs. First launch asks for a server
address and an access code.

- **Effort:** smallest. Native UI over the existing API.
- **Running cost:** none beyond the developer programme.
- **Who it serves:** people who already have a Pi. Roughly the audience the
  project has now.
- **The risk that matters:** App Review guideline 4.2 rejects apps with
  minimal functionality, and an app that shows nothing at all without a server
  the reviewer does not have is a plausible rejection. It can be mitigated with
  a demo mode, but it is the central risk, not a footnote.

### B. Local-first, with optional sync to a Shed instance

The app keeps its own database on the phone and is fully useful with no server
at all. A household that runs Shed can point the app at it and sync; everyone
else just uses the app.

- **Effort:** largest of the three on day one, because sync has to be designed
  rather than bolted on — two devices editing the same care record need a
  conflict rule, and "last write wins" quietly loses data.
- **Running cost:** still none. Sync is device-to-server, not through us.
- **Who it serves:** anyone who keeps animals. The Pi becomes an optional
  upgrade rather than a prerequisite.
- **Why it is the strongest position:** it answers 4.2 outright — the app does
  real work on its own — and it does not put us in the business of holding
  other people's data.

### C. Hosted service

We run the servers; users sign up.

- **Effort:** large, and most of it is not the app. Multi-tenancy, data
  isolation, billing, support, and an on-call expectation when someone's
  feeding reminders stop.
- **Running cost:** ongoing and growing with users.
- **Obligations:** we would hold records about other people's animals and,
  through account details, about them. That is a different privacy posture from
  a Pi in a spare room, and it is a commitment that does not pause.
- **Honest view:** this is a business, not a project. Worth doing only if that
  is what is wanted.

**Recommendation: B**, with A as a stepping stone if we want something in the
store sooner. C should be a deliberate decision taken later, if ever, and not
something we drift into.

## What survives the move

Measured, not estimated:

- **24 of 37 `lib/` modules are portable** — plain TypeScript with no D1, no
  `Request`/`Response`, no Next. That includes the parts that took the longest
  to get right: scheduling and materialisation, feeding forecasts and feeder
  matching, task dispositions, husbandry scoring inputs, shed quality, lighting
  plans and the Light My Reptile catalogue, the week view, and backup/restore
  planning. A React Native app can import these as they are.
- **13 modules are runtime-bound** — auth, sessions, throttling, the D1
  helpers. These are reimplemented against whatever the app uses locally.
- **All 3,786 lines of `app/*.tsx` are rewritten.** Web React does not port,
  and the mobile layouts we have been fixing are CSS that has no equivalent.

So the domain model moves and the shell does not. That is a better position
than it sounds: the shell is the part we can rebuild quickly, and the domain
model is the part that carries three months of decisions about what a shed,
a refusal and a skip actually mean.

## Technology, if B is chosen

**React Native (Expo)** is the obvious fit, for one specific reason rather
than general popularity: it runs the existing TypeScript domain modules
unchanged. A Swift app would mean translating all 24 of them, and every
translation is a chance to reintroduce a bug we have already fixed — the
daylight-saving handling in shed intervals, the calendar-month age arithmetic,
the schedule start-date trap.

Local storage would be SQLite on the device, which keeps the schema and most
queries recognisable.

## What the store requires, beyond code

These are obligations, not tasks to be squeezed in at the end:

- **Apple Developer Program**, $99/year, and it must be renewed or the app is
  pulled.
- **A privacy policy** at a public URL, plus App Privacy disclosures naming
  every category of data collected. Local-first makes this genuinely short,
  which is a real advantage of B.
- **In-app account deletion** if accounts exist at all (5.1.1(v)). Local-first
  mostly sidesteps this; a hosted service does not.
- **A working demo account** for App Review. Reviewers will not set up a Pi.
  For B this is just the app; for A we would have to run a demo instance and
  keep it alive.
- **Anything resembling health guidance is scrutinised.** Feeding schedules for
  animals are not medical advice, but wording that reads as veterinary
  instruction invites questions. Worth a careful pass over the copy.
- **Review takes days and rejections are normal.** Plan for two or three
  rounds rather than treating the first submission as the launch.

## Open questions for the keeper

1. Who is this for — the household and a handful of enthusiasts, or the
   general reptile-keeping public? This decides A versus B.
2. Is holding other people's data ever acceptable, or is self-hosted the point?
   This rules C in or out permanently.
3. Free, paid once, or subscription? A paid app changes the support
   expectation considerably.
4. Is Android in scope? Expo makes it nearly free at build time and roughly
   doubles the testing and support surface.

## A smaller first step worth considering

Before any of this, the current web app can be a much better installed app:
a proper web manifest, offline shell, and — the one that matters — **push
notifications for care that is due and for sensors that have gone quiet**. The
seven-hour Bask outage on 2026-08-10 went unnoticed because nothing was
watching. That single feature is worth more day to day than being in the store,
and it is days of work rather than months.

It is also not wasted if we go native later: the notification and alerting
design carries over directly.
