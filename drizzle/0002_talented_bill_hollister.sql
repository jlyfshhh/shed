CREATE TABLE `voice_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`requested_at` text NOT NULL,
	`completed_at` text,
	`utterance` text NOT NULL,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`tool_calls_json` text DEFAULT '[]' NOT NULL,
	`response_text` text,
	`error_message` text,
	`duration_ms` integer,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `voice_audit_requested_at_idx` ON `voice_audit_logs` (`requested_at`);