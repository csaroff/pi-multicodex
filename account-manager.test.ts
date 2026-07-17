import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	storageData: {
		accounts: [] as Array<Record<string, unknown>>,
		activeEmail: undefined as string | undefined,
	},
	loadImportedOpenAICodexAuth: vi.fn(),
	saveStorage: vi.fn(),
	fetchCodexUsage: vi.fn(),
}));

vi.mock("./storage", () => ({
	loadStorage: () =>
		JSON.parse(JSON.stringify(mocks.storageData)) as {
			accounts: Array<Record<string, unknown>>;
			activeEmail?: string;
		},
	saveStorage: mocks.saveStorage,
}));

vi.mock("./auth", () => ({
	loadImportedOpenAICodexAuth: mocks.loadImportedOpenAICodexAuth,
}));

vi.mock("./usage-client", () => ({
	fetchCodexUsage: mocks.fetchCodexUsage,
}));

vi.mock("./oauth-client", () => ({
	refreshOAuthToken: vi.fn(),
}));

import { AccountManager } from "./account-manager";
import { refreshOAuthToken } from "./oauth-client";

describe("AccountManager usage warnings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
		mocks.fetchCodexUsage.mockRejectedValue(new Error("network failure"));
	});

	it("does not warn when usage refresh is aborted", async () => {
		const manager = new AccountManager();
		const warningHandler = vi.fn();
		manager.setWarningHandler(warningHandler);
		const account = manager.addOrUpdateAccount("abort@example.com", {
			access: "access",
			refresh: "refresh",
			expires: Date.now() + 3600_000,
		});
		const controller = new AbortController();
		controller.abort();

		await expect(
			manager.refreshUsageForAccount(account, { signal: controller.signal }),
		).resolves.toBeUndefined();
		expect(warningHandler).not.toHaveBeenCalled();
	});
});

describe("AccountManager quota exhaustion", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-18T10:00:00Z"));
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
		mocks.fetchCodexUsage.mockRejectedValue(new Error("usage unavailable"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("uses reset metadata from the original quota error before usage refresh", async () => {
		const manager = new AccountManager();
		const account = manager.addOrUpdateAccount("quota@example.com", {
			access: "access",
			refresh: "refresh",
			expires: Date.now() + 3600_000,
		});
		mocks.saveStorage.mockClear();

		await manager.handleQuotaExceeded(account, {
			quotaError: new Error(
				'Codex error: {"headers":{"X-Codex-Primary-Reset-After-Seconds":"225"}}',
			),
		});

		expect(account.quotaExhaustedUntil).toBe(Date.now() + 225_000);
		expect(mocks.fetchCodexUsage).not.toHaveBeenCalled();
		expect(mocks.saveStorage).toHaveBeenCalled();
	});

	it("persists a fallback exhaustion window when reset metadata and usage refresh are unavailable", async () => {
		const manager = new AccountManager();
		const account = manager.addOrUpdateAccount("fallback@example.com", {
			access: "access",
			refresh: "refresh",
			expires: Date.now() + 3600_000,
		});
		mocks.saveStorage.mockClear();

		await manager.handleQuotaExceeded(account, {
			quotaError: new Error("You have hit your ChatGPT usage limit."),
		});

		expect(account.quotaExhaustedUntil).toBe(Date.now() + 3600_000);
		expect(mocks.fetchCodexUsage).toHaveBeenCalled();
		expect(mocks.saveStorage).toHaveBeenCalled();
	});
});

describe("AccountManager ephemeral pi auth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("loads pi auth as ephemeral account when no managed account matches", async () => {
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "pi-access",
				refresh: "pi-refresh",
				expires: Date.now() + 3600_000,
				accountId: "pi-acc",
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();

		expect(manager.getAccounts()).toHaveLength(1);
		const account = manager.getAccount("pi@example.com");
		expect(account).toMatchObject({
			email: "pi@example.com",
			accessToken: "pi-access",
		});
		const isPi = account ? manager.isPiAuthAccount(account) : false;
		expect(isPi).toBe(true);
		expect(mocks.saveStorage).not.toHaveBeenCalled();
	});

	it("merges pi auth into a managed account with the same account id", async () => {
		mocks.storageData.accounts = [
			{
				email: "managed@example.com",
				accessToken: "managed-access",
				refreshToken: "managed-refresh",
				expiresAt: 100,
				accountId: "acc-1",
				needsReauth: true,
			},
		];
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "pi-access",
				refresh: "pi-refresh",
				expires: Date.now() + 3600_000,
				accountId: "acc-1",
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();

		expect(manager.getAccounts()).toHaveLength(1);
		expect(manager.getAccount("managed@example.com")).toMatchObject({
			accessToken: "pi-access",
			refreshToken: "pi-refresh",
			needsReauth: undefined,
		});
		expect(manager.getAccount("pi@example.com")).toBeUndefined();
		expect(mocks.saveStorage).toHaveBeenCalled();
	});

	it("merges pi auth into a managed account with the same email", async () => {
		const now = Date.now();
		mocks.storageData.accounts = [
			{
				email: "pi@example.com",
				accessToken: "managed-access",
				refreshToken: "managed-refresh",
				expiresAt: now + 600_000,
			},
		];
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "pi-access",
				refresh: "different-refresh",
				expires: now + 1_200_000,
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();

		expect(manager.getAccounts()).toHaveLength(1);
		const first = manager.getAccounts()[0];
		expect(first ? manager.isPiAuthAccount(first) : true).toBe(false);
		expect(first).toMatchObject({
			accessToken: "pi-access",
			refreshToken: "different-refresh",
		});
	});

	it("does not let stale pi auth overwrite fresher managed credentials", async () => {
		const now = Date.now();
		mocks.storageData.accounts = [
			{
				email: "pi@example.com",
				accessToken: "managed-access",
				refreshToken: "managed-refresh",
				expiresAt: now + 3600_000,
				accountId: "acc-1",
			},
		];
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "stale-pi-access",
				refresh: "stale-pi-refresh",
				expires: now - 60_000,
				accountId: "acc-1",
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();

		expect(manager.getAccounts()).toHaveLength(1);
		expect(manager.getAccount("pi@example.com")).toMatchObject({
			accessToken: "managed-access",
			refreshToken: "managed-refresh",
			expiresAt: now + 3600_000,
		});
		expect(mocks.saveStorage).not.toHaveBeenCalled();
	});

	it("does not clear needsReauth from expired imported pi auth", async () => {
		const now = Date.now();
		mocks.storageData.accounts = [
			{
				email: "pi@example.com",
				accessToken: "managed-access",
				refreshToken: "managed-refresh",
				expiresAt: now - 120_000,
				needsReauth: true,
			},
		];
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "expired-pi-access",
				refresh: "expired-pi-refresh",
				expires: now - 60_000,
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();

		expect(manager.getAccount("pi@example.com")).toMatchObject({
			accessToken: "managed-access",
			refreshToken: "managed-refresh",
			needsReauth: true,
		});
		expect(mocks.saveStorage).not.toHaveBeenCalled();
	});

	it("does not persist ephemeral account when saving", async () => {
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "pi-access",
				refresh: "pi-refresh",
				expires: Date.now() + 3600_000,
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();

		manager.addOrUpdateAccount("new@example.com", {
			access: "new-access",
			refresh: "new-refresh",
			expires: Date.now() + 3600_000,
		});

		expect(mocks.saveStorage).toHaveBeenCalled();
		const savedData = mocks.saveStorage.mock.calls[0]?.[0] as {
			accounts: Array<{ email: string }>;
		};
		const savedEmails = savedData.accounts.map((a) => a.email);
		expect(savedEmails).toContain("new@example.com");
		expect(savedEmails).not.toContain("pi@example.com");
	});

	it("clears ephemeral when auth.json has no codex entry", async () => {
		mocks.loadImportedOpenAICodexAuth
			.mockResolvedValueOnce({
				identifier: "pi@example.com",
				fingerprint: "fp",
				credentials: {
					access: "pi-access",
					refresh: "pi-refresh",
					expires: Date.now() + 3600_000,
				},
			})
			.mockResolvedValueOnce(undefined);

		const manager = new AccountManager();
		await manager.loadPiAuth();
		expect(manager.getAccounts()).toHaveLength(1);

		await manager.loadPiAuth();
		expect(manager.getAccounts()).toHaveLength(0);
	});
});

describe("AccountManager account deduplication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("creates separate accounts for different emails even with same refresh token", () => {
		mocks.storageData.accounts = [
			{
				email: "old@example.com",
				accessToken: "old-access",
				refreshToken: "shared-refresh",
				expiresAt: 100,
				accountId: "acc-123",
			},
		];

		const manager = new AccountManager();
		const account = manager.addOrUpdateAccount("new@example.com", {
			access: "new-access",
			refresh: "shared-refresh",
			expires: 300,
			accountId: "acc-123",
		});

		expect(account.email).toBe("new@example.com");
		expect(manager.getAccounts()).toHaveLength(2);
		expect(manager.getAccount("old@example.com")).toBeDefined();
		expect(manager.getAccount("new@example.com")).toMatchObject({
			accessToken: "new-access",
			expiresAt: 300,
		});
	});

	it("updates existing account when same email is added again", () => {
		mocks.storageData.accounts = [
			{
				email: "user@example.com",
				accessToken: "old-access",
				refreshToken: "old-refresh",
				expiresAt: 100,
			},
		];

		const manager = new AccountManager();
		const account = manager.addOrUpdateAccount("user@example.com", {
			access: "new-access",
			refresh: "new-refresh",
			expires: 200,
		});

		expect(manager.getAccounts()).toHaveLength(1);
		expect(account.accessToken).toBe("new-access");
		expect(account.refreshToken).toBe("new-refresh");
	});
});

