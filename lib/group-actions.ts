// The message a grouped Done/Skip/Missed shows after applying to every animal on
// a line. Pulled out of the component so the partial-failure wording — the whole
// point of collecting results instead of letting a later success toast paint
// over an earlier member's failure — can be tested without a browser.

export type MemberResult =
  | { ok: true; note: string; slow?: boolean }
  | { ok: false; error: string };

export type MemberOutcome = { animalName: string; result: MemberResult };

export function groupToast(
  outcomes: readonly MemberOutcome[],
  opts: { title: string; verb: string; viewerName?: string | null; feederAware?: boolean },
): { message: string; ms: number } {
  const failures = outcomes.filter((entry) => !entry.result.ok);
  if (failures.length === 0) {
    if (outcomes.length === 1 && outcomes[0].result.ok) {
      return { message: outcomes[0].result.note, ms: outcomes[0].result.slow ? 5200 : 2800 };
    }
    const by = opts.viewerName ? ` by ${opts.viewerName}` : "";
    return { message: `${opts.title}: ${opts.verb} for all ${outcomes.length} animals${by}`, ms: opts.feederAware ? 5200 : 2800 };
  }
  const names = failures.map((entry) => entry.animalName).join(", ");
  const saved = outcomes.length - failures.length;
  // Non-null: the filter guarantees these are the failing branch.
  const detail = failures[0].result.ok ? "" : failures[0].result.error;
  const message = saved > 0
    ? `Saved ${saved} of ${outcomes.length} — couldn’t save ${names}: ${detail}`
    : `Couldn’t save ${names}: ${detail}`;
  return { message, ms: 6000 };
}
