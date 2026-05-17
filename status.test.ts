import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createUsageStatusController,
	type FooterPreferences,
	formatActiveAccountStatus,
	isManagedModel,
} from "./status";

const defaultPreferences: FooterPreferences = {
	usageMode: "left",
	resetWindow: "both",
	showAccount: true,
	showReset: true,
	order: "account-first",
};

const usage = (primary: number, secondary: number) => ({
	primary: { usedPercent: primary, resetAt: Date.now() + 60_000 },
	secondary: { usedPercent: secondary, resetAt: Date.now() + 120_000 },
	fetchedAt: 0,
});

function createContext(overrides?: {
	provider?: string;
	setStatus?: ReturnType<typeof vi.fn>;
	notify?: ReturnType<typeof vi.fn>;
	color?: (token: string, text: string) => string;
	bold?: (text: string) => string;
	stale?: "ctx" | "instance" | boolean;
}) {
	const setStatus = overrides?.setStatus ?? vi.fn();
	const notify = overrides?.notify ?? vi.fn();
	const color = overrides?.color ?? ((_token: string, text: string) => text);
	const bold = overrides?.bold ?? ((text: string) => text);
	if (overrides?.stale) {
		const staleKind = overrides.stale === "instance" ? "instance" : "ctx";
		return {
			model: {
				provider: overrides?.provider ?? "openai-codex",
			},
			get hasUI() {
				throw new Error(
					`This extension ${staleKind} is stale after session replacement or reload. Use the provided replacement-session context instead.`,
				);
			},
			ui: {
				setStatus,
				notify,
				theme: {
					fg: color,
					bold,
				},
			},
		} as never;
	}
	return {
		hasUI: true,
		model: {
			provider: overrides?.provider ?? "openai-codex",
		},
		ui: {
			setStatus,
			notify,
			theme: {
				fg: color,
				bold,
			},
		},
	} as never;
}

describe("isManagedModel", () => {
	it("matches the overridden openai-codex provider", () => {
		expect(isManagedModel({ provider: "openai-codex" } as never)).toBe(true);
		expect(isManagedModel({ provider: "anthropic" } as never)).toBe(false);
		expect(isManagedModel(undefined)).toBe(false);
	});
});

describe("formatActiveAccountStatus", () => {
	it("renders account, usage, and both reset countdowns beside their matching periods", () => {
		const ctx = createContext();
		const text = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { usedPercent: 25, resetAt: Date.now() + 60_000 },
				secondary: { usedPercent: 60, resetAt: Date.now() + 3_600_000 },
				fetchedAt: 0,
			},
			defaultPreferences,
		);

		expect(text).toContain("Codex");
		expect(text).toContain("a@example.com");
		expect(text).toContain("5h:75% left (↺");
		expect(text).toContain("7d:40% left (↺");
		expect(text).not.toContain("(5h:↺");
		expect(text).not.toContain("(7d:↺");
	});

	it("supports hiding the account and moving it after the usage fields", () => {
		const ctx = createContext();
		const text = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { usedPercent: 10, resetAt: 1 },
				secondary: { usedPercent: 20, resetAt: 2 },
				fetchedAt: 0,
			},
			{
				...defaultPreferences,
				showAccount: false,
				showReset: false,
				order: "usage-first",
				usageMode: "used",
			},
		);

		expect(text).toContain("5h:10% used");
		expect(text).toContain("7d:20% used");
		expect(text).not.toContain("a@example.com");
		expect(text).not.toContain("↺");
	});

	it("colors full usage windows by severity, adds muted separators, and lifts the account text", () => {
		const ctx = createContext({
			color: (token: string, text: string) => `[${token}:${text}]`,
			bold: (text: string) => `<b>${text}</b>`,
		});
		const text = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { usedPercent: 25, resetAt: Date.now() + 60_000 },
				secondary: { usedPercent: 95, resetAt: Date.now() + 120_000 },
				fetchedAt: 0,
			},
			defaultPreferences,
		);

		expect(text).toContain("[muted:Codex]");
		expect(text).toContain("<b>[text:a@example.com]</b>");
		expect(text).toContain("[success:5h:75% left (↺");
		expect(text).toContain("[error:7d:5% left (↺");
		expect(text).toContain("[muted:·]");
	});

	it("uses thinkingMedium for neutral used windows", () => {
		const ctx = createContext({
			color: (token: string, text: string) => `[${token}:${text}]`,
		});
		const text = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { usedPercent: 52, resetAt: Date.now() + 60_000 },
				secondary: { usedPercent: 96, resetAt: Date.now() + 120_000 },
				fetchedAt: 0,
			},
			{ ...defaultPreferences, usageMode: "used" },
		);

		expect(text).toContain("[thinkingMedium:5h:52% used (↺");
		expect(text).toContain("[error:7d:96% used (↺");
	});

	it("uses muted loading text and dim unknown usage windows", () => {
		const ctx = createContext({
			color: (token: string, text: string) => `[${token}:${text}]`,
		});
		const loading = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			undefined,
			defaultPreferences,
		);
		const unknown = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { resetAt: Date.now() + 60_000 },
				secondary: { resetAt: Date.now() + 120_000 },
				fetchedAt: 0,
			},
			defaultPreferences,
		);

		expect(loading).toContain("[muted:Codex]");
		expect(loading).toContain("[muted:loading...]");
		expect(unknown).toContain("[dim:5h:-- (↺");
		expect(unknown).toContain("[dim:7d:-- (↺");
	});
});

