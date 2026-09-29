// The message a grouped Done/Skip/Missed shows after applying to every animal on
// a line. Pulled out of the component so the wording — partial failure, and the
// feeder consumption/shortage detail that would otherwise be lost when several
// animals feed on one line — can be tested without a browser.

export type FeederUse = { sizeClass: string; preySpecies: string };

export type MemberResult =
  | { ok: true; note: string; slow?: boolean; feeder?: FeederUse | null; shortage?: boolean }
  | { ok: false; error: string };

export type MemberOutcome = { animalName: string; result: MemberResult };

/** "2× small rat, 1× medium mouse" from the feeders each member consumed. */
function summariseFeeders(outcomes: readonly MemberOutcome[]): string {
  const counts = new Map<string, number>();
  for (const { result } of outcomes) {
    if (result.ok && result.feeder) {
      const key = `${result.feeder.sizeClass} ${result.feeder.preySpecies}`.trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].map(([kind, n]) => `${n}× ${kind}`).join(", ");
}

export function groupToast(
  outcomes: readonly MemberOutcome[],
  opts: { title: string; verb: string; viewerName?: string | null; feederAware?: boolean },
): { message: string; ms: number } {
  const failures = outcomes.filter((entry) => !entry.result.ok);
  if (failures.length > 0) {
    const names = failures.map((entry) => entry.animalName).join(", ");
    const saved = outcomes.length - failures.length;
    // Non-null: the filter guarantees these are the failing branch.
    const detail = failures[0].result.ok ? "" : failures[0].result.error;
    const message = saved > 0
      ? `Saved ${saved} of ${outcomes.length} — couldn’t save ${names}: ${detail}`
      : `Couldn’t save ${names}: ${detail}`;
    return { message, ms: 6000 };
  }

  // One animal: its own note already carries feeder/shortage detail.
  if (outcomes.length === 1 && outcomes[0].result.ok) {
    return { message: outcomes[0].result.note, ms: outcomes[0].result.slow ? 5200 : 2800 };
  }

  // A whole group succeeded. For feeding, the per-animal notes are the only
  // place the feeders consumed and the "no feeder deducted" shortages were
  // recorded, so fold them into the summary with the animals that were short —
  // dropping them would hide inventory movement and a reconciliation warning.
  const by = opts.viewerName ? ` by ${opts.viewerName}` : "";
  let message = `${opts.title}: ${opts.verb} for all ${outcomes.length} animals${by}`;
  let slow = false;
  if (opts.feederAware) {
    const feeders = summariseFeeders(outcomes);
    if (feeders) message += ` · ${feeders} used`;
    const short = outcomes.filter((entry) => entry.result.ok && entry.result.shortage).map((entry) => entry.animalName);
    if (short.length) {
      message += ` · no feeder deducted for ${short.join(", ")} — add it in Manage → Feeders if you used stock`;
      slow = true;
    }
  }
  return { message, ms: slow || opts.feederAware ? 5200 : 2800 };
}