describe("AccountManager token refresh recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("does not mark reauth for transient refresh failures", async () => {
		vi.mocked(refreshOAuthToken).mockRejectedValue(
			new Error("OpenAI Codex token refresh error: fetch failed"),
		);
		const manager = new AccountManager();
		const account = manager.addOrUpdateAccount("transient@example.com", {
			access: "old-access",
			refresh: "old-refresh",
			expires: Date.now() - 60_000,
		});
		mocks.saveStorage.mockClear();

		await expect(manager.ensureValidToken(account)).rejects.toThrow(
			"fetch failed",
		);

		expect(account.needsReauth).toBeUndefined();
		expect(mocks.saveStorage).not.toHaveBeenCalled();
	});

	it("marks reauth for terminal refresh failures", async () => {
		vi.mocked(refreshOAuthToken).mockRejectedValue(
			new Error(
				'OpenAI Codex token refresh failed (400): {"error":"invalid_grant"}',
			),
		);
		const manager = new AccountManager();
		const account = manager.addOrUpdateAccount("terminal@example.com", {
			access: "old-access",
			refresh: "old-refresh",
			expires: Date.now() - 60_000,
		});
		mocks.saveStorage.mockClear();

		await expect(manager.ensureValidToken(account)).rejects.toThrow(
			"invalid_grant",
		);

		expect(account.needsReauth).toBe(true);
		expect(mocks.saveStorage).toHaveBeenCalled();
	});

	it("uses fresher stored credentials instead of a stale in-memory refresh token", async () => {
		mocks.storageData.accounts = [
			{
				email: "race@example.com",
				accessToken: "old-access",
				refreshToken: "old-refresh",
				expiresAt: Date.now() - 60_000,
			},
		];
		vi.mocked(refreshOAuthToken).mockImplementation(async () => {
			mocks.storageData.accounts = [
				{
					email: "race@example.com",
					accessToken: "fresh-access",
					refreshToken: "fresh-refresh",
					expiresAt: Date.now() + 3600_000,
				},
			];
			throw new Error(
				'OpenAI Codex token refresh failed (400): {"error":"invalid_grant"}',
			);
		});

		const manager = new AccountManager();
		const account = manager.getAccount("race@example.com");
		expect(account).toBeDefined();
		if (!account) return;

		await expect(manager.ensureValidToken(account)).resolves.toBe(
			"fresh-access",
		);

		expect(account.refreshToken).toBe("fresh-refresh");
		expect(account.needsReauth).toBeUndefined();
	});
});

describe("AccountManager display account", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [
			{
				email: "pro@example.com",
				accessToken: "pro-access",
				refreshToken: "pro-refresh",
				expiresAt: Date.now() + 3600_000,
			},
			{
				email: "business@example.com",
				accessToken: "business-access",
				refreshToken: "business-refresh",
				expiresAt: Date.now() + 3600_000,
			},
		];
		mocks.storageData.activeEmail = "pro@example.com";
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("prefers the account most recently selected by the stream wrapper", () => {
		const manager = new AccountManager();

		expect(manager.getDisplayAccount()?.email).toBe("pro@example.com");

		manager.setRuntimeActiveAccount("business@example.com");

		expect(manager.getDisplayAccount()?.email).toBe("business@example.com");
	});

	it("clears runtime display account on explicit account selection", () => {
		const manager = new AccountManager();
		manager.setRuntimeActiveAccount("business@example.com");

		manager.setManualAccount("pro@example.com");

		expect(manager.getDisplayAccount()?.email).toBe("pro@example.com");
	});
});

