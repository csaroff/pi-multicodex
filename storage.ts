import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentPath } from "./agent-paths";

const CURRENT_VERSION = 1;

const SCHEMA_URL =
	"https://raw.githubusercontent.com/victor-software-house/pi-multicodex/main/schemas/codex-accounts.schema.json";

export interface Account {
	email: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	accountId?: string;
	lastUsed?: number;
	quotaExhaustedUntil?: number;
	needsReauth?: boolean;
}

export interface StorageData {
	$schema?: string;
	version: number;
	accounts: Account[];
	activeEmail?: string;
	manualEmail?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): boolean {
	return record[key] === undefined || typeof record[key] === "string";
}

function optionalNumber(record: Record<string, unknown>, key: string): boolean {
	return record[key] === undefined || typeof record[key] === "number";
}

function parseAccount(value: unknown): Account | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.email !== "string" || value.email.length === 0)
		return undefined;
	if (typeof value.accessToken !== "string" || value.accessToken.length === 0)
		return undefined;
	if (typeof value.refreshToken !== "string" || value.refreshToken.length === 0)
		return undefined;
	if (typeof value.expiresAt !== "number") return undefined;
	if (!optionalString(value, "accountId")) return undefined;
	if (
		!optionalNumber(value, "lastUsed") ||
		!optionalNumber(value, "quotaExhaustedUntil")
	)
		return undefined;
	if (value.needsReauth !== undefined && typeof value.needsReauth !== "boolean")
		return undefined;
	return {
		email: value.email,
		accessToken: value.accessToken,
		refreshToken: value.refreshToken,
		expiresAt: value.expiresAt,
		...(typeof value.accountId === "string"
			? { accountId: value.accountId }
			: {}),
		...(typeof value.lastUsed === "number" ? { lastUsed: value.lastUsed } : {}),
		...(typeof value.quotaExhaustedUntil === "number"
			? { quotaExhaustedUntil: value.quotaExhaustedUntil }
			: {}),
		...(typeof value.needsReauth === "boolean"
			? { needsReauth: value.needsReauth }
			: {}),
	};
}

function parseCompleteStorage(
	value: Record<string, unknown>,
): StorageData | undefined {
	if (!Number.isInteger(value.version) || (value.version as number) <= 0)
		return undefined;
	if (!Array.isArray(value.accounts)) return undefined;
	if (
		!optionalString(value, "$schema") ||
		!optionalString(value, "activeEmail")
	)
		return undefined;
	if (
		value.manualEmail !== undefined &&
		(typeof value.manualEmail !== "string" || value.manualEmail.length === 0)
	)
		return undefined;
	const accounts = value.accounts.map(parseAccount);
	if (accounts.some((account) => account === undefined)) return undefined;
	return {
		...(typeof value.$schema === "string" ? { $schema: value.$schema } : {}),
		version: value.version as number,
		accounts: accounts as Account[],
		...(typeof value.activeEmail === "string"
			? { activeEmail: value.activeEmail }
			: {}),
		...(typeof value.manualEmail === "string"
			? { manualEmail: value.manualEmail }
			: {}),
	};
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

const LEGACY_FIELDS = [
	"importSource",
	"importMode",
	"importFingerprint",
] as const;

function stripLegacyFields(raw: Record<string, unknown>): boolean {
	let stripped = false;
	for (const key of LEGACY_FIELDS) {
		if (key in raw) {
			delete raw[key];
			stripped = true;
		}
	}
	return stripped;
}

function migrateRawStorage(raw: unknown): StorageData {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { version: CURRENT_VERSION, accounts: [], activeEmail: undefined };
	}

	const record = raw as Record<string, unknown>;

	// Strip legacy import fields from each account
	const rawAccounts = Array.isArray(record.accounts) ? record.accounts : [];
	for (const entry of rawAccounts) {
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			stripLegacyFields(entry as Record<string, unknown>);
		}
	}

	// Add version if missing (pre-v1 files)
	if (!("version" in record) || typeof record.version !== "number") {
		record.version = CURRENT_VERSION;
	}

	const parsed = parseCompleteStorage(record);
	if (parsed) return parsed;

	// Schema validation failed — salvage what we can
	const accounts: Account[] = [];
	for (const entry of rawAccounts) {
		const account = parseAccount(entry);
		if (account) accounts.push(account);
	}
	return { version: CURRENT_VERSION, accounts, activeEmail: undefined };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

export const STORAGE_FILE = getAgentPath("codex-accounts.json");

export function loadStorage(): StorageData {
	try {
		if (fs.existsSync(STORAGE_FILE)) {
			const text = fs.readFileSync(STORAGE_FILE, "utf-8");
			const raw = JSON.parse(text) as Record<string, unknown>;
			const needsMigration =
				!("version" in raw) ||
				raw.version !== CURRENT_VERSION ||
				needsLegacyStrip(raw);
			const data = migrateRawStorage(raw);
			if (needsMigration) {
				saveStorage(data);
			}
			return data;
		}
	} catch (error) {
		console.error("Failed to load multicodex accounts:", error);
	}

	return { version: CURRENT_VERSION, accounts: [], activeEmail: undefined };
}

function needsLegacyStrip(raw: Record<string, unknown>): boolean {
	const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
	for (const entry of accounts) {
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			for (const key of LEGACY_FIELDS) {
				if (key in (entry as Record<string, unknown>)) return true;
			}
		}
	}
	return false;
}

export function saveStorage(data: StorageData): void {
	try {
		const dir = path.dirname(STORAGE_FILE);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const output = {
			$schema: SCHEMA_URL,
			version: CURRENT_VERSION,
			accounts: data.accounts,
			activeEmail: data.activeEmail,
			manualEmail: data.manualEmail,
		};
		fs.writeFileSync(STORAGE_FILE, JSON.stringify(output, null, 2));
	} catch (error) {
		console.error("Failed to save multicodex accounts:", error);
	}
}
