import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	currentProvider: undefined as unknown,
	getModels: vi.fn(() => []),
	mirrorProvider: vi.fn(() => ({ baseUrl: "https://codex.example" })),
}));

vi.mock("@earendil-works/pi-ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("@earendil-works/pi-ai")>()),
	getApiProvider: () => mocks.currentProvider,
	getModels: mocks.getModels,
}));

vi.mock("pi-provider-utils/providers", () => ({
	mirrorProvider: mocks.mirrorProvider,
}));

import type { AccountManager } from "./account-manager";
import {
	installMulticodexProviderWrapper,
	resetMulticodexProviderWrapperForTest,
} from "./provider";

function makeAccountManager(onActivate?: () => void): AccountManager {
	const account = {
		email: "managed@example.com",
		accessToken: "stored-token",
		refreshToken: "refresh",
		expiresAt: Date.now() + 60_000,
	};
	return {
		getActiveAccount: () => account,
		getAccounts: () => [account],
		waitUntilReady: async () => {},
		getAvailableManualAccount: () => undefined,
		hasManualAccount: () => false,
		clearManualAccount: () => {},
		activateBestAccount: async () => {
			onActivate?.();
			return account;
		},
		ensureValidToken: async () => "selected-token",
		handleQuotaExceeded: async () => {},
		setRuntimeActiveAccount: () => {},
	} as unknown as AccountManager;
}

function makeDelegate(name: string, calls: string[]) {
	return {
		streamSimple: (_model: unknown, _context: unknown, options?: unknown) => {
			calls.push(`${name}:${(options as { apiKey?: string })?.apiKey}`);
			async function* inner() {
				yield { type: "done" };
			}
			return inner() as never;
		},
	};
}

async function drain(providerConfig: unknown): Promise<void> {
	const stream = (
		providerConfig as {
			streamSimple: (
				model: unknown,
				context: unknown,
			) => AsyncIterable<unknown>;
		}
	).streamSimple(
		{ id: "test", provider: "openai-codex", api: "openai-codex-responses" },
		{},
	);
	for await (const _event of stream) {
		// drain
	}
}

describe("installMulticodexProviderWrapper", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetMulticodexProviderWrapperForTest();
		mocks.currentProvider = undefined;
	});

	afterEach(() => {
		resetMulticodexProviderWrapperForTest();
	});

	it("registers MultiCodex as the wrapper around the current Codex provider", async () => {
		const calls: string[] = [];
		mocks.currentProvider = makeDelegate("built-in", calls);
		const registerProvider = vi.fn((_id: string, config: unknown) => {
			mocks.currentProvider = config;
		});

		const config = installMulticodexProviderWrapper(
			{ registerProvider },
			makeAccountManager(),
		);

		expect(registerProvider).toHaveBeenCalledWith("openai-codex", config);
		await drain(config);
		expect(calls).toEqual(["built-in:selected-token"]);
	});

	it("wraps a later provider override instead of the stale built-in delegate", async () => {
		const calls: string[] = [];
		mocks.currentProvider = makeDelegate("built-in", calls);
		const registerProvider = vi.fn((_id: string, config: unknown) => {
			mocks.currentProvider = config;
		});
		installMulticodexProviderWrapper(
			{ registerProvider },
			makeAccountManager(),
		);

		mocks.currentProvider = makeDelegate("conversion", calls);
		const config = installMulticodexProviderWrapper(
			{ registerProvider },
			makeAccountManager(),
		);

		await drain(config);
		expect(calls).toEqual(["conversion:selected-token"]);
	});

	it("does not wrap MultiCodex around itself on repeated installation", async () => {
		const calls: string[] = [];
		let activateCount = 0;
		mocks.currentProvider = makeDelegate("built-in", calls);
		const registerProvider = vi.fn((_id: string, config: unknown) => {
			mocks.currentProvider = config;
		});

		installMulticodexProviderWrapper(
			{ registerProvider },
			makeAccountManager(),
		);
		const config = installMulticodexProviderWrapper(
			{ registerProvider },
			makeAccountManager(() => {
				activateCount += 1;
			}),
		);

		await drain(config);
		expect(calls).toEqual(["built-in:selected-token"]);
		expect(activateCount).toBe(1);
	});
});
