import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Model,
} from "@earendil-works/pi-ai";

export function normalizeUnknownError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return JSON.stringify(error);
}

export function createErrorAssistantMessage(
	model: Model<Api>,
	message: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: message,
		timestamp: Date.now(),
	};
}

export function rewriteProviderOnEvent(
	event: AssistantMessageEvent,
	provider: string,
): AssistantMessageEvent {
	if ("partial" in event) {
		return { ...event, partial: { ...event.partial, provider } };
	}
	if (event.type === "done") {
		return { ...event, message: { ...event.message, provider } };
	}
	if (event.type === "error") {
		return { ...event, error: { ...event.error, provider } };
	}
	return event;
}

export function createLinkedAbortController(
	signal?: AbortSignal,
): AbortController {
	const controller = new AbortController();
	if (signal?.aborted) controller.abort();
	else
		signal?.addEventListener("abort", () => controller.abort(), { once: true });
	return controller;
}

export function createTimeoutController(
	signal: AbortSignal | undefined,
	timeoutMs: number,
): { controller: AbortController; clear: () => void } {
	const controller = createLinkedAbortController(signal);
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	return { controller, clear: () => clearTimeout(timeout) };
}
