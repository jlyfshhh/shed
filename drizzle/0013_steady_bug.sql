ALTER TABLE `equipment` ADD `source_name` text;--> statement-breakpoint
ALTER TABLE `equipment` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `lighting_plan_fixtures` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `lighting_plans` ADD `source_snapshot_json` text;--> statement-breakpoint
ALTER TABLE `lighting_plans` ADD `import_status` text;--> statement-breakpoint
ALTER TABLE `lighting_plans` ADD `imported_at` text;