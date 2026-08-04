import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getOrFetchSharedUsage,
	getSharedUsageKey,
	loadSharedUsageCache,
} from "./usage-cache";

const roots: string[] = [];

async function cacheFile(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-multicodex-usage-"));
	roots.push(root);
	return join(root, "codex-usage-cache.json");
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

describe("shared usage cache", () => {
	it("deduplicates concurrent fetches for the same account", async () => {
		const filePath = await cacheFile();
		const account = { email: "one@example.com", accountId: "account-1" };
		let fetches = 0;
		const fetchUsage = async () => {
			fetches += 1;
			await new Promise((resolve) => setTimeout(resolve, 20));
			return { primary: { usedPercent: 10 }, fetchedAt: Date.now() };
		};

		const [first, second] = await Promise.all([
			getOrFetchSharedUsage(account, fetchUsage, {
				filePath,
				ttlMs: 300_000,
			}),
			getOrFetchSharedUsage(account, fetchUsage, {
				filePath,
				ttlMs: 300_000,
			}),
		]);

		expect(fetches).toBe(1);
		expect(second).toEqual(first);
	});

	it("times out rather than fetching without a live account lock", async () => {
		const filePath = await cacheFile();
		const account = { email: "locked@example.com" };
		const lockDirectory = `${filePath}.locks`;
		await mkdir(lockDirectory);
		const { createHash } = await import("node:crypto");
		const lockName = createHash("sha256")
			.update(getSharedUsageKey(account))
			.digest("hex");
		await writeFile(
			join(lockDirectory, `${lockName}.lock`),
			JSON.stringify({
				pid: process.pid,
				owner: "live-owner",
				createdAt: Date.now(),
			}),
		);
		const fetchUsage = vi.fn(async () => ({ fetchedAt: Date.now() }));

		await expect(
			getOrFetchSharedUsage(account, fetchUsage, {
				filePath,
				ttlMs: 300_000,
				lockTimeoutMs: 100,
			}),
		).rejects.toThrow("Timed out waiting for shared usage cache lock");
		expect(fetchUsage).not.toHaveBeenCalled();
	});

	it("keeps the cache key stable when an account ID is learned", () => {
		expect(
			getSharedUsageKey({
				email: "Stable@Example.com",
				accountId: "account-1",
			}),
		).toBe(getSharedUsageKey({ email: "stable@example.com" }));
	});

	it("preserves concurrent writes for different accounts", async () => {
		const filePath = await cacheFile();
		const accounts = [
			{ email: "one@example.com", accountId: "account-1" },
			{ email: "two@example.com", accountId: "account-2" },
		];

		await Promise.all(
			accounts.map((account, index) =>
				getOrFetchSharedUsage(
					account,
					async () => ({
						primary: { usedPercent: index + 1 },
						fetchedAt: Date.now(),
					}),
					{ filePath, ttlMs: 300_000 },
				),
			),
		);

		const cache = loadSharedUsageCache(filePath);
		expect(
			cache.get(getSharedUsageKey(accounts[0]))?.primary?.usedPercent,
		).toBe(1);
		expect(
			cache.get(getSharedUsageKey(accounts[1]))?.primary?.usedPercent,
		).toBe(2);
	});

	it("lets concurrent forced refreshes share the newest result", async () => {
		const filePath = await cacheFile();
		const account = { email: "force@example.com" };
		let fetches = 0;
		const fetchUsage = async () => {
			fetches += 1;
			await new Promise((resolve) => setTimeout(resolve, 20));
			return { fetchedAt: Date.now() };
		};

		await Promise.all([
			getOrFetchSharedUsage(account, fetchUsage, {
				filePath,
				ttlMs: 300_000,
				force: true,
			}),
			getOrFetchSharedUsage(account, fetchUsage, {
				filePath,
				ttlMs: 300_000,
				force: true,
			}),
		]);

		expect(fetches).toBe(1);
	});

	it("does not reuse a same-millisecond snapshot for a forced refresh", async () => {
		const filePath = await cacheFile();
		const account = { email: "force-same-ms@example.com" };
		const now = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(now);
		await getOrFetchSharedUsage(account, async () => ({ fetchedAt: now }), {
			filePath,
			ttlMs: 300_000,
		});
		let fetches = 0;

		await Promise.all([
			getOrFetchSharedUsage(
				account,
				async () => {
					fetches += 1;
					return { fetchedAt: now };
				},
				{ filePath, ttlMs: 300_000, force: true },
			),
			getOrFetchSharedUsage(
				account,
				async () => {
					fetches += 1;
					return { fetchedAt: now };
				},
				{ filePath, ttlMs: 300_000, force: true },
			),
		]);

		expect(fetches).toBe(1);
	});

	it("recovers from a corrupt cache file", async () => {
		const filePath = await cacheFile();
		await writeFile(filePath, "not json");

		const usage = await getOrFetchSharedUsage(
			{ email: "recover@example.com" },
			async () => ({ secondary: { usedPercent: 42 }, fetchedAt: Date.now() }),
			{ filePath, ttlMs: 300_000 },
		);

		expect(usage.secondary?.usedPercent).toBe(42);
		expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
			version: 1,
		});
	});

	it("never persists account credentials", async () => {
		const filePath = await cacheFile();
		const account = {
			email: "safe@example.com",
			accountId: "safe-account",
			accessToken: "access-secret",
			refreshToken: "refresh-secret",
		};

		await getOrFetchSharedUsage(
			account,
			async () => ({ primary: { usedPercent: 12 }, fetchedAt: Date.now() }),
			{ filePath, ttlMs: 300_000 },
		);

		const persisted = await readFile(filePath, "utf8");
		expect(persisted).not.toContain("access-secret");
		expect(persisted).not.toContain("refresh-secret");
	});

	it("recovers a stale lock left by a dead process", async () => {
		const filePath = await cacheFile();
		const account = { email: "stale@example.com" };
		const lockDirectory = `${filePath}.locks`;
		await mkdir(lockDirectory);
		const { createHash } = await import("node:crypto");
		const lockName = createHash("sha256")
			.update(getSharedUsageKey(account))
			.digest("hex");
		await writeFile(
			join(lockDirectory, `${lockName}.lock`),
			JSON.stringify({
				pid: 2_147_483_647,
				owner: "dead-owner",
				createdAt: Date.now() - 31_000,
			}),
		);

		let fetches = 0;
		const signal = AbortSignal.timeout(2_000);
		const [first, second] = await Promise.all([
			getOrFetchSharedUsage(
				account,
				async () => {
					fetches += 1;
					return { fetchedAt: Date.now() };
				},
				{ filePath, ttlMs: 300_000, signal },
			),
			getOrFetchSharedUsage(
				account,
				async () => {
					fetches += 1;
					return { fetchedAt: Date.now() };
				},
				{ filePath, ttlMs: 300_000, signal },
			),
		]);

		expect(second).toEqual(first);
		expect(fetches).toBe(1);
		await expect(
			stat(join(lockDirectory, `${lockName}.lock`)),
		).rejects.toThrow();
	});
});
