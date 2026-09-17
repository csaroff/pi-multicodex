import { z } from "zod";

const AccountSchema = z
	.object({
		email: z.string().min(1).meta({ description: "Account email identifier" }),
		accessToken: z
			.string()
			.min(1)
			.meta({ description: "OAuth access token (JWT)" }),
		refreshToken: z
			.string()
			.min(1)
			.meta({ description: "OAuth refresh token" }),
		expiresAt: z
			.number()
			.meta({ description: "Token expiry timestamp (ms since epoch)" }),
		accountId: z.string().optional().meta({ description: "OpenAI account ID" }),
		lastUsed: z
			.number()
			.optional()
			.meta({ description: "Last manual selection timestamp (ms)" }),
		quotaExhaustedUntil: z
			.number()
			.optional()
			.meta({ description: "Quota cooldown expiry (ms)" }),
		needsReauth: z
			.boolean()
			.optional()
			.meta({ description: "Account needs re-authentication" }),
	})
	.meta({ id: "Account", description: "A managed OpenAI Codex account" });

export const StorageSchema = z
	.object({
		$schema: z
			.string()
			.optional()
			.meta({ description: "JSON Schema reference for editor support" }),
		version: z
			.number()
			.int()
			.positive()
			.meta({ description: "Storage schema version" }),
		accounts: z
			.array(AccountSchema)
			.meta({ description: "Managed account entries" }),
		activeEmail: z
			.string()
			.optional()
			.meta({ description: "Currently active account email" }),
		manualEmail: z.string().min(1).optional().meta({
			description:
				"Last explicitly selected email; sticky across sessions until reset",
		}),
	})
	.meta({
		id: "MultiCodexStorage",
		description: "MultiCodex managed account storage",
	});
