import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const animals = sqliteTable("animals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  species: text("species").notNull(),
  groupName: text("group_name").notNull(),
  location: text("location").notNull(),
  weightGrams: integer("weight_grams"),
  weightDate: text("weight_date"),
});

export const careTasks = sqliteTable("care_tasks", {
  id: text("id").primaryKey(),
  animalId: text("animal_id").notNull(),
  taskType: text("task_type").notNull().default("general"),
  title: text("title").notNull(),
  details: text("details").notNull(),
  dueDate: text("due_date").notNull(),
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
}, (table) => [uniqueIndex("event_task_due_unique").on(table.taskId, table.dueDate)]);

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
});

export const voiceAuditLogs = sqliteTable("voice_audit_logs", {
  id: text("id").primaryKey(),
  requestedAt: text("requested_at").notNull(),
  completedAt: text("completed_at"),
  utterance: text("utterance").notNull(),
  status: text("status").notNull(),
  model: text("model").notNull(),
  toolCallsJson: text("tool_calls_json").notNull().default("[]"),
  responseText: text("response_text"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  userAgent: text("user_agent"),
}, (table) => [index("voice_audit_requested_at_idx").on(table.requestedAt)]);

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
