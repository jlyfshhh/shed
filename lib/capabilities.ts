/**
 * What each household role is allowed to do.
 *
 * One table, so a route cannot quietly disagree with the policy. The policy is
 * the keeper's: the Head Keeper owns the animals, the plans, the history and who
 * else gets in; a Keeper views the collection and records the care they actually
 * did, under their own name. Recording care is not the same as changing the
 * record of it — a Keeper can mark a scheduled task done, and nothing else
 * writes. Misses, corrections, weights, photos and every management action stay
 * with the Head Keeper.
 *
 * Kept apart from `household-auth` so it can be tested in plain Node: that
 * module reaches for the Workers `env` binding, which only exists at runtime.
 */

export type HouseholdRole = "Owner" | "Zookeeper";

export type Capability =
  /** See the collection, today's list, the week, feeders and animal profiles. */
  | "care.read"
  /** Mark a scheduled task done, attributed to yourself. */
  | "care.complete"
  /** Mark one task as not done. Reversible; completing it later clears it. */
  | "care.miss"
  /** Sweep every open overdue task to missed in one call. */
  | "care.missAll"
  /** Void a completion — an edit to history. */
  | "care.correct"
  /** Move the care baseline to today and drop the un-acted-on backlog. */
  | "care.startFresh"
  /** Animals, enclosures, plans, notes, equipment, history: the manage console. */
  | "records.manage"
  /** Download the whole database. */
  | "records.export"
  | "animal.photo.write"
  | "weights.record"
  /** Log a shed when someone notices one. Owner-only for the same reason as
      weights: there is no keeper-facing way to correct a shed once saved. */
  | "sheds.record"
  | "feeders.manage"
  | "lighting.manage"
  /** Members, invitations, allowance rates and payouts. */
  | "household.manage";

const CAPABILITY_ROLES: Record<Capability, readonly HouseholdRole[]> = {
  "care.read": ["Owner", "Zookeeper"],
  "care.complete": ["Owner", "Zookeeper"],
  "care.miss": ["Owner"],
  "care.missAll": ["Owner"],
  "care.correct": ["Owner"],
  "care.startFresh": ["Owner"],
  "records.manage": ["Owner"],
  "records.export": ["Owner"],
  "animal.photo.write": ["Owner"],
  "weights.record": ["Owner"],
  "sheds.record": ["Owner"],
  "feeders.manage": ["Owner"],
  "lighting.manage": ["Owner"],
  "household.manage": ["Owner"],
};

/** Stable complete list for auth-off installs and API/UI policy handoff. */
export const ALL_CAPABILITIES: readonly Capability[] = Object.freeze(
  Object.keys(CAPABILITY_ROLES) as Capability[],
);

export type AuthorizationDenial = {
  status: 401 | 403;
  error: string;
};

export function roleHasCapability(role: HouseholdRole, capability: Capability): boolean {
  return CAPABILITY_ROLES[capability].includes(role);
}

/** Every capability a role holds, for handing the UI the same names the server enforces. */
export function capabilitiesForRole(role: HouseholdRole): Capability[] {
  return ALL_CAPABILITIES.filter((capability) => roleHasCapability(role, capability));
}

/**
 * Capabilities effective for a request context. Auth-off installs intentionally
 * expose the complete owner surface because there are no accounts to elevate.
 */
export function capabilitiesForContext(context: {
  authRequired: boolean;
  role: HouseholdRole | null;
}): Capability[] {
  if (!context.authRequired) return [...ALL_CAPABILITIES];
  return context.role ? capabilitiesForRole(context.role) : [];
}

/**
 * Decide one request. `null` means allowed.
 *
 * When `SHED_AUTH_REQUIRED` is off there are no sign-ins to check, so everything
 * is allowed with no member. It would otherwise be able to read its dashboard
 * but not manage a single record because every write would 401 against a login
 * it deliberately disabled. Callers must therefore treat the member as nullable
 * even on success.
 */
export function authorize(
  capability: Capability,
  context: { authRequired: boolean; role: HouseholdRole | null },
): AuthorizationDenial | null {
  if (!context.authRequired) return null;
  if (!context.role) return { status: 401, error: "Sign in to Shed first" };
  if (!roleHasCapability(context.role, capability)) return { status: 403, error: "Head Keeper access required" };
  return null;
}

/** Derived from the matrix so the documented Keeper allowance cannot drift. */
export const KEEPER_CAPABILITIES: readonly Capability[] = Object.freeze(
  capabilitiesForRole("Zookeeper"),
);
