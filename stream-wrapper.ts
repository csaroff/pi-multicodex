import {
	type Api,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	createErrorAssistantMessage,
	createLinkedAbortController,
	normalizeUnknownError,
	rewriteProviderOnEvent,
} from "pi-provider-utils/streams";
import type { AccountManager } from "./account-manager";
import { isQuotaErrorMessage } from "./quota";

const MAX_ROTATION_RETRIES = 5;
const OPENAI_CODEX_RESPONSES_MODULE =
	"@earendil-works/pi-ai/openai-codex-responses";

type CloseCodexWebSocketSessions = (sessionId?: string) => void | Promise<void>;

const importModule = new Function("specifier", "return import(specifier)") as (
	specifier: string,
) => Promise<unknown>;

let closeCodexWebSocketSessionsForTest: CloseCodexWebSocketSessions | undefined;
let warnedWebSocketCleanupFailure = false;

export function setCloseCodexWebSocketSessionsForTest(
	handler: CloseCodexWebSocketSessions | undefined,
): void {
	closeCodexWebSocketSessionsForTest = handler;
}

async function closeCachedCodexWebSocketSession(
	sessionId: string | undefined,
): Promise<void> {
	if (!sessionId) return;
	if (closeCodexWebSocketSessionsForTest) {
		await closeCodexWebSocketSessionsForTest(sessionId);
		return;
	}

	try {
		const mod = (await importModule(OPENAI_CODEX_RESPONSES_MODULE)) as {
			closeOpenAICodexWebSocketSessions?: CloseCodexWebSocketSessions;
		};
		await mod.closeOpenAICodexWebSocketSessions?.(sessionId);
	} catch (error) {
		if (warnedWebSocketCleanupFailure) return;
		warnedWebSocketCleanupFailure = true;
		console.warn(
			`Multicodex: failed to close cached Codex WebSocket session: ${normalizeUnknownError(error)}`,
		);
	}
}

type ApiProviderRef = {
	streamSimple: (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
};

function isRetrySafePreOutputEvent(event: AssistantMessageEvent): boolean {
	return (
		event.type === "start" ||
		event.type === "text_start" ||
		event.type === "thinking_start" ||
		event.type === "toolcall_start"
	);
}

export function createStreamWrapper(
	accountManager: AccountManager,
	baseProvider: ApiProviderRef,
) {
	return (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const stream = createAssistantMessageEventStream();

		(async () => {
			try {
				await accountManager.waitUntilReady();
				const excludedEmails = new Set<string>();
				for (let attempt = 0; attempt <= MAX_ROTATION_RETRIES; attempt++) {
					const now = Date.now();
					const manual = accountManager.getAvailableManualAccount({
						excludeEmails: excludedEmails,
						now,
					});
					const usingManual = Boolean(manual);
					let account = manual;
					if (!account) {
						if (accountManager.hasManualAccount()) {
							accountManager.clearManualAccount();
						}
						account = await accountManager.activateBestAccount({
							excludeEmails: excludedEmails,
							signal: options?.signal,
						});
					}
					if (!account) {
						throw new Error(
							"No available Multicodex accounts. Please use /multicodex use <identifier>.",
						);
					}

					let token: string;
					try {
						token = await accountManager.ensureValidToken(account);
					} catch (error) {
						accountManager.notifyRotationSkipForAuthFailure(account, error);
						if (usingManual) {
							accountManager.clearManualAccount();
						}
						excludedEmails.add(account.email);
						if (attempt < MAX_ROTATION_RETRIES) {
							continue;
						}
						throw error;
					}
					accountManager.setRuntimeActiveAccount?.(account.email);
					// The upstream Codex provider caches WebSocket sessions by sessionId.
					// If a session was opened with a different Codex account, passing a new
					// apiKey is not enough: the cached socket can keep using the old account.
					// Close it before each managed stream so the selected Multicodex account is
					// the one that authenticates the next Codex connection.
					await closeCachedCodexWebSocketSession(options?.sessionId);
					const abortController = createLinkedAbortController(options?.signal);

					const internalModel: Model<"openai-codex-responses"> = {
						...(model as Model<"openai-codex-responses">),
						provider: "openai-codex",
						api: "openai-codex-responses",
					};

					const inner = baseProvider.streamSimple(
						{
							...internalModel,
							headers: {
								...(internalModel.headers || {}),
								"X-Multicodex-Account": account.email,
							},
						},
						context,
						{
							...options,
							apiKey: token,
							signal: abortController.signal,
						},
					);

					let outputStarted = false;
					const bufferedPreOutputEvents: AssistantMessageEvent[] = [];
					let retry = false;
					const flushBufferedPreOutputEvents = () => {
						for (const bufferedEvent of bufferedPreOutputEvents) {
							stream.push(
								rewriteProviderOnEvent(bufferedEvent, model.provider),
							);
						}
						bufferedPreOutputEvents.length = 0;
					};
					const rotateAfterQuota = async (quotaError: unknown) => {
						try {
							await accountManager.handleQuotaExceeded(account, {
								quotaError,
								signal: options?.signal,
							});
						} catch (error) {
							if (!isQuotaErrorMessage(normalizeUnknownError(error))) {
								throw error;
							}
						}
						if (usingManual) {
							accountManager.clearManualAccount();
						}
						excludedEmails.add(account.email);
						abortController.abort();
						retry = true;
					};

					try {
						for await (const event of inner) {
							if (!outputStarted && isRetrySafePreOutputEvent(event)) {
								bufferedPreOutputEvents.push(event);
								continue;
							}

							if (event.type === "error") {
								const msg = event.error.errorMessage || "";
								const isQuota = isQuotaErrorMessage(msg);

								if (
									isQuota &&
									!outputStarted &&
									attempt < MAX_ROTATION_RETRIES
								) {
									await rotateAfterQuota(event.error);
									break;
								}

								flushBufferedPreOutputEvents();
								stream.push(rewriteProviderOnEvent(event, model.provider));
								stream.end();
								return;
							}

							flushBufferedPreOutputEvents();
							if (event.type !== "done") {
								outputStarted = true;
							}
							stream.push(rewriteProviderOnEvent(event, model.provider));

							if (event.type === "done") {
								stream.end();
								return;
							}
						}
					} catch (error) {
						const isQuota = isQuotaErrorMessage(normalizeUnknownError(error));

						if (isQuota && !outputStarted && attempt < MAX_ROTATION_RETRIES) {
							await rotateAfterQuota(error);
						} else {
							flushBufferedPreOutputEvents();
							throw error;
						}
					}

					if (retry) {
						continue;
					}

					stream.end();
					return;
				}
			} catch (error) {
				const message = normalizeUnknownError(error);
				const errorEvent: AssistantMessageEvent = {
					type: "error",
					reason: "error",
					error: createErrorAssistantMessage(
						model,
						`Multicodex failed: ${message}`,
					),
				};
				stream.push(rewriteProviderOnEvent(errorEvent, model.provider));
				stream.end();
			}
		})();

		return stream;
	};
}
