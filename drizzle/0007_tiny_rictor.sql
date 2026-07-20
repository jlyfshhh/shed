CREATE TABLE `animal_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`animal_id` text,
	`enclosure_id` text,
	`category` text DEFAULT 'general' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by_member_id` text,
	`created_by_name` text
);
--> statement-breakpoint
CREATE TABLE `care_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`animal_id` text NOT NULL,
	`task_type` text NOT NULL,
	`title` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`frequency` text NOT NULL,
	`interval_days` integer,
	`weekdays_json` text,
	`day_of_month` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enclosures` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enclosure_type` text,
	`manufacturer` text,
	`model` text,
	`width` real,
	`depth` real,
	`height` real,
	`dimension_unit` text DEFAULT 'in' NOT NULL,
	`location` text,
	`substrate` text,
	`bioactive` integer DEFAULT false NOT NULL,
	`shared_habitat_id` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`animal_id` text,
	`enclosure_id` text,
	`category` text DEFAULT 'other' NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`model` text,
	`installed_on` text,
	`replace_on` text,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `husbandry_event_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`changed_at` text NOT NULL,
	`changed_by_member_id` text NOT NULL,
	`changed_by_name` text NOT NULL,
	`previous_json` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `animals` ADD `scientific_name` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `morph` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `sex` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `birth_date` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `acquired_date` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `source` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `animals` ADD `enclosure_id` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `animals` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `care_tasks` ADD `schedule_id` text;--> statement-breakpoint
ALTER TABLE `husbandry_events` ADD `edited_at` text;--> statement-breakpoint
ALTER TABLE `husbandry_events` ADD `edited_by_member_id` text;--> statement-breakpoint
ALTER TABLE `husbandry_events` ADD `edited_by_name` text;--> statement-breakpoint
ALTER TABLE `weight_events` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `weight_events` ADD `recorded_by_member_id` text;--> statement-breakpoint
ALTER TABLE `weight_events` ADD `recorded_by_name` text;--> statement-breakpoint
ALTER TABLE `weight_events` ADD `created_at` text;