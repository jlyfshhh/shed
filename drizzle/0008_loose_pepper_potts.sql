ALTER TABLE `care_schedules` ADD `prey_species` text;--> statement-breakpoint
ALTER TABLE `care_schedules` ADD `prey_description` text;--> statement-breakpoint
ALTER TABLE `care_schedules` ADD `target_percent` real;--> statement-breakpoint
ALTER TABLE `care_schedules` ADD `minimum_percent` real;--> statement-breakpoint
ALTER TABLE `care_schedules` ADD `maximum_percent` real;--> statement-breakpoint
ALTER TABLE `care_schedules` ADD `buy_as_needed` integer DEFAULT false NOT NULL;