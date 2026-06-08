import { describe, expect, it, vi } from "vitest";
import type { AccountManager } from "./account-manager";
import { registerCommands } from "./commands";
import type { createUsageStatusController } from "./status";

function createStatusControllerMock(usageMode: "left" | "used" = "left") {
	return {
		refreshFor: vi.fn().mockResolvedValue(undefined),
		openPreferencesPanel: vi.fn().mockResolvedValue(undefined),
		loadPreferences: vi.fn().mockResolvedValue(undefined),
		getPreferences: vi.fn(() => ({
			usageMode,
			resetWindow: "7d",
			showAccount: true,
			showReset: true,
			order: "account-first",
		})),
	} as unknown as ReturnType<typeof createUsageStatusController>;
}

function createAccountManagerMock(emails: string[] = []) {
	return {
		getAccounts: () =>
			emails.map((email) => ({
				email,
				accessToken: "token",
				refreshToken: "refresh",
				expiresAt: Date.now() + 60_000,
			})),
		getAccount: (email: string) => ({
			email,
			accessToken: "token",
			refreshToken: "refresh",
			expiresAt: Date.now() + 60_000,
		}),
		getActiveAccount: () => undefined,
		getManualAccount: () => undefined,
		isPiAuthAccount: () => false,
		getCachedUsage: () => undefined,
		refreshUsageForAllAccounts: vi.fn().mockResolvedValue(undefined),
	} as unknown as AccountManager;
}

describe("registerCommands", () => {
	it("registers only the multicodex command", () => {
		const registerCommand = vi.fn();
		registerCommands(
			{ registerCommand } as never,
			createAccountManagerMock(),
			createStatusControllerMock(),
		);

		expect(registerCommand).toHaveBeenCalledTimes(1);
		expect(registerCommand).toHaveBeenCalledWith(
			"multicodex",
			expect.objectContaining({
				description: expect.any(String),
				handler: expect.any(Function),
				getArgumentCompletions: expect.any(Function),
			}),
		);
	});

	it("returns dynamic autocomplete for subcommands and managed account identifiers", () => {
		const registerCommand = vi.fn();
		registerCommands(
			{ registerCommand } as never,
			createAccountManagerMock(["alpha@example.com", "beta@example.com"]),
			createStatusControllerMock(),
		);

		const commandOptions = registerCommand.mock.calls[0]?.[1] as {
			getArgumentCompletions: (
				prefix: string,
			) => Array<{ value: string; label: string }> | null;
		};

		const subcommands = commandOptions.getArgumentCompletions("");
		expect(subcommands?.map((item) => item.value)).toContain("accounts");
		expect(subcommands?.map((item) => item.value)).toContain("show");
		expect(subcommands?.map((item) => item.value)).toContain("use");
		expect(subcommands?.map((item) => item.value)).toContain("refresh");
		expect(subcommands?.map((item) => item.value)).toContain("reauth");

		const useAccounts = commandOptions.getArgumentCompletions("use a");
		expect(useAccounts).toEqual([
			{ value: "use alpha@example.com", label: "alpha@example.com" },
		]);

		const refreshAccounts = commandOptions.getArgumentCompletions("refresh a");
		expect(refreshAccounts).toContainEqual({
			value: "refresh alpha@example.com",
			label: "alpha@example.com",
		});
	});

	it("shows a non-interactive warning when no subcommand is provided", async () => {
		const registerCommand = vi.fn();
		registerCommands(
			{ registerCommand } as never,
			createAccountManagerMock(),
			createStatusControllerMock(),
		);

		const commandOptions = registerCommand.mock.calls[0]?.[1] as {
			handler: (args: string, ctx: unknown) => Promise<void>;
		};
		const notify = vi.fn();
		await commandOptions.handler("", {
			hasUI: false,
			ui: { notify },
		});

		expect(notify).toHaveBeenCalledWith(
			"/multicodex requires a subcommand in non-interactive mode. Use /multicodex help.",
			"warning",
		);
	});

	it("uses footer percent mode for non-interactive account summaries", async () => {
		const registerCommand = vi.fn();
		const accountManager = {
			...createAccountManagerMock(["alpha@example.com"]),
			getCachedUsage: () => ({
				primary: { usedPercent: 25, resetAt: undefined },
				secondary: { usedPercent: 40, resetAt: undefined },
			}),
		} as unknown as AccountManager;
		registerCommands(
			{ registerCommand } as never,
			accountManager,
			createStatusControllerMock("used"),
		);

		const commandOptions = registerCommand.mock.calls[0]?.[1] as {
			handler: (args: string, ctx: unknown) => Promise<void>;
		};
		const notify = vi.fn();
		await commandOptions.handler("accounts", {
			hasUI: false,
			ui: { notify },
		});

		expect(notify).toHaveBeenCalledWith(
			"alpha@example.com - 5h 25% used reset:unknown | weekly 40% used reset:unknown",
			"info",
		);
	});
});
