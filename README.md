# Shed

**Good care shows.** Shed is a shared household animal-husbandry tracker built for feeding, weights, enclosure care, schedules, notes, and long-term history.

Shed is designed around individual animals and terrestrial habitats. Its aquatic companion, [Clarity](https://github.com/jlyfshhh/clarity), tracks aquariums and ponds. Mixed habitats use stable shared habitat IDs so systems such as a paludarium or turtle aquarium can appear in both apps without duplicating their identity.

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
- JSON and CSV exports keep migration straightforward.
- The future Raspberry Pi edition will use SQLite and automatic dated backups.
- Shed and Clarity remain separate services so one app cannot take down the other.

## Local development

```bash
npm install
npm run dev
```

The hosted preview build uses a D1-compatible SQLite database. The planned Raspberry Pi distribution will use FastAPI and SQLite while preserving this data model and interface.

## Project status

Shed is in active development. The current interface and foundational data model are ready; editable schedules, animal profiles, miscellaneous notes, household authentication, and the Pi installer are the next major milestones.
