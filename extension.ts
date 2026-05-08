import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { AccountManager } from "./account-manager";
import { registerCommands } from "./commands";
import { handleNewSessionSwitch, handleSessionStart } from "./hooks";
import { buildMulticodexProviderConfig, PROVIDER_ID } from "./provider";
import { createUsageStatusController } from "./status";

export default function multicodexExtension(pi: ExtensionAPI) {
	const accountManager = new AccountManager();
	const statusController = createUsageStatusController(accountManager);
	let lastContext: ExtensionContext | undefined;

	function isStaleContextError(error: unknown): boolean {
		return (
			error instanceof Error &&
			/This extension (?:instance|ctx) is stale after session replacement or reload/.test(
				error.message,
			)
		);
	}

	function notifyWarning(
		ctx: ExtensionContext | undefined,
		message: string,
	): void {
		if (!ctx) return;
		try {
			ctx.ui.notify(message, "warning");
		} catch (error) {
			if (isStaleContextError(error)) {
				if (lastContext === ctx) lastContext = undefined;
				return;
			}
			throw error;
		}
	}

	accountManager.setWarningHandler((message) => {
		notifyWarning(lastContext, message);
	});

	pi.registerProvider(
		PROVIDER_ID,
		buildMulticodexProviderConfig(accountManager) as unknown as Parameters<
			typeof pi.registerProvider
		>[1],
	);

	registerCommands(pi, accountManager, statusController);

	pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
		lastContext = ctx;
		accountManager.resetSessionWarnings();
		handleSessionStart(accountManager, (msg) => notifyWarning(ctx, msg));
		if (event.reason === "new") {
			handleNewSessionSwitch(accountManager, (msg) => notifyWarning(ctx, msg));
		}
		statusController.startAutoRefresh();
		void (async () => {
			await statusController.loadPreferences(ctx);
			await statusController.refreshFor(ctx);
		})();
	});

	pi.on("turn_end", (_event: unknown, ctx: ExtensionContext) => {
		lastContext = ctx;
		void statusController.refreshFor(ctx);
	});

	pi.on("model_select", (_event: unknown, ctx: ExtensionContext) => {
		lastContext = ctx;
		statusController.scheduleModelSelectRefresh(ctx);
	});

	pi.on("session_shutdown", (_event: unknown, ctx: ExtensionContext) => {
		if (lastContext === ctx) {
			lastContext = undefined;
		}
		statusController.stopAutoRefresh(ctx);
	});
}
