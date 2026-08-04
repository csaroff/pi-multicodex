export function isStaleExtensionContextError(error: unknown): boolean {
	const message =
		error && typeof error === "object" && "message" in error
			? error.message
			: undefined;
	return (
		typeof message === "string" &&
		/This extension (?:instance|ctx) is stale after session replacement or reload/.test(
			message,
		)
	);
}
