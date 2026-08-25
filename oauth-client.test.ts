import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	login: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
	builtinProviders: () => [
		{
			id: "openai-codex",
			auth: { oauth: { login: mocks.login, refresh: mocks.refresh } },
		},
	],
}));

import { loginOAuthToken, refreshOAuthToken } from "./oauth-client";

beforeEach(() => vi.clearAllMocks());

it("logs in through the public Codex provider OAuth API", async () => {
	const credential = {
		type: "oauth",
		access: "access",
		refresh: "refresh",
		expires: 123,
	};
	mocks.login.mockImplementation(
		async (interaction: { signal: AbortSignal }) => {
			expect(interaction.signal.aborted).toBe(false);
			return credential;
		},
	);
	const interaction = {
		notify: vi.fn(),
		prompt: vi.fn().mockResolvedValue("device_code"),
	};

	await expect(loginOAuthToken(interaction)).resolves.toBe(credential);
	expect(mocks.login).toHaveBeenCalledWith({
		...interaction,
		signal: expect.any(AbortSignal),
	});
});

it("refreshes through the public Codex provider OAuth API", async () => {
	mocks.refresh.mockResolvedValue({
		type: "oauth",
		access: "new-access",
		refresh: "new-refresh",
		expires: 123,
	});

	await refreshOAuthToken("old-refresh");

	expect(mocks.refresh).toHaveBeenCalledWith(
		{
			type: "oauth",
			access: "",
			refresh: "old-refresh",
			expires: 0,
		},
		expect.any(AbortSignal),
	);
});
