/**
 * Who gets credited for an action.
 *
 * Kept apart from `household-auth` so it can be tested in plain Node: that
 * module reaches for the Workers `env` binding, which only exists inside the
 * runtime. The property worth locking down here is that attribution never
 * yields `undefined` — that value would be written straight into the history
 * columns and show up as a blank keeper on a completed task.
 */

export type AttributableMember = { id: string; displayName: string } | null;

/** Fallback name when an install runs with no household accounts at all. */
export const OPEN_INSTALL_ACTOR = "Head Keeper";

export function attributedTo(member: AttributableMember): { id: string | null; name: string } {
  return { id: member?.id ?? null, name: member?.displayName ?? OPEN_INSTALL_ACTOR };
}
