import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	getApiProvider,
	getModels,
	type Model,
	type SimpleStreamOptions,
	type ThinkingLevelMap,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mirrorProvider } from "pi-provider-utils/providers";
import type { AccountManager } from "./account-manager";
import { createStreamWrapper } from "./stream-wrapper";

export const PROVIDER_ID = "openai-codex";
const CODEX_RESPONSES_API = "openai-codex-responses";
const MULTICODEX_PROVIDER_MARKER = Symbol.for("pi-multicodex.provider");

type ApiProviderRef = {
	streamSimple: (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
};

type ProviderRegistration = Pick<ExtensionAPI, "registerProvider">;

let activeMulticodexProvider: ApiProviderRef | undefined;
let activeDelegateProvider: ApiProviderRef | undefined;

export interface ProviderModelDef {
	id: string;
	name: string;
	reasoning: boolean;
	thinkingLevelMap?: ThinkingLevelMap;
	input: ("text" | "image")[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
}

export function getOpenAICodexMirror(): {
	baseUrl: string;
	models: ProviderModelDef[];
} {
	const mirror = mirrorProvider("openai-codex");
	const sourceModels = getModels("openai-codex");
	if (!mirror || sourceModels.length === 0) {
		return { baseUrl: "https://chatgpt.com/backend-api", models: [] };
	}
	return {
		baseUrl: mirror.baseUrl,
		models: sourceModels.map((m) => ({
			id: m.id,
			name: m.name,
			reasoning: m.reasoning,
			thinkingLevelMap: m.thinkingLevelMap
				? { ...m.thinkingLevelMap }
				: undefined,
			input: [...m.input],
			cost: { ...m.cost },
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
		})),
	};
}

function getActiveApiKey(accountManager: AccountManager): string {
	const active = accountManager.getActiveAccount();
	if (active && !active.needsReauth) {
		return active.accessToken;
	}
	// Fallback: first available account with a valid token.
	for (const account of accountManager.getAccounts()) {
		if (!account.needsReauth && account.accessToken) {
			return account.accessToken;
		}
	}
	// Fallback placeholder until MultiCodex resolves a usable managed account.
	return "pending-login";
}

function isMulticodexProvider(provider: unknown): boolean {
	return Boolean(
		provider &&
			typeof provider === "object" &&
			(provider === activeMulticodexProvider ||
				(provider as Record<symbol, unknown>)[MULTICODEX_PROVIDER_MARKER]),
	);
}

function getDelegateProvider(): ApiProviderRef {
	const currentProvider = getApiProvider(CODEX_RESPONSES_API) as
		| ApiProviderRef
		| undefined;
	if (!currentProvider) {
		throw new Error(
			"OpenAI Codex provider not available. Please update pi to include openai-codex support.",
		);
	}

	if (isMulticodexProvider(currentProvider)) {
		if (!activeDelegateProvider) {
			throw new Error(
				"Multicodex provider wrapper is active but no Codex delegate provider is available.",
			);
		}
		return activeDelegateProvider;
	}

	return currentProvider;
}

export function buildMulticodexProviderConfig(
	accountManager: AccountManager,
	baseProvider: ApiProviderRef = getDelegateProvider(),
) {
	const mirror = getOpenAICodexMirror();
	if (!baseProvider) {
		throw new Error(
			"OpenAI Codex provider not available. Please update pi to include openai-codex support.",
		);
	}

	const config = {
		baseUrl: mirror.baseUrl,
		apiKey: getActiveApiKey(accountManager),
		api: CODEX_RESPONSES_API,
		streamSimple: createStreamWrapper(accountManager, baseProvider),
		models: mirror.models,
	};

	Object.defineProperty(config, MULTICODEX_PROVIDER_MARKER, {
		value: true,
	});

	return config;
}

export function installMulticodexProviderWrapper(
	pi: ProviderRegistration,
	accountManager: AccountManager,
) {
	const delegateProvider = getDelegateProvider();
	const providerConfig = buildMulticodexProviderConfig(
		accountManager,
		delegateProvider,
	);
	pi.registerProvider(PROVIDER_ID, providerConfig);
	activeDelegateProvider = delegateProvider;
	activeMulticodexProvider = providerConfig;
	return providerConfig;
}

export function resetMulticodexProviderWrapperForTest(): void {
	activeMulticodexProvider = undefined;
	activeDelegateProvider = undefined;
}
