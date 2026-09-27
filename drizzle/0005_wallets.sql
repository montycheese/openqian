CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`family` text NOT NULL,
	`address` text NOT NULL,
	`chains` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`last_refreshed_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_family_address_idx` ON `wallets` (`family`,`address`);