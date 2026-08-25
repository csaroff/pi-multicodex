import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function getAgentPath(...segments: string[]): string {
	return join(getAgentDir(), ...segments);
}

export function getAgentSettingsPath(): string {
	return getAgentPath("settings.json");
}

export function getAgentAuthPath(): string {
	return getAgentPath("auth.json");
}

export async function readJsonObjectFileAsync(
	filePath: string,
): Promise<Record<string, unknown>> {
	try {
		if (!(await stat(filePath).catch(() => undefined))) return {};
		const parsed: unknown = JSON.parse(await readFile(filePath, "utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export async function writeJsonObjectFileAsync(
	filePath: string,
	data: Record<string, unknown>,
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true, mode: 0o755 });
	await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}
