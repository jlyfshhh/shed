CREATE TABLE `household_members` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`access_code_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_members_access_code_hash_unique` ON `household_members` (`access_code_hash`);--> statement-breakpoint
CREATE INDEX `household_members_active_role_idx` ON `household_members` (`active`,`role`);--> statement-breakpoint
ALTER TABLE `husbandry_events` ADD `completed_by_member_id` text;--> statement-breakpoint
ALTER TABLE `husbandry_events` ADD `completed_by_name` text;