<p align="center">
  <img src="site/shed-logo.svg" width="190" alt="Shed">
</p>

<p align="center">
  <b>Good care shows.</b><br>
  A shared household animal-husbandry tracker — feeding, weights, enclosure care, schedules, and long-term history.
</p>

<p align="center">
  <a href="#license"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-F2A516"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-early%20development-E0701A">
  <img alt="Stack" src="https://img.shields.io/badge/Next.js%2016-Cloudflare%20Workers-A8B7A1">
  <a href="https://ko-fi.com/jlyfshhh"><img alt="Ko-fi" src="https://img.shields.io/badge/Ko--fi-buy%20crickets-FF5E5B?logo=ko-fi&logoColor=white"></a>
</p>

---

Shed is a small, shared dashboard for households that keep animals together. One person feeds, another mists, someone logs a weight — Shed keeps a single calm care list that works across everyone's phones, and turns completed care into history you can actually use: feeding records, weight trends in grams, and an append-only husbandry log.

> **The idea:** today's care should be visible to the whole household, and yesterday's care should never be lost.

## The animal-room family

Shed is one of three companion projects for keepers:

| | Project | What it watches |
|---|---|---|
| ☀️ | **[Bask](https://github.com/jlyfshhh/bask)** | The environment — live temperature & humidity from Bluetooth sensors, on a wall display |
| 🐍 | **Shed** *(this repo)* | The care — feeding, weights, enclosure work, schedules, and history for terrestrial animals |
| 💧 | **[Clarity](https://github.com/jlyfshhh/clarity)** | The water — aquarium & pond tests, maintenance, and livestock |

Mixed habitats use a stable **`shared_habitat_id`**, so a paludarium or turtle tank can appear in both Shed and Clarity without pretending terrestrial and aquatic care are the same thing.

## What the first version includes

- A shared daily care list that works across phones
- Owner and Zookeeper permission concepts
- Individual and community animal records
- Feeding, misting, enclosure care, and husbandry history
- Snake weight trends in grams
- JSON and CSV data exports
- Responsive phone and desktop layouts

## Data principles

- Records use ordinary relational tables and ISO timestamps.
- Append-only husbandry events preserve care history.
- JSON and CSV exports keep migration straightforward — your data is never trapped.
- The future Raspberry Pi edition will use SQLite and automatic dated backups.
- Shed and Clarity remain separate services so one app cannot take down the other.

## Local development

Shed is a Next.js 16 app that runs on Cloudflare Workers with a D1-compatible SQLite database (Drizzle ORM). Node 22.13+.

```bash
npm install
npm run dev
```

The planned Raspberry Pi distribution will use FastAPI and SQLite — the same self-hosted, no-cloud model as Bask — while preserving this data model and interface.

## Project status

Shed is in active development. The current interface and foundational data model are ready; editable schedules, animal profiles, miscellaneous notes, household authentication, and the Pi installer are the next major milestones.

## ⚠️ Husbandry disclaimer

Shed records the care you decide on; it doesn't decide it for you. Feeding frequencies, schedules, and husbandry practices vary by species, age, and individual animal — verify your routine against trusted care resources. Shed is a tracking aid, not a substitute for proper research and care.

## License

MIT — see [LICENSE](LICENSE).

---

Built by **[jlyfshhh](https://github.com/jlyfshhh)**. I keep a room full of reptiles and amphibians — follow along on Instagram **[@thebioactivekeeper](https://instagram.com/thebioactivekeeper)** for the animals and bioactive builds behind these projects. 🦎 If Shed helps your household, you can [buy the animals some crickets](https://ko-fi.com/jlyfshhh).

> Built with the help of AI assistants (OpenAI Codex and Anthropic's Claude). Reviewed, tested, and deployed by a human (me).
