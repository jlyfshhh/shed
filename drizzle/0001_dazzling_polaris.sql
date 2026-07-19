ALTER TABLE `care_tasks` ADD `task_type` text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `husbandry_events` ADD `task_type` text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `husbandry_events` ADD `notes` text;