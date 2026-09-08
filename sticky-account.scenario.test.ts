import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	dir: "",
	loadImportedOpenAICodexAuth: vi.fn(),
}));
vi.mock("./agent-paths", () => ({
	getAgentPath: (...parts: string[]) => join(mocks.dir, ...parts),
	getAgentSettingsPath: () => join(mocks.dir, "settings.json"),
}));
vi.mock("./auth", () => ({
	loadImportedOpenAICodexAuth: mocks.loadImportedOpenAICodexAuth,
}));
vi.mock("./usage-cache", () => ({
	loadSharedUsageCache: () => new Map(),
	getSharedUsageKey: (account: { email: string }) => account.email,
	getOrFetchSharedUsage: async () => ({ fetchedAt: Date.now() }),
}));

async function setup() {
	const { AccountManager } = await import("./account-manager");
	const { loadStorage, saveStorage } = await import("./storage");
	const { registerCommands } = await import("./commands");
	const { handleSessionStart } = await import("./hooks");
	const manager = new AccountManager();
	for (const email of ["a@example.com", "b@example.com"]) {
		manager.addOrUpdateAccount(email, {
			access: `access-${email}`,
			refresh: `refresh-${email}`,
			expires: Date.now() + 3_600_000,
		});
	}
	const command = (instance: InstanceType<typeof AccountManager>) => {
		const registerCommand = vi.fn();
		registerCommands({ registerCommand } as never, instance, {
			refreshFor: vi.fn(),
		} as never);
		return (args: string) =>
			registerCommand.mock.calls[0]?.[1].handler(args, {
				hasUI: false,
				ui: { notify: vi.fn() },
			});
	};
	return {
		AccountManager,
		manager,
		command,
		loadStorage,
		saveStorage,
		handleSessionStart,
	};
}

beforeEach(() => {
	vi.resetModules();
	mocks.dir = mkdtempSync(join(tmpdir(), "multicodex-sticky-"));
	mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
});
afterEach(() => rmSync(mocks.dir, { recursive: true, force: true }));

describe("sticky account selection across sessions", () => {
	it("remembers the last email I select until I explicitly return to automatic rotation", async () => {
		// Selecting an account is a preference, not just a footer update. A new
		// process must honor it even when automatic rotation last activated A.
		const { AccountManager, manager, command, handleSessionStart } =
			await setup();
		await command(manager)("use a@example.com");
		await command(manager)("use b@example.com");
		manager.setActiveAccount("a@example.com");

		const nextSession = new AccountManager();
		handleSessionStart(nextSession);
		await nextSession.waitUntilReady();
		expect(nextSession.getAvailableManualAccount()?.email).toBe(
			"b@example.com",
		);
		expect(nextSession.getDisplayAccount()?.email).toBe("b@example.com");

		// Unsetting must survive another restart, not merely clear memory.
		await command(nextSession)("reset manual");
		expect(nextSession.getAvailableManualAccount()).toBeUndefined();
		expect(new AccountManager().hasManualAccount()).toBe(false);
	});

	it("does not turn a legacy automatically selected activeEmail into a pin", async () => {
		const { AccountManager } = await setup();
		expect(new AccountManager().hasManualAccount()).toBe(false);
	});

	it("does not let an older session's routine save erase a newer selection or restore an unset pin", async () => {
		const { AccountManager, manager, command } = await setup();
		const olderSession = new AccountManager();
		await command(manager)("use b@example.com");
		olderSession.setActiveAccount("a@example.com");
		expect(new AccountManager().getAvailableManualAccount()?.email).toBe(
			"b@example.com",
		);
		await command(olderSession)("reset manual");
		manager.setActiveAccount("b@example.com");
		expect(new AccountManager().hasManualAccount()).toBe(false);
	});

	it("falls back during cooldown without forgetting the saved selection, and can unset it while suspended", async () => {
		const { AccountManager, manager, command, handleSessionStart } =
			await setup();
		await command(manager)("use b@example.com");
		manager.markExhausted("b@example.com", Date.now() + 60_000);
		const nextSession = new AccountManager();
		handleSessionStart(nextSession);
		await nextSession.waitUntilReady();
		expect(nextSession.getAvailableManualAccount()).toBeUndefined();
		expect(nextSession.getActiveAccount()?.email).toBe("a@example.com");
		expect(new AccountManager().getManualAccount()?.email).toBe(
			"b@example.com",
		);
		await command(nextSession)("reset manual");
		expect(new AccountManager().hasManualAccount()).toBe(false);
	});

	it.each([
		"quota",
		"auth",
	] as const)("keeps the saved email when a request falls back after a %s failure", async (failure) => {
		const { AccountManager, manager, command } = await setup();
		const { createStreamWrapper } = await import("./stream-wrapper");
		const { createErrorAssistantMessage } = await import("./stream-utils");
		const { getModels } = await import("@earendil-works/pi-ai/compat");
		const model = getModels("openai-codex")[0];
		if (!model) throw new Error("Missing Codex model fixture");
		await command(manager)("use b@example.com");
		if (failure === "auth") {
			vi.spyOn(manager, "ensureValidToken").mockRejectedValueOnce(
				new Error("invalid_grant"),
			);
		}
		const message = createErrorAssistantMessage(
			model,
			"HTTP 429 Too Many Requests",
		);
		const served: string[] = [];
		const wrapper = createStreamWrapper(manager, {
			streamSimple: ((request: typeof model) =>
				(async function* () {
					const email = request.headers?.["X-Multicodex-Account"] ?? "";
					served.push(email);
					if (email === "b@example.com") {
						yield { type: "error", reason: "error", error: message };
					} else {
						yield {
							type: "done",
							reason: "stop",
							message: {
								...message,
								stopReason: "stop",
								errorMessage: undefined,
							},
						};
					}
				})()) as never,
		});
		const events = await Array.fromAsync(wrapper(model, { messages: [] }));
		expect(events.at(-1)?.type).toBe("done");
		expect(served.at(-1)).toBe("a@example.com");
		expect(manager.hasManualAccount()).toBe(false);
		expect(new AccountManager().getManualAccount()?.email).toBe(
			"b@example.com",
		);
	});

	it("clears the saved preference when its account is removed", async () => {
		const { AccountManager, manager, command } = await setup();
		await command(manager)("use b@example.com");
		expect(manager.removeAccount("b@example.com")).toBe(true);
		expect(new AccountManager().hasManualAccount()).toBe(false);
	});

	it("restores a selected pi-auth email after auth loads without persisting its credentials", async () => {
		const { AccountManager, manager, command, loadStorage } = await setup();
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			credentials: {
				access: "pi-access",
				refresh: "pi-refresh",
				expires: Date.now() + 3_600_000,
			},
		});
		await manager.loadPiAuth();
		await command(manager)("use pi@example.com");
		const nextSession = new AccountManager();
		// Footer reads may happen before the asynchronous auth import completes.
		expect(nextSession.getManualAccount()).toBeUndefined();
		await nextSession.loadPiAuth();
		expect(nextSession.getAvailableManualAccount()?.email).toBe(
			"pi@example.com",
		);
		expect(
			loadStorage().accounts.map((account) => account.email),
		).not.toContain("pi@example.com");
	});
});