describe("createUsageStatusController", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("clears the footer when the selected model is not managed by multicodex", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
		} as never);

		await controller.refreshFor(
			createContext({ provider: "anthropic", setStatus }),
		);

		expect(setStatus).toHaveBeenCalledWith("multicodex-usage", undefined);
	});

	it("renders active-account usage for managed models", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: vi.fn(),
			refreshUsageForAccount: vi.fn().mockResolvedValue({
				primary: { usedPercent: 10, resetAt: 1 },
				secondary: { usedPercent: 20, resetAt: 2 },
				fetchedAt: 0,
			}),
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("a@example.com"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:90% left"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("7d:80% left"),
		);
	});

	it("renders runtime display account instead of persisted active account", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "stored@example.com" }),
			getDisplayAccount: () => ({ email: "runtime@example.com" }),
			getCachedUsage: vi.fn(),
			refreshUsageForAccount: vi.fn().mockResolvedValue({
				primary: { usedPercent: 10, resetAt: 1 },
				secondary: { usedPercent: 20, resetAt: 2 },
				fetchedAt: 0,
			}),
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("runtime@example.com"),
		);
		expect(setStatus).not.toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("stored@example.com"),
		);
	});

	it("falls back to cached usage when refreshing fails", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: () => ({
				primary: { usedPercent: 30, resetAt: 1 },
				secondary: { usedPercent: 40, resetAt: 2 },
				fetchedAt: 0,
			}),
			refreshUsageForAccount: vi.fn().mockResolvedValue(undefined),
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:70% left"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("7d:60% left"),
		);
	});

	it("debounces model-select refreshes while rendering cached usage immediately", async () => {
		vi.useFakeTimers();
		const setStatus = vi.fn();
		const refreshUsageForAccount = vi.fn().mockResolvedValue({
			primary: { usedPercent: 10, resetAt: 1 },
			secondary: { usedPercent: 20, resetAt: 2 },
			fetchedAt: 0,
		});
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: () => ({
				primary: { usedPercent: 30, resetAt: 1 },
				secondary: { usedPercent: 40, resetAt: 2 },
				fetchedAt: 0,
			}),
			refreshUsageForAccount,
		} as never);
		const ctx = createContext({ setStatus });

		controller.scheduleModelSelectRefresh(ctx);
		controller.scheduleModelSelectRefresh(ctx);

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:70% left"),
		);
		expect(refreshUsageForAccount).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(250);

		expect(refreshUsageForAccount).toHaveBeenCalledTimes(1);
	});

	it("clears the footer immediately on model-select when the selected model is not codex", () => {
		vi.useFakeTimers();
		const setStatus = vi.fn();
		const refreshUsageForAccount = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: () => ({
				primary: { usedPercent: 30, resetAt: 1 },
				secondary: { usedPercent: 40, resetAt: 2 },
				fetchedAt: 0,
			}),
			refreshUsageForAccount,
		} as never);
		const ctx = createContext({ provider: "anthropic", setStatus });

		controller.scheduleModelSelectRefresh(ctx);

		expect(setStatus).toHaveBeenCalledWith("multicodex-usage", undefined);
		expect(refreshUsageForAccount).not.toHaveBeenCalled();
	});

	it("re-renders from cached state when the account manager reports a state change", async () => {
		const setStatus = vi.fn();
		let stateChangeHandler: (() => void) | undefined;
		let activeEmail = "a@example.com";
		const usages = new Map([
			[
				"a@example.com",
				{
					primary: { usedPercent: 30, resetAt: 1 },
					secondary: { usedPercent: 40, resetAt: 2 },
					fetchedAt: 0,
				},
			],
			[
				"b@example.com",
				{
					primary: { usedPercent: 5, resetAt: 1 },
					secondary: { usedPercent: 10, resetAt: 2 },
					fetchedAt: 0,
				},
			],
		]);
		const controller = createUsageStatusController({
			onStateChange: (handler: () => void) => {
				stateChangeHandler = handler;
				return () => undefined;
			},
			getActiveAccount: () => ({ email: activeEmail }),
			getCachedUsage: (email: string) => usages.get(email),
			refreshUsageForAccount: vi
				.fn()
				.mockImplementation(async () => usages.get(activeEmail)),
		} as never);
		const ctx = createContext({ setStatus });

		await controller.refreshFor(ctx);
		activeEmail = "b@example.com";
		stateChangeHandler?.();

		expect(setStatus).toHaveBeenLastCalledWith(
			"multicodex-usage",
			expect.stringContaining("b@example.com"),
		);
		expect(setStatus).toHaveBeenLastCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:95% left"),
		);
	});

	it("does not overwrite a runtime account switch after an older usage refresh finishes", async () => {
		const setStatus = vi.fn();
		let stateChangeHandler: (() => void) | undefined;
		let displayEmail = "a@example.com";
		const usages = new Map([
			[
				"a@example.com",
				{
					primary: { usedPercent: 30, resetAt: 1 },
					secondary: { usedPercent: 40, resetAt: 2 },
					fetchedAt: 0,
				},
			],
			[
				"b@example.com",
				{
					primary: { usedPercent: 5, resetAt: 1 },
					secondary: { usedPercent: 10, resetAt: 2 },
					fetchedAt: 0,
				},
			],
		]);
		const refreshUsageForAccount = vi
			.fn()
			.mockImplementation(async (account) => {
				if (account.email === "a@example.com") {
					displayEmail = "b@example.com";
					stateChangeHandler?.();
				}
				return usages.get(account.email);
			});
		const controller = createUsageStatusController({
			onStateChange: (handler: () => void) => {
				stateChangeHandler = handler;
				return () => undefined;
			},
			getActiveAccount: () => ({ email: displayEmail }),
			getDisplayAccount: () => ({ email: displayEmail }),
			getCachedUsage: (email: string) => usages.get(email),
			refreshUsageForAccount,
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(refreshUsageForAccount).toHaveBeenCalledWith({
			email: "a@example.com",
		});
		expect(refreshUsageForAccount).toHaveBeenCalledWith({
			email: "b@example.com",
		});
		expect(setStatus).toHaveBeenLastCalledWith(
			"multicodex-usage",
			expect.stringContaining("b@example.com"),
		);
		expect(setStatus).toHaveBeenLastCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:95% left"),
		);
	});

	it("quietly abandons stale contexts instead of crashing", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: vi.fn(),
			refreshUsageForAccount: vi.fn(),
		} as never);

		await expect(
			controller.refreshFor(createContext({ stale: true, setStatus })),
		).resolves.toBeUndefined();
		expect(setStatus).not.toHaveBeenCalled();
	});

	it("recognizes the current pi stale ctx error wording", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: vi.fn(),
			refreshUsageForAccount: vi.fn(),
		} as never);

		await expect(
			controller.refreshFor(createContext({ stale: "ctx", setStatus })),
		).resolves.toBeUndefined();
		expect(setStatus).not.toHaveBeenCalled();
	});

	it("renders per-account widgets on fixed IDs without changing the active-account ID", async () => {
		const setStatus = vi.fn();
		const accounts = [{ email: "a@example.com" }, { email: "b@example.com" }];
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getAccounts: () => accounts,
			isPiAuthAccount: () => false,
			getActiveAccount: () => accounts[0],
			getCachedUsage: (email: string) =>
				email === "a@example.com" ? usage(25, 60) : usage(88, 32),
			refreshUsageForAccount: vi.fn().mockResolvedValue(undefined),
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("a@example.com"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-0",
			expect.stringContaining("a@example.com"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-1",
			expect.stringContaining("b@example.com"),
		);
		expect(setStatus).not.toHaveBeenCalledWith(
			"multicodex-account-usage-a@example.com",
			expect.anything(),
		);
	});

	it("renders per-account usage widgets with progress bars", async () => {
		const setStatus = vi.fn();
		const accounts = [{ email: "a@example.com" }];
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getAccounts: () => accounts,
			isPiAuthAccount: () => false,
			getActiveAccount: () => accounts[0],
			getCachedUsage: () => usage(25, 60),
			refreshUsageForAccount: vi.fn().mockResolvedValue(undefined),
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-0",
			expect.stringContaining("5h:[███████████████░░░░░] 75% left"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-0",
			expect.stringContaining("7d:[████████░░░░░░░░░░░░] 40% left"),
		);
	});

	it("filters pi auth accounts, renders at most two managed accounts, and orders display account first", async () => {
		const setStatus = vi.fn();
		const piAuth = { email: "pi@example.com" };
		const accounts = [
			{ email: "a@example.com" },
			{ email: "b@example.com" },
			{ email: "c@example.com" },
			piAuth,
		];
		const refreshUsageForAccount = vi.fn().mockResolvedValue(undefined);
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getAccounts: () => accounts,
			isPiAuthAccount: (account: { email: string }) => account === piAuth,
			getActiveAccount: () => accounts[0],
			getDisplayAccount: () => accounts[1],
			getCachedUsage: () => usage(10, 20),
			refreshUsageForAccount,
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-0",
			expect.stringContaining("b@example.com"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-1",
			expect.stringContaining("a@example.com"),
		);
		expect(refreshUsageForAccount).toHaveBeenCalledWith(accounts[1]);
		expect(refreshUsageForAccount).toHaveBeenCalledWith(accounts[0]);
		expect(refreshUsageForAccount).not.toHaveBeenCalledWith(accounts[2]);
		expect(refreshUsageForAccount).not.toHaveBeenCalledWith(piAuth);
	});

	it("falls back to storage order when the active account is pi auth", async () => {
		const setStatus = vi.fn();
		const piAuth = { email: "pi@example.com" };
		const accounts = [
			{ email: "a@example.com" },
			{ email: "b@example.com" },
			piAuth,
		];
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getAccounts: () => accounts,
			isPiAuthAccount: (account: { email: string }) => account === piAuth,
			getActiveAccount: () => piAuth,
			getCachedUsage: () => usage(10, 20),
			refreshUsageForAccount: vi.fn().mockResolvedValue(undefined),
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-0",
			expect.stringContaining("a@example.com"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-1",
			expect.stringContaining("b@example.com"),
		);
	});

	it("clears unused account slots and invalid contexts without touching the active-account cleanup", async () => {
		const setStatus = vi.fn();
		let accounts = [{ email: "a@example.com" }, { email: "b@example.com" }];
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getAccounts: () => accounts,
			isPiAuthAccount: () => false,
			getActiveAccount: () => accounts[0],
			getCachedUsage: () => usage(10, 20),
			refreshUsageForAccount: vi.fn().mockResolvedValue(undefined),
		} as never);
		const ctx = createContext({ setStatus });

		await controller.refreshFor(ctx);
		accounts = [{ email: "a@example.com" }];
		await controller.refreshFor(ctx);
		await controller.refreshFor(
			createContext({ provider: "anthropic", setStatus }),
		);
		controller.stopAutoRefresh(ctx);

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-1",
			undefined,
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-0",
			undefined,
		);
		expect(setStatus).toHaveBeenCalledWith("multicodex-usage", undefined);
	});

	it("keeps cached per-account widgets when one refresh fails while another updates", async () => {
		const setStatus = vi.fn();
		const accounts = [{ email: "a@example.com" }, { email: "b@example.com" }];
		const refreshUsageForAccount = vi
			.fn()
			.mockImplementation(async (account) => {
				if (account.email === "a@example.com") throw new Error("boom");
				return usage(5, 10);
			});
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getAccounts: () => accounts,
			isPiAuthAccount: () => false,
			getActiveAccount: () => accounts[1],
			getDisplayAccount: () => accounts[1],
			getCachedUsage: (email: string) =>
				email === "a@example.com" ? usage(30, 40) : usage(60, 70),
			refreshUsageForAccount,
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-0",
			expect.stringContaining("95% left"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-account-usage-1",
			expect.stringContaining("70% left"),
		);
	});

	it("does not let stale per-account refresh results overwrite a newer account selection", async () => {
		const setStatus = vi.fn();
		let accounts = [{ email: "a@example.com" }, { email: "b@example.com" }];
		let stateChangeHandler: (() => void) | undefined;
		const refreshUsageForAccount = vi
			.fn()
			.mockImplementation(async (account) => {
				if (account.email === "a@example.com") {
					accounts = [{ email: "b@example.com" }];
					stateChangeHandler?.();
				}
				return account.email === "a@example.com" ? usage(1, 2) : usage(5, 10);
			});
		const controller = createUsageStatusController({
			onStateChange: (handler: () => void) => {
				stateChangeHandler = handler;
				return () => undefined;
			},
			getAccounts: () => accounts,
			isPiAuthAccount: () => false,
			getActiveAccount: () => accounts[0],
			getCachedUsage: () => usage(50, 60),
			refreshUsageForAccount,
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenLastCalledWith(
			"multicodex-account-usage-0",
			expect.stringContaining("b@example.com"),
		);
		expect(setStatus).not.toHaveBeenCalledWith(
			"multicodex-account-usage-0",
			expect.stringContaining("a@example.com · 5h:99% left"),
		);
	});
});
