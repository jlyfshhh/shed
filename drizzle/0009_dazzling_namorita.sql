CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reward_payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	`paid_at` text NOT NULL,
	`paid_by_member_id` text,
	`paid_by_name` text
);
--> statement-breakpoint
CREATE INDEX `reward_payouts_member_idx` ON `reward_payouts` (`member_id`,`paid_at`);--> statement-breakpoint
ALTER TABLE `care_schedules` ADD `reward_cents` integer;--> statement-breakpoint
ALTER TABLE `care_tasks` ADD `missed_at` text;--> statement-breakpoint
ALTER TABLE `care_tasks` ADD `missed_by_member_id` text;--> statement-breakpoint
ALTER TABLE `care_tasks` ADD `missed_by_name` text;--> statement-breakpoint
ALTER TABLE `household_members` ADD `earning_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `husbandry_events` ADD `reward_cents` integer DEFAULT 0 NOT NULL;