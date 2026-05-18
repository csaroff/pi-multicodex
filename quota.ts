export function isQuotaErrorMessage(message: string): boolean {
	return /\b429\b|quota|usage limits?|rate.?limit|too many requests|limits? reached/i.test(
		message,
	);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as Record<string, unknown>;
}

function parseNumeric(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAbsoluteReset(value: unknown): number | undefined {
	const numeric = parseNumeric(value);
	if (numeric !== undefined) {
		return numeric > 10_000_000_000 ? numeric : numeric * 1000;
	}

	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseResetAfter(value: unknown, now: number): number | undefined {
	const seconds = parseNumeric(value);
	if (seconds === undefined || seconds < 0) return undefined;
	return now + seconds * 1000;
}

function readHeader(headers: unknown, name: string): unknown {
	if (!headers) return undefined;
	if (typeof (headers as { get?: unknown }).get === "function") {
		return (headers as { get: (headerName: string) => unknown }).get(name);
	}
	const record = asRecord(headers);
	if (!record) return undefined;
	const target = name.toLowerCase();
	for (const [key, value] of Object.entries(record)) {
		if (key.toLowerCase() === target) return value;
	}
	return undefined;
}

function parseFriendlyReset(message: string, now: number): number | undefined {
	const match = message.match(
		/try again in\s*~?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i,
	);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount < 0) return undefined;
	const unit = match[2]?.toLowerCase() ?? "";
	const multiplier = unit.startsWith("h")
		? 60 * 60 * 1000
		: unit.startsWith("m")
			? 60 * 1000
			: 1000;
	return now + amount * multiplier;
}

function parseEmbeddedJson(message: string): unknown {
	const start = message.indexOf("{");
	const end = message.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		return JSON.parse(message.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

export function extractQuotaResetAt(
	quotaError: unknown,
	now = Date.now(),
): number | undefined {
	const candidates: number[] = [];
	const seen = new WeakSet<object>();

	const addCandidate = (value: number | undefined) => {
		if (typeof value === "number" && Number.isFinite(value) && value > now) {
			candidates.push(value);
		}
	};

	const visit = (value: unknown, depth = 0): void => {
		if (depth > 5 || value === undefined || value === null) return;

		if (typeof value === "string") {
			addCandidate(parseFriendlyReset(value, now));
			const embedded = parseEmbeddedJson(value);
			if (embedded !== undefined) visit(embedded, depth + 1);
			return;
		}

		const record = asRecord(value);
		if (!record) return;
		if (seen.has(record)) return;
		seen.add(record);

		addCandidate(parseAbsoluteReset(record.resets_at));
		addCandidate(parseResetAfter(record.resets_in_seconds, now));

		const headers = record.headers;
		addCandidate(
			parseAbsoluteReset(readHeader(headers, "X-Codex-Primary-Reset-At")),
		);
		addCandidate(
			parseResetAfter(
				readHeader(headers, "X-Codex-Primary-Reset-After-Seconds"),
				now,
			),
		);

		for (const key of ["message", "errorMessage", "body", "responseBody"]) {
			visit(record[key], depth + 1);
		}

		for (const nested of Object.values(record)) {
			visit(nested, depth + 1);
		}
	};

	visit(quotaError);
	return candidates[0];
}
