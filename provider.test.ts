import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	getOpenAICodexMirror,
	installMulticodexProviderWrapper,
	resetMulticodexProviderWrapperForTest,
} from "./provider";

let previousAgentDir: string | undefined;
let agentDir: string;

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
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		agentDir = mkdtempSync(join(tmpdir(), "pi-multicodex-test-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
		vi.clearAllMocks();
		resetMulticodexProviderWrapperForTest();
		mocks.currentProvider = undefined;
	});

	afterEach(() => {
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
		rmSync(agentDir, { recursive: true, force: true });
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

describe("getOpenAICodexMirror", () => {
	beforeEach(() => {
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		agentDir = mkdtempSync(join(tmpdir(), "pi-multicodex-test-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
		vi.clearAllMocks();
		mocks.mirrorProvider.mockReturnValue({ baseUrl: "https://codex.example" });
	});

	afterEach(() => {
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("applies openai-codex modelOverrides from models.json", () => {
		mocks.getModels.mockReturnValue([
			{
				id: "codex-test",
				name: "Codex Test",
				reasoning: true,
				thinkingLevelMap: { medium: "medium", high: "high" },
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
				contextWindow: 100,
				maxTokens: 10,
				headers: { "x-source": "source", "x-override": "source" },
				compat: { sendSessionIdHeader: false },
			},
		]);
		writeFileSync(
			join(agentDir, "models.json"),
			`{
				// Pi accepts comments in models.json.
				"providers": {
					"openai-codex": {
						"modelOverrides": {
							"codex-test": {
								"name": "Custom Codex Test",
								"reasoning": false,
								"thinkingLevelMap": { "high": "custom-high", "xhigh": null, },
								"input": ["text", "image"],
								"cost": { "output": 20, },
								"contextWindow": 200,
								"maxTokens": 25,
								"headers": { "x-override": "override", "x-added": "added", },
								"compat": { "supportsLongCacheRetention": true, },
							},
						},
					},
				},
			}`,
		);

		expect(getOpenAICodexMirror()).toEqual({
			baseUrl: "https://codex.example",
			models: [
				{
					id: "codex-test",
					name: "Custom Codex Test",
					reasoning: false,
					thinkingLevelMap: {
						medium: "medium",
						high: "custom-high",
						xhigh: null,
					},
					input: ["text", "image"],
					cost: { input: 1, output: 20, cacheRead: 3, cacheWrite: 4 },
					contextWindow: 200,
					maxTokens: 25,
					headers: {
						"x-source": "source",
						"x-override": "override",
						"x-added": "added",
					},
					compat: {
						sendSessionIdHeader: false,
						supportsLongCacheRetention: true,
					},
				},
			],
		});
	});

	it("ignores malformed models.json and keeps mirrored models", () => {
		mocks.getModels.mockReturnValue([
			{
				id: "codex-test",
				name: "Codex Test",
				reasoning: true,
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
				contextWindow: 100,
				maxTokens: 10,
			},
		]);
		writeFileSync(join(agentDir, "models.json"), "{not json");

		expect(getOpenAICodexMirror().models).toEqual([
			{
				id: "codex-test",
				name: "Codex Test",
				reasoning: true,
				thinkingLevelMap: undefined,
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
				contextWindow: 100,
				maxTokens: 10,
			},
		]);
	});

	it("ignores invalid modelOverride field shapes and keeps mirrored defaults", () => {
		mocks.getModels.mockReturnValue([
			{
				id: "codex-test",
				name: "Codex Test",
				reasoning: true,
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
				contextWindow: 100,
				maxTokens: 10,
				headers: { "x-source": "source" },
				compat: { sendSessionIdHeader: false },
			},
		]);
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					"openai-codex": {
						modelOverrides: {
							"codex-test": {
								name: 123,
								reasoning: "false",
								thinkingLevelMap: [],
								input: {},
								cost: [],
								contextWindow: "200",
								maxTokens: null,
								headers: [],
								compat: {
									sendSessionIdHeader: "false",
									supportsLongCacheRetention: "true",
								},
							},
						},
					},
				},
			}),
		);

		expect(getOpenAICodexMirror().models).toEqual([
			{
				id: "codex-test",
				name: "Codex Test",
				reasoning: true,
				thinkingLevelMap: undefined,
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
				contextWindow: 100,
				maxTokens: 10,
				headers: { "x-source": "source" },
				compat: { sendSessionIdHeader: false },
			},
		]);
	});
});
