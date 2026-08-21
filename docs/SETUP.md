# Getting started with Shed

This guide takes a brand-new Shed install from an empty dashboard to a working household care list. Shed records the husbandry routine you choose; it does not prescribe care requirements.

## 1. Install Shed

You need an always-on computer on your home network with Docker and the Docker Compose plugin — a Raspberry Pi 4 or 5, an old laptop, a NAS, or a home server. **Shed needs about 1 GB of memory.** A Pi Zero or Pi Zero 2 W is not enough; those are good [Bask](https://animalroom.app/bask/) boards.

```bash
curl -fsSL https://animalroom.app/shed/install.sh | bash
```

Nothing is compiled on your machine — the installer downloads a ready-made container, creates a `shed` folder, and stores settings in `shed/.env`. Do not publish or share that file: it contains the one-time setup token and authentication secrets.

The installer also makes internal database and backup directories private to
the configured non-root uid/gid. If an older Shed container created root-owned
database files, the installer takes and verifies a backup, stops the old writer,
then repairs ownership. A dedicated path outside the install requires
`SHED_ALLOW_EXTERNAL_PATHS=true`; the installer verifies it but deliberately
does not recursively change an external tree. (The data mount must already
belong to the configured Shed uid; the host-side backup job may run as root.)
Shed itself runs without Linux
capabilities and with a read-only application filesystem.

When it finishes it prints the address to open, like `http://192.168.1.50:3000`. Use that numeric address from your phone or another computer — it always works on your network. The friendlier `http://yourpi.local:3000` also works *if* your device supports `.local` names, which Windows and some Android phones do not. If you are sitting at the machine you installed on, `http://localhost:3000` works too.

## 2. Create the Head Keeper

Enter the setup token, choose the Head Keeper's display name, and save the recovery access code Shed shows you. The code is shown only once.

`.env` is a hidden file, so a file manager will not list it unless you ask it to show hidden files. Print the token with:

```
grep SHED_BOOTSTRAP_TOKEN ~/shed/.env
```

The **Head Keeper** can add and change data, manage care plans, create household accounts, correct history, and export backups. A **Keeper** can view the care list and animals and mark tasks complete under their own name.

## 3. Build your first care list

Open **More → Getting started** at any time. The in-app checklist tracks these milestones automatically.

### Add an enclosure

Open **Manage records → Enclosures → New enclosure**. Give the physical habitat a recognizable name, then add any useful dimensions, manufacturer, location, substrate, and notes.

An enclosure is optional, so you can add an animal first and connect it later.

### Add an animal or community habitat

Open **Manage records → Animals → New animal**. A name and common species are the only essentials. Attach the enclosure if you already created it.

Use one record per individually tracked animal. For inhabitants that receive care as a group, make a community record such as `Tree frog habitat` or `Isopod colony`. You can add birth or acquisition dates, morph, sex, source, and reference notes later.

If the enclosure doesn't exist yet, choose **＋ Add a new enclosure…** in the Enclosure dropdown. It opens a form on top of the one you're filling in, and when you save it the new enclosure is selected for you — everything you had already typed is still there.

### Copy care routines from an animal you already keep

After saving a new animal, Shed offers the routines your other animals of the same species already have — feeding, misting, water changes, whatever you keep. Tick the ones that apply and they're created starting today. Untick anything that doesn't.

**Feeding plans are matched to the new animal, not copied blindly.** Shed picks the plan from whichever animal of that species is closest in weight — or closest in age, if you haven't weighed the new one yet — because portion size and feeding interval depend on the animal. A yearling gets the yearling schedule, not an adult's. The row tells you which animal it matched and why.

Portions are a percentage of body weight, so they follow the animal's own weight from then on. If you haven't recorded a weight, Shed says so and the portions can't be calculated until you log one from the animal's profile.

Already added an animal without routines? Open it, tap **Edit → Care plans**, and use **Copy routines from another…**.

### Add a photo

As the Head Keeper, open the animal from the **Animals** tab and tap **＋ Add photo** under its portrait. Take it on your phone and pick it straight from your camera roll. Keepers can see the portrait but cannot add, replace, or remove it.

Shed shrinks the picture in your browser before it's uploaded, so a multi-megabyte phone photo is stored as a few tens of kilobytes. Photos live in your own database and travel with your JSON backup.

Until an animal has a photo, its card shows a glyph for its kind. The details beneath — sex, latest weight, age, and which enclosure or room it lives in — appear only when you've recorded them, so a card never pads itself out with blanks.

### Manage one animal's records

Open an animal from the **Animals** tab and tap **Edit**. That gives you everything recorded for that one animal, on tabs: its details, enclosure, care plans, lighting, notes, equipment, weights, and history.

The **Details** tab is the edit form itself, so there's nothing to open first. On any other tab, adding a record arrives with the animal already filled in. Closing the manager puts you back on the animal's profile.

Tabs only appear when they can hold something — feeders are household-wide, and lighting fixtures and measurements only show once the animal's enclosure has a lighting plan. For everything at once, across every animal, use **More → Manage records**.

### Add a care plan

Open **Manage records → Care plans → New care plan**. Pick an animal, use a short task title such as `Mist enclosure`, and choose when it repeats:

- **Daily** — every day.
- **Weekly** — one or more selected weekdays.
- **Interval** — every N days from the start date.
- **Monthly** — a particular day of the month.
- **Once** — one dated reminder.

Active care plans generate the tasks on **Today**. If Today is empty on a new install, the usual reason is that no active care plan is due yet. Check the care plan's start date, frequency, selected days, and active status.

### Complete the first task

On **Today**, choose **Mark done**. Shed records who completed it and keeps the completion in the animal's history. If a task was marked accidentally, the Head Keeper can use **Undo**; Shed retains the correction in its audit history rather than silently erasing it.

### When care did not need doing, or an animal would not eat

Not every scheduled task needs doing, and marking one **missed** says something
different from what you mean. Missed means the care should have happened and did
not — it counts against that animal's husbandry score. Use **Skip** instead when
you looked and decided it was not needed: the enclosure is already damp, or a
new arrival is being left alone to settle in. A skipped task leaves the list,
keeps a note of your reason, and does **not** count against the score. You can
un-skip it if you change your mind.

Feedings have a third option. **Refused** records that you offered the meal and
the animal did not take it. The care counts as done — you thawed it, offered it,
and the feeder is gone either way, so it comes out of your feeder stock exactly
as a taken meal would. The refusal is kept in that animal's history, which is
what matters months later when you are trying to remember whether a snake went
off food before a shed or before a vet visit. The next meal stays on its normal
date.

### See the whole week

Today shows today. To see the week around it, choose **See the week** at the top of Today.

It lays out Sunday to Saturday: what is still outstanding, what was completed and by whom, and anything marked missed. Use **←** and **→** to look back at what has been done or ahead at what is coming — handy before a weekend away, or when ordering feeders. On a phone each day shows its totals and opens when you tap it.

This screen is for looking, not doing. Record care back on Today.

## 4. Know where information belongs

| Record | Use it for |
|---|---|
| **Care plan** | Expected, repeating work that should appear on Today |
| **History** | One-time care or observations that already happened |
| **Note** | Persistent reference information, husbandry notes, behavior, or acquisition details |
| **Equipment** | Heating, UVB, lighting, filters, and replacement dates |
| **Lighting plan** | A simulated enclosure lighting layout, its targets, linked installed lamps, plan sheet, and real meter readings |
| **Weight** | Dated measurements in grams for trend tracking |
| **Feeder** | Prey inventory, individual feeder weights, and forecasting |

Click an animal on **Animals** to see its profile, including care plans, equipment, notes, weights, and husbandry history.

### Add a Light My Reptile plan

1. In Shed, open **Manage → Lighting plans → + Import lighting setup**. If you have not built the setup yet, the sheet opens Light My Reptile in a new tab and walks you through it.
2. At [Light My Reptile](https://lightmyreptile.com/), match the enclosure and lamps, tap **FINISH**, choose **Link to this exact setup**, and copy the link. Back in Shed, paste it, choose the enclosure, and preview it.
3. Check the fixtures. Shed names each lamp from Light My Reptile's own product list, so the brand and model are already filled in — you only need to add an installation date if you want one. If Shed doesn't recognise a lamp it says so at the top of the review, and you can type that one in. Re-importing the same setup re-uses the equipment records it made the first time rather than duplicating them.
4. Optionally copy the modeled UVI, lux, power-density result, target ranges, and simulator version shown by Light My Reptile. These calculated results are not embedded in the share link itself.
5. Import the reviewed setup. Shed stores a permanent configuration snapshot and the original link. The animal profile’s **View or edit exact setup** button returns to that precise configuration later.
6. Record real UVI, lux, surface-temperature, or power-density readings under **Lighting measurements**. Shed shows whether the latest UVI is verified, outside the target, or needs remeasurement.

The imported snapshot stays unchanged even if Light My Reptile’s catalog or calculations are updated later. Opening the original link shows the current live planner, while Shed retains what was reviewed at import time.

Importing a share link is the only way to create a lighting plan, so every plan traces back to a specific reviewed configuration. Once a plan exists you can edit its details, attach a plan sheet, and record measurements against it.

Changing a lighting plan, its linked fixtures, or lighting equipment adds a **Verify lighting** task for the enclosure’s residents. Recording a measurement completes that verification task. Simulated values are planning guidance; confirm important targets with appropriate meters in the completed enclosure.

## 5. Add household keepers

As the Head Keeper, open **More → Household access**, enter a keeper's name, and save the one-time access code. Share each code privately with only that person.

On their phone, the keeper opens Shed, signs in with their code, and can add it to the home screen:

- **iPhone/iPad:** open Shed in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open Shed in Chrome, open the browser menu, then choose **Install app** or **Add to Home screen**.

A plain LAN HTTP address remains fully usable for care, but installed-app and
secure-context behavior differs by browser. See [Browser security and phone
installation](BROWSER-SECURITY.md) for the exact HTTP/HTTPS limitations.

Every completed scheduled task is credited to the signed-in keeper. Keeper accounts are deliberately completion-only: they can view Shed and mark scheduled care done, but they cannot mark tasks missed, change photos or weights, correct history, or manage any records. The Head Keeper can review totals under **More → Contributions**, issue a new code, disable an account, or re-enable it later.

## 6. Back up and restore

Your live data is stored in SQLite on your own server. For an easy portable copy, use **More → Your data, always portable** to download JSON or CSV.

- **JSON** is the complete Shed backup and can be restored in the app, including attached lighting plan sheets.
- **CSV** is convenient for spreadsheets and migration.
- **Merge restore** adds or updates records while keeping current data.
- **Replace restore** replaces husbandry data with the backup while preserving household sign-in.

Access codes are never written into an export. On a new server, Shed matches existing household profiles by identity or display name. Any additional restored Keepers are disabled until the Head Keeper issues them a new private code and enables access. Their historical task credit, earnings, and payouts remain attached to their restored profile.

The included `scripts/backup.sh` also creates dated SQLite snapshots. Keep at least one backup on a different device.

## 7. Update Shed

Run the same installer command again:

```bash
curl -fsSL https://animalroom.app/shed/install.sh | bash
```

It downloads and validates the candidate configuration while the old service is
still running, takes a verified SQLite backup, and only then starts the update.
If the new service does not become healthy, the installer restores the exact
previous settings, image, and running state. It never removes the data mount.
The verified backup uses the host's `sqlite3` command; on Raspberry Pi OS or
Debian, install it with `sudo apt-get install -y sqlite3`. If it is absent or the
backup cannot be verified, the update stops before interrupting Shed.

Do not substitute `docker compose pull && docker compose up -d` for an upgrade.
That skips backup, rollback, and migrations such as the older root-to-non-root
storage transition. After changing `SHED_UID`, `SHED_GID`, or a storage path,
always re-run the installer so the same safety checks apply.

## Quick troubleshooting

- **Today has no tasks:** add an active care plan and confirm its date/frequency makes it due today.
- **I cannot edit records:** only the Head Keeper can open the manager; confirm you used the Head Keeper access code.
- **A keeper lost their code:** the Head Keeper can issue a new one under Household access. The old code stops working.
- **The Head Keeper lost their code:** nobody else can reissue it, so it has to be reset against the database directly. Shed must be stopped first, and the command below only touches the Head Keeper's row.

  ```bash
  sudo apt-get install -y sqlite3     # if you do not already have it
  cd ~/shed && docker compose stop
  db="$(sudo find data/v3/d1/miniflare-D1DatabaseObject -maxdepth 1 -regextype posix-extended -regex '.*/[0-9a-f]{64}\.sqlite')"
  sudo cp "$db" "$db.before-code-reset"
  code="shed_$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')"
  sudo sqlite3 "$db" "UPDATE household_members SET access_code_hash='$(printf '%s' "$code" | sha256sum | cut -d' ' -f1)', updated_at=datetime('now') WHERE role='Owner';"
  docker compose start && echo "New Head Keeper access code: $code"
  ```

  Save the code it prints — Shed will not show it again. Keeper codes are untouched.
- **Another phone cannot connect:** use the server's numeric LAN address (like `http://192.168.1.50:3000`), not `localhost`. If you were given a `.local` address and it will not load, your phone probably does not support `.local` names — use the numbers instead.
- **The address will not load at all, right after installing:** most often the machine ran out of memory while Shed was starting. Shed needs roughly 400 MB free just to start. The diagnostic below reports this directly.
- **Anything else, or you are not sure:** run the diagnostic and send whoever is helping what it prints. It reads your system only, changes nothing, and deliberately contains no records, passwords, or access codes.

  ```bash
  curl -fsSL https://animalroom.app/doctor.sh | bash
  ```
- **I need to move servers:** export JSON (and preferably copy the SQLite backup), install Shed on the new server, then restore the JSON file.

Advanced reverse-proxy note: keep `SHED_TRUSTED_PROXY_IP_HEADER` blank for a
normal LAN install. Set it only when clients cannot reach Shed except through a
proxy that removes and rewrites that exact IP header; otherwise a client can forge
the value. This option only improves per-source sign-in throttling and is not
required for household authentication.

For technical details, see the [backend contract](backend-contract.md) and the main [README](../README.md).
