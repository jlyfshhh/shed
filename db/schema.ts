import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const animals = sqliteTable("animals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  species: text("species").notNull(),
  groupName: text("group_name").notNull(),
  location: text("location").notNull(),
  weightGrams: integer("weight_grams"),
  weightDate: text("weight_date"),
  scientificName: text("scientific_name"),
  morph: text("morph"),
  sex: text("sex"),
  birthDate: text("birth_date"),
  acquiredDate: text("acquired_date"),
  source: text("source"),
  notes: text("notes"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  enclosureId: text("enclosure_id"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const enclosures = sqliteTable("enclosures", {
  id: text("id").primaryKey(), name: text("name").notNull(), enclosureType: text("enclosure_type"),
  manufacturer: text("manufacturer"), model: text("model"), width: real("width"), depth: real("depth"), height: real("height"),
  dimensionUnit: text("dimension_unit").notNull().default("in"), location: text("location"), substrate: text("substrate"),
  bioactive: integer("bioactive", { mode: "boolean" }).notNull().default(false), sharedHabitatId: text("shared_habitat_id"),
  notes: text("notes"), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});

export const careSchedules = sqliteTable("care_schedules", {
  id: text("id").primaryKey(), animalId: text("animal_id").notNull(), taskType: text("task_type").notNull(), title: text("title").notNull(),
  details: text("details").notNull().default(""), frequency: text("frequency").notNull(), intervalDays: integer("interval_days"),
  weekdaysJson: text("weekdays_json"), dayOfMonth: integer("day_of_month"), startDate: text("start_date").notNull(), endDate: text("end_date"),
  active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
  preySpecies: text("prey_species"), preyDescription: text("prey_description"), targetPercent: real("target_percent"),
  minimumPercent: real("minimum_percent"), maximumPercent: real("maximum_percent"), buyAsNeeded: integer("buy_as_needed", { mode: "boolean" }).notNull().default(false),
});

export const careTasks = sqliteTable("care_tasks", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id"),
  animalId: text("animal_id").notNull(),
  taskType: text("task_type").notNull().default("general"),
  title: text("title").notNull(),
  details: text("details").notNull(),
  dueDate: text("due_date").notNull(),
});

export const animalNotes = sqliteTable("animal_notes", {
  id: text("id").primaryKey(), animalId: text("animal_id"), enclosureId: text("enclosure_id"), category: text("category").notNull().default("general"),
  title: text("title").notNull(), body: text("body").notNull(), pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), createdByMemberId: text("created_by_member_id"), createdByName: text("created_by_name"),
});

export const equipment = sqliteTable("equipment", {
  id: text("id").primaryKey(), animalId: text("animal_id"), enclosureId: text("enclosure_id"), category: text("category").notNull().default("other"),
  name: text("name").notNull(), brand: text("brand"), model: text("model"), installedOn: text("installed_on"), replaceOn: text("replace_on"),
  active: integer("active", { mode: "boolean" }).notNull().default(true), notes: text("notes"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});

export const husbandryEvents = sqliteTable("husbandry_events", {
  id: text("id").primaryKey(),
  taskId: text("task_id"),
  animalId: text("animal_id").notNull(),
  taskType: text("task_type").notNull().default("general"),
  title: text("title").notNull(),
  notes: text("notes"),
  dueDate: text("due_date"),
  occurredAt: text("occurred_at").notNull(),
  actorRole: text("actor_role").notNull(),
  completedByMemberId: text("completed_by_member_id"),
  completedByName: text("completed_by_name"),
  voidedAt: text("voided_at"),
  voidedByMemberId: text("voided_by_member_id"),
  voidedByName: text("voided_by_name"),
  voidReason: text("void_reason"),
  editedAt: text("edited_at"),
  editedByMemberId: text("edited_by_member_id"),
  editedByName: text("edited_by_name"),
}, (table) => [uniqueIndex("event_task_due_unique").on(table.taskId, table.dueDate)]);

export const husbandryEventRevisions = sqliteTable("husbandry_event_revisions", {
  id: text("id").primaryKey(), eventId: text("event_id").notNull(), changedAt: text("changed_at").notNull(),
  changedByMemberId: text("changed_by_member_id").notNull(), changedByName: text("changed_by_name").notNull(), previousJson: text("previous_json").notNull(),
});

export const householdMembers = sqliteTable("household_members", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  accessCodeHash: text("access_code_hash").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastLoginAt: text("last_login_at"),
}, (table) => [
  uniqueIndex("household_members_access_code_hash_unique").on(table.accessCodeHash),
  index("household_members_active_role_idx").on(table.active, table.role),
]);

export const weightEvents = sqliteTable("weight_events", {
  id: text("id").primaryKey(),
  animalId: text("animal_id").notNull(),
  recordedOn: text("recorded_on").notNull(),
  weightGrams: integer("weight_grams").notNull(),
  notes: text("notes"),
  recordedByMemberId: text("recorded_by_member_id"),
  recordedByName: text("recorded_by_name"),
  createdAt: text("created_at"),
});

export const feederInventory = sqliteTable("feeder_inventory", {
  id: text("id").primaryKey(),
  preySpecies: text("prey_species").notNull(),
  sizeClass: text("size_class").notNull(),
  weightGrams: integer("weight_grams").notNull(),
  status: text("status").notNull().default("available"),
  addedOn: text("added_on").notNull(),
  consumedAt: text("consumed_at"),
  animalId: text("animal_id"),
  husbandryEventId: text("husbandry_event_id"),
  notes: text("notes"),
}, (table) => [
  index("feeder_inventory_status_idx").on(table.status),
  index("feeder_inventory_size_weight_idx").on(table.preySpecies, table.sizeClass, table.weightGrams),
]);

export const feedingAssignments = sqliteTable("feeding_assignments", {
  id: text("id").primaryKey(),
  animalId: text("animal_id").notNull(),
  feederId: text("feeder_id").notNull(),
  plannedFor: text("planned_for").notNull(),
  status: text("status").notNull().default("planned"),
  createdAt: text("created_at").notNull(),
  consumedAt: text("consumed_at"),
  husbandryEventId: text("husbandry_event_id"),
}, (table) => [
  index("feeding_assignments_animal_date_idx").on(table.animalId, table.plannedFor),
  index("feeding_assignments_feeder_idx").on(table.feederId),
]);
