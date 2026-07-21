# Getting started with Shed

This guide takes a brand-new Shed install from an empty dashboard to a working household care list. Shed records the husbandry routine you choose; it does not prescribe care requirements.

## 1. Install Shed

On an always-on computer with Docker, the Docker Compose plugin, and Git installed, run:

```bash
curl -fsSL https://raw.githubusercontent.com/jlyfshhh/shed/main/get-shed.sh | bash
```

The installer creates a `shed` folder, builds the app, and stores its settings in `shed/.env`. Do not publish or share that file: it contains the one-time setup token and authentication secrets.

Open `http://your-server-address:3000`. If you installed Shed on the computer you are using, `http://localhost:3000` also works.

## 2. Create the Head Keeper

Enter the setup token from `shed/.env`, choose the Head Keeper's display name, and save the recovery access code Shed shows you. The code is shown only once.

The **Head Keeper** can add and change data, manage care plans, create household accounts, correct history, and export backups. A **Keeper** can view the care list and animals and mark tasks complete under their own name.

## 3. Build your first care list

Open **More → Getting started** at any time. The in-app checklist tracks these milestones automatically.

### Add an enclosure

Open **Manage records → Enclosures → New enclosure**. Give the physical habitat a recognizable name, then add any useful dimensions, manufacturer, location, substrate, and notes.

An enclosure is optional, so you can add an animal first and connect it later. Mixed terrestrial/aquatic habitats can use a shared habitat ID to link the same physical setup with Clarity.

### Add an animal or community habitat

Open **Manage records → Animals → New animal**. A name and common species are the only essentials. Attach the enclosure if you already created it.

Use one record per individually tracked animal. For inhabitants that receive care as a group, make a community record such as `Tree frog habitat` or `Isopod colony`. You can add birth or acquisition dates, morph, sex, source, and reference notes later.

### Add a care plan

Open **Manage records → Care plans → New care plan**. Pick an animal, use a short task title such as `Mist enclosure`, and choose when it repeats:

- **Daily** — every day.
- **Weekly** — one or more selected weekdays.
- **Interval** — every N days from the start date.
- **Monthly** — a particular day of the month.
- **Once** — one dated reminder.

Active care plans generate the tasks on **Today**. If Today is empty on a new install, the usual reason is that no active care plan is due yet. Check the care plan's start date, frequency, selected days, and active status.

### Complete the first task

On **Today**, choose **Mark done**. Shed records who completed it and keeps the completion in the animal's history. If a task was marked accidentally, correct the entry from History; Shed retains an audit trail rather than silently erasing it.

## 4. Know where information belongs

| Record | Use it for |
|---|---|
| **Care plan** | Expected, repeating work that should appear on Today |
| **History** | One-time care or observations that already happened |
| **Note** | Persistent reference information, husbandry notes, behavior, or acquisition details |
| **Equipment** | Heating, UVB, lighting, filters, and replacement dates |
| **Weight** | Dated measurements in grams for trend tracking |
| **Feeder** | Prey inventory, individual feeder weights, and forecasting |

Click an animal on **Animals** to see its profile, including care plans, equipment, notes, weights, and husbandry history.

## 5. Add household keepers

As the Head Keeper, open **More → Household access**, enter a keeper's name, and save the one-time access code. Share each code privately with only that person.

On their phone, the keeper opens Shed, signs in with their code, and can add it to the home screen:

- **iPhone/iPad:** open Shed in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open Shed in Chrome, open the browser menu, then choose **Install app** or **Add to Home screen**.

Every completed scheduled task is credited to the signed-in keeper. The Head Keeper can review totals under **More → Contributions**, issue a new code, disable an account, or re-enable it later.

## 6. Back up and restore

Your live data is stored in SQLite on your own server. For an easy portable copy, use **More → Your data, always portable** to download JSON or CSV.

- **JSON** is the complete Shed backup and can be restored in the app.
- **CSV** is convenient for spreadsheets and migration.
- **Merge restore** adds or updates records while keeping current data.
- **Replace restore** replaces husbandry data with the backup while preserving household sign-in.

The included `scripts/backup.sh` also creates dated SQLite snapshots. Keep at least one backup on a different device.

## 7. Update Shed

Run the same installer command again. It pulls the current version and rebuilds the container without replacing the database or `.env` settings.

## Quick troubleshooting

- **Today has no tasks:** add an active care plan and confirm its date/frequency makes it due today.
- **I cannot edit records:** only the Head Keeper can open the manager; confirm you used the Head Keeper access code.
- **A keeper lost their code:** the Head Keeper can issue a new one under Household access. The old code stops working.
- **Another phone cannot connect:** use the server's LAN address, not `localhost`, and make sure port 3000 is reachable on the local network.
- **I need to move servers:** export JSON (and preferably copy the SQLite backup), install Shed on the new server, then restore the JSON file.

For technical details, see the [backend contract](backend-contract.md) and the main [README](../README.md).
