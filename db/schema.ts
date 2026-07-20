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
}, (table) => [uniqueIndex("event_task_due_unique").on(table.taskId, table.dueDate)]);

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
