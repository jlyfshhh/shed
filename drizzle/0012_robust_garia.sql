CREATE TABLE `lighting_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`measured_at` text NOT NULL,
	`position` text,
	`height` real,
	`height_unit` text DEFAULT 'cm' NOT NULL,
	`instrument` text,
	`notes` text,
	`measured_by_member_id` text,
	`measured_by_name` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lighting_measurements_plan_metric_date_idx` ON `lighting_measurements` (`plan_id`,`metric`,`measured_at`);--> statement-breakpoint
CREATE TABLE `lighting_plan_fixtures` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`role` text NOT NULL,
	`position_cm` real,
	`mounting_height_cm` real,
	`quantity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lighting_plan_fixtures_plan_equipment_unique` ON `lighting_plan_fixtures` (`plan_id`,`equipment_id`);--> statement-breakpoint
CREATE INDEX `lighting_plan_fixtures_plan_idx` ON `lighting_plan_fixtures` (`plan_id`);--> statement-breakpoint
CREATE TABLE `lighting_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`enclosure_id` text NOT NULL,
	`name` text NOT NULL,
	`species` text,
	`source_name` text DEFAULT 'Light My Reptile' NOT NULL,
	`source_url` text DEFAULT 'https://lightmyreptile.com/' NOT NULL,
	`source_version` text,
	`planned_on` text NOT NULL,
	`reviewed_on` text,
	`mounting_mode` text,
	`mesh_loss_percent` real,
	`basking_height` real,
	`height_unit` text DEFAULT 'cm' NOT NULL,
	`target_uvi_min` real,
	`target_uvi_max` real,
	`target_lux_min` real,
	`target_lux_max` real,
	`target_power_density_min` real,
	`target_power_density_max` real,
	`plan_sheet_key` text,
	`plan_sheet_name` text,
	`plan_sheet_type` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lighting_plans_enclosure_active_idx` ON `lighting_plans` (`enclosure_id`,`active`);
