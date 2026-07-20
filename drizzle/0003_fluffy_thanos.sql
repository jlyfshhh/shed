CREATE TABLE `feeder_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`prey_species` text NOT NULL,
	`size_class` text NOT NULL,
	`weight_grams` integer NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`added_on` text NOT NULL,
	`consumed_at` text,
	`animal_id` text,
	`husbandry_event_id` text,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `feeder_inventory_status_idx` ON `feeder_inventory` (`status`);--> statement-breakpoint
CREATE INDEX `feeder_inventory_size_weight_idx` ON `feeder_inventory` (`prey_species`,`size_class`,`weight_grams`);--> statement-breakpoint
CREATE TABLE `feeding_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`animal_id` text NOT NULL,
	`feeder_id` text NOT NULL,
	`planned_for` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text NOT NULL,
	`consumed_at` text,
	`husbandry_event_id` text
);
--> statement-breakpoint
CREATE INDEX `feeding_assignments_animal_date_idx` ON `feeding_assignments` (`animal_id`,`planned_for`);--> statement-breakpoint
CREATE INDEX `feeding_assignments_feeder_idx` ON `feeding_assignments` (`feeder_id`);