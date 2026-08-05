<p align="center">
  <img src="site/shed-logo.svg" width="190" alt="Shed">
</p>

<p align="center">
  <b>Good care shows.</b><br>
  A self-hosted, shared household animal-husbandry tracker — feeding, weights, enclosure care, schedules, and long-term history.
</p>

<p align="center">
  <a href="#license"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-F2A516"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-1.0-2E9E5B">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-Docker-A8B7A1">
  <a href="https://jlyfshhh.github.io/shed/"><img alt="Website" src="https://img.shields.io/badge/website-jlyfshhh.github.io%2Fshed-E0701A"></a>
  <a href="https://ko-fi.com/jlyfshhh"><img alt="Ko-fi" src="https://img.shields.io/badge/Ko--fi-buy%20crickets-FF5E5B?logo=ko-fi&logoColor=white"></a>
</p>

---

Shed is a small, shared dashboard for households that keep animals together. One person feeds, another mists, someone logs a weight — Shed keeps a single calm care list that works across everyone's phones, credits each keeper by name, and turns completed care into history you can actually use: feeding records, weight trends in grams, and an append-only husbandry log.

> **The idea:** today's care should be visible to the whole household, and yesterday's care should never be lost.

## Quick start

**New to Shed?** The [complete getting-started guide](docs/SETUP.md) explains first login, the recommended enclosure → animal → care-plan setup order, household accounts, backups, and phone installation.

Shed runs as a Docker container on any always-on machine on your home network — an old PC, a NAS, a home server, or a Raspberry Pi.

```bash
curl -fsSL https://raw.githubusercontent.com/jlyfshhh/shed/main/get-shed.sh | bash
```

The installer clones Shed, builds it, turns on sign-in, and saves a **one-time setup token** in `shed/.env`.

1. Open `http://your-server:3000` on your phone or computer.
2. Enter the setup token and create your **Head Keeper** account.
3. Save the recovery access code it shows you (once).
4. Add your animals, enclosures, and care plans — then invite the rest of the household.

Re-run the same command any time to update Shed **without touching your database or settings**.

**Requirements:** Docker with the Compose plugin, `git`, and a machine that stays on.

For one chooser that can install Bask, Shed, or both with their combined room
dashboard, use the **[Haven installer](https://github.com/jlyfshhh/animal-room)**.

## Shed + Bask = Haven

Shed can run by itself, or alongside Bask:

| | Project | What it watches |
|---|---|---|
| ☀️ | **[Bask](https://github.com/jlyfshhh/bask)** | The environment — live temperature & humidity from Bluetooth sensors, on a wall display |
| 🐍 | **Shed** *(this repo)* | The care — feeding, weights, enclosure work, schedules, and history for terrestrial animals |
| 🌿 | **Haven** | The combined room view — enclosure status and today's remaining care in one glance |

Haven is not a third database. It is the secure, read-only room dashboard that
appears when Bask and Shed are installed together. The apps remain separate, so
either can still work independently and each keeps its own portable data.

## What's inside

- **Shared daily care list** across everyone's phones, with a one-day carryover so nothing slips.
- **Household accounts** — a Head Keeper who manages everything, and Keepers who record care from their own phones. Every completed task is credited to the person who did it, with a per-member contribution report.
- **Full record management** — add and edit animals (with morph, sex, scientific name, enclosure, source, and notes), enclosures, care plans, husbandry notes, equipment, weights, and feeder inventory, all from the app.
- **Animal profiles** — a per-animal card with weight history, care plans, equipment, notes, and full auditable event history.
- **Lighting plans** — import a Light My Reptile exact-setup link, preserve a permanent reviewed snapshot, create or match installed equipment, return to the live configuration, and track measured UVI/lux/temperature history.
- **Editable care plans** — daily, weekly, every-N-day, monthly, and one-time routines per animal.
- **Feeder tracking & forecasting** — weighed feeder inventory plus meal forecasting from growth trends.
- **Weight trends** in grams.
- **Correctable history** — fix a mistaken entry without erasing the record; corrections stay auditable.
- **Backups you control** — JSON and CSV exports, in-app restore (merge or replace), dated SQLite snapshots, and portable lighting-plan attachments.
- **Responsive** phone and desktop layouts.

## Data principles

- Records use ordinary relational tables and ISO timestamps.
- Append-only husbandry events preserve care history; corrections are retained, never silently deleted.
- JSON and CSV exports keep migration straightforward — your data is never trapped.
- Everything lives in a single self-hosted SQLite database with dated backups.
- Shed and Bask remain separate services so one app cannot take down the other.

## Managing your install

- **Update:** re-run the install command. It pulls the latest Shed and rebuilds, keeping your data and settings.
- **Backups:** `scripts/backup.sh` writes dated SQLite snapshots (with configurable retention) into `shed/backups`. You can also download a full JSON or CSV export from the app at any time.
- **Restore:** the More screen accepts a Shed JSON export — merge it into your current data, or replace everything (your household sign-in stays intact).
- **Add keepers:** as the Head Keeper, open **More → Household access** to create a keeper and share their one-time code. You can reissue or disable codes any time.

## Local development

Shed is a Next.js 16 app that runs on Cloudflare Workers with a D1-compatible SQLite database (Drizzle ORM). Node 22.13+.

```bash
npm install
npm run dev
```

The API contract the interface is built against lives in [`docs/backend-contract.md`](docs/backend-contract.md).

## ⚠️ Husbandry disclaimer

Shed records the care you decide on; it doesn't decide it for you. Feeding frequencies, schedules, and husbandry practices vary by species, age, and individual animal — verify your routine against trusted care resources. Shed is a tracking aid, not a substitute for proper research and care.

## License

MIT — see [LICENSE](LICENSE).

---

Built by **[jlyfshhh](https://github.com/jlyfshhh)**. I keep a room full of reptiles and amphibians — follow along on Instagram **[@thebioactivekeeper](https://instagram.com/thebioactivekeeper)** for the animals and bioactive builds behind these projects. 🦎 If Shed helps your household, you can [buy the animals some crickets](https://ko-fi.com/jlyfshhh).

> Built with the help of AI assistants (OpenAI Codex and Anthropic's Claude). Reviewed, tested, and deployed by a human (me).
