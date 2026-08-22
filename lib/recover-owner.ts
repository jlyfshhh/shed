import { createAccessCode, hashAccessCode } from "./access-code.ts";

export type OwnerRecord = { id: string; displayName: string };

export type RecoverOwnerStore = {
  /** The Head Keeper row, active or not. */
  findOwner(): Promise<OwnerRecord | null>;
  /** Replace the stored code hash and make sure the row can sign in. */
  reissue(id: string, accessCodeHash: string, timestamp: string): Promise<void>;
};

export type RecoverOwnerResult = { accessCode: string; owner: OwnerRecord };

/**
 * Issue a replacement Head Keeper access code.
 *
 * The code is shown once and stored only as a hash, and every other recovery
 * route in the app runs through the Head Keeper, so a keeper who lost theirs was
 * locked out of their own household with nothing but hand-editing the database
 * left. This is the way back, gated on the install's setup token by the caller.
 *
 * Returns null when there is no Head Keeper to recover, which is a different
 * situation from a failure: that household has not been set up yet.
 */
export async function reissueOwnerAccessCode(
  store: RecoverOwnerStore,
  now: () => Date = () => new Date(),
): Promise<RecoverOwnerResult | null> {
  const owner = await store.findOwner();
  if (!owner) return null;
  const accessCode = createAccessCode();
  await store.reissue(owner.id, await hashAccessCode(accessCode), now().toISOString());
  return { accessCode, owner };
}