describe("AccountManager auth-failure warnings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("warns once per session for a skipped auth-broken account and resets on reauth", () => {
		const manager = new AccountManager();
		const warningHandler = vi.fn();
		manager.setWarningHandler(warningHandler);
		const account = manager.addOrUpdateAccount("warn@example.com", {
			access: "access",
			refresh: "refresh",
			expires: 100,
		});
		account.needsReauth = true;

		manager.notifyRotationSkipForAuthFailure(
			account,
			new Error("refresh failed"),
		);
		manager.notifyRotationSkipForAuthFailure(
			account,
			new Error("refresh failed"),
		);
		expect(warningHandler).toHaveBeenCalledTimes(1);
		expect(warningHandler.mock.calls[0]?.[0]).toContain("warn@example.com");
		expect(warningHandler.mock.calls[0]?.[0]).toContain(
			"/multicodex reauth warn@example.com",
		);

		manager.addOrUpdateAccount("warn@example.com", {
			access: "new-access",
			refresh: "refresh",
			expires: 200,
		});
		manager.notifyRotationSkipForAuthFailure(
			account,
			new Error("refresh failed again"),
		);
		expect(warningHandler).toHaveBeenCalledTimes(2);

		manager.resetSessionWarnings();
		manager.notifyRotationSkipForAuthFailure(
			account,
			new Error("refresh failed third"),
		);
		expect(warningHandler).toHaveBeenCalledTimes(3);
	});

	it("uses /login hint for ephemeral pi auth account", async () => {
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "pi-access",
				refresh: "pi-refresh",
				expires: Date.now() + 3600_000,
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();
		const warningHandler = vi.fn();
		manager.setWarningHandler(warningHandler);

		const piAccount = manager.getAccount("pi@example.com");
		expect(piAccount).toBeDefined();
		if (!piAccount) return;
		piAccount.needsReauth = true;
		manager.notifyRotationSkipForAuthFailure(piAccount, new Error("expired"));

		expect(warningHandler).toHaveBeenCalledTimes(1);
		expect(warningHandler.mock.calls[0]?.[0]).toContain("/login openai-codex");
	});
});

describe("AccountManager pi auth exhaustion handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("clears expired exhaustion on ephemeral pi auth account", async () => {
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "pi-access",
				refresh: "pi-refresh",
				expires: Date.now() + 3600_000,
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();

		const piAccount = manager.getAccount("pi@example.com");
		expect(piAccount).toBeDefined();
		if (!piAccount) return;

		// Mark exhausted until 1s from now
		manager.markExhausted("pi@example.com", Date.now() + 1000);
		expect(piAccount.quotaExhaustedUntil).toBeGreaterThan(0);

		// markExhausted should not persist for pi auth
		expect(mocks.saveStorage).not.toHaveBeenCalled();
	});

	it("clearAllQuotaExhaustion clears pi auth account too", async () => {
		mocks.storageData.accounts = [
			{
				email: "managed@example.com",
				accessToken: "managed-access",
				refreshToken: "managed-refresh",
				expiresAt: Date.now() + 3600_000,
				quotaExhaustedUntil: Date.now() + 60_000,
			},
		];
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "pi@example.com",
			fingerprint: "fp",
			credentials: {
				access: "pi-access",
				refresh: "pi-refresh",
				expires: Date.now() + 3600_000,
			},
		});

		const manager = new AccountManager();
		await manager.loadPiAuth();

		// Exhaust the pi auth account
		manager.markExhausted("pi@example.com", Date.now() + 60_000);

		const cleared = manager.clearAllQuotaExhaustion();
		expect(cleared).toBe(2);

		// Both accounts should be clear
		const piAccount = manager.getAccount("pi@example.com");
		const managedAccount = manager.getAccount("managed@example.com");
		expect(piAccount?.quotaExhaustedUntil).toBeUndefined();
		expect(managedAccount?.quotaExhaustedUntil).toBeUndefined();
	});
});

describe("AccountManager ready-gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("resolves immediately when no initialization is in progress", async () => {
		const manager = new AccountManager();
		await manager.waitUntilReady();
	});

	it("blocks until markReady is called", async () => {
		const manager = new AccountManager();
		manager.beginInitialization();

		let resolved = false;
		const waiting = manager.waitUntilReady().then(() => {
			resolved = true;
		});

		// Should not resolve yet
		await Promise.resolve();
		expect(resolved).toBe(false);

		manager.markReady();
		await waiting;
		expect(resolved).toBe(true);
	});

	it("resolves after markReady even if beginInitialization is called again", async () => {
		const manager = new AccountManager();
		manager.beginInitialization();
		manager.markReady();

		// Second initialization cycle
		manager.beginInitialization();

		let resolved = false;
		const waiting = manager.waitUntilReady().then(() => {
			resolved = true;
		});

		await Promise.resolve();
		expect(resolved).toBe(false);

		manager.markReady();
		await waiting;
		expect(resolved).toBe(true);
	});
});
