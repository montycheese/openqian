CREATE TABLE `snapshot_accounts` (
	`snapshot_id` text NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text NOT NULL,
	`native_value` real,
	`native_currency` text,
	`base_value` real NOT NULL,
	`counted` integer NOT NULL,
	PRIMARY KEY(`snapshot_id`, `account_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshot_accounts_account_idx` ON `snapshot_accounts` (`account_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`base_currency` text NOT NULL,
	`assets` real NOT NULL,
	`debts` real NOT NULL,
	`net_worth` real NOT NULL,
	`fx_rates` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_date_unique` ON `snapshots` (`date`);