CREATE TABLE `animals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`species` text NOT NULL,
	`group_name` text NOT NULL,
	`location` text NOT NULL,
	`weight_grams` integer,
	`weight_date` text
);
--> statement-breakpoint
CREATE TABLE `care_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`animal_id` text NOT NULL,
	`title` text NOT NULL,
	`details` text NOT NULL,
	`due_date` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `husbandry_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`animal_id` text NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`occurred_at` text NOT NULL,
	`actor_role` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_task_due_unique` ON `husbandry_events` (`task_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `weight_events` (
	`id` text PRIMARY KEY NOT NULL,
	`animal_id` text NOT NULL,
	`recorded_on` text NOT NULL,
	`weight_grams` integer NOT NULL
);
