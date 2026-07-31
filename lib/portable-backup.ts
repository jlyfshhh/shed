export const BACKUP_SCHEMA_VERSION = 10;

export const PORTABLE_APP_SETTING_KEYS = ["default_reward_cents", "care_start_date"] as const;

type ResourceDefinition = {
  table: string;
  key: "id" | "key";
  columns: readonly string[];
};

export const PORTABLE_RESOURCES = {
  animals: { table: "animals", key: "id", columns: ["id", "name", "species", "group_name", "location", "weight_grams", "weight_date", "scientific_name", "morph", "sex", "birth_date", "acquired_date", "source", "notes", "active", "enclosure_id", "created_at", "updated_at"] },
  enclosures: { table: "enclosures", key: "id", columns: ["id", "name", "enclosure_type", "manufacturer", "model", "width", "depth", "height", "dimension_unit", "location", "substrate", "bioactive", "shared_habitat_id", "notes", "active", "created_at", "updated_at"] },
  careSchedules: { table: "care_schedules", key: "id", columns: ["id", "animal_id", "task_type", "title", "details", "frequency", "interval_days", "weekdays_json", "day_of_month", "start_date", "end_date", "active", "created_at", "updated_at", "prey_species", "prey_description", "prey_size_class", "target_percent", "minimum_percent", "maximum_percent", "buy_as_needed", "reward_cents"] },
  careTasks: { table: "care_tasks", key: "id", columns: ["id", "schedule_id", "animal_id", "task_type", "title", "details", "due_date", "missed_at", "missed_by_member_id", "missed_by_name"] },
  husbandryEvents: { table: "husbandry_events", key: "id", columns: ["id", "task_id", "animal_id", "task_type", "title", "notes", "due_date", "occurred_at", "actor_role", "completed_by_member_id", "completed_by_name", "voided_at", "voided_by_member_id", "voided_by_name", "void_reason", "edited_at", "edited_by_member_id", "edited_by_name", "reward_cents"] },
  husbandryEventRevisions: { table: "husbandry_event_revisions", key: "id", columns: ["id", "event_id", "changed_at", "changed_by_member_id", "changed_by_name", "previous_json"] },
  animalNotes: { table: "animal_notes", key: "id", columns: ["id", "animal_id", "enclosure_id", "category", "title", "body", "pinned", "created_at", "updated_at", "created_by_member_id", "created_by_name"] },
  equipment: { table: "equipment", key: "id", columns: ["id", "animal_id", "enclosure_id", "category", "name", "brand", "model", "installed_on", "replace_on", "active", "notes", "created_at", "updated_at"] },
  weightEvents: { table: "weight_events", key: "id", columns: ["id", "animal_id", "recorded_on", "weight_grams", "notes", "recorded_by_member_id", "recorded_by_name", "created_at"] },
  feederInventory: { table: "feeder_inventory", key: "id", columns: ["id", "prey_species", "size_class", "weight_grams", "status", "added_on", "consumed_at", "animal_id", "husbandry_event_id", "notes"] },
  feedingAssignments: { table: "feeding_assignments", key: "id", columns: ["id", "animal_id", "feeder_id", "planned_for", "status", "created_at", "consumed_at", "husbandry_event_id"] },
  appSettings: { table: "app_settings", key: "key", columns: ["key", "value"] },
  rewardPayouts: { table: "reward_payouts", key: "id", columns: ["id", "member_id", "amount_cents", "note", "paid_at", "paid_by_member_id", "paid_by_name"] },
} as const satisfies Record<string, ResourceDefinition>;

const MEMBER_REFERENCE_COLUMNS: Partial<Record<keyof typeof PORTABLE_RESOURCES, readonly string[]>> = {
  careTasks: ["missed_by_member_id"],
  husbandryEvents: ["completed_by_member_id", "voided_by_member_id", "edited_by_member_id"],
  husbandryEventRevisions: ["changed_by_member_id"],
  animalNotes: ["created_by_member_id"],
  weightEvents: ["recorded_by_member_id"],
  rewardPayouts: ["member_id", "paid_by_member_id"],
};

export function remapMemberReferences(
  resource: keyof typeof PORTABLE_RESOURCES,
  row: Record<string, unknown>,
  memberIds: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const remapped = { ...row };
  for (const column of MEMBER_REFERENCE_COLUMNS[resource] ?? []) {
    const sourceId = typeof remapped[column] === "string" ? remapped[column] : null;
    if (sourceId && memberIds.has(sourceId)) remapped[column] = memberIds.get(sourceId);
  }
  return remapped;
}

export type PortableMember = {
  id: string;
  display_name: string;
  role: "Owner" | "Zookeeper";
  earning_enabled?: number;
  active?: number;
  created_at?: string;
  updated_at?: string;
};

export type ExistingMember = {
  id: string;
  displayName: string;
  role: "Owner" | "Zookeeper";
};

export function matchingExistingMember(source: PortableMember, existing: readonly ExistingMember[]): ExistingMember | null {
  const exact = existing.find((member) => member.id === source.id && member.role === source.role);
  if (exact) return exact;
  const named = existing.find((member) =>
    member.role === source.role && member.displayName.trim().toLocaleLowerCase() === source.display_name.trim().toLocaleLowerCase()
  );
  if (named) return named;
  if (source.role === "Owner") return existing.find((member) => member.role === "Owner") ?? null;
  return null;
}
