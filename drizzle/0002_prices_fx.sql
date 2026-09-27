CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` real NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_date_pair_source_idx` ON `fx_rates` (`date`,`base`,`quote`,`source`);--> statement-breakpoint
CREATE TABLE `prices` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prices_symbol_kind_date_source_idx` ON `prices` (`symbol`,`kind`,`date`,`source`);