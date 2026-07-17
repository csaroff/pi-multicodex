import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	login: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/providers/openai-codex", () => ({
	openaiCodexProvider: () => ({
		auth: { oauth: { login: mocks.login, refresh: mocks.refresh } },
	}),
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
	mocks.login.mockResolvedValue(credential);
	const interaction = { notify: vi.fn(), prompt: vi.fn() };

	await expect(loginOAuthToken(interaction)).resolves.toBe(credential);
	expect(mocks.login).toHaveBeenCalledWith(interaction);
});

it("refreshes through the public Codex provider OAuth API", async () => {
	mocks.refresh.mockResolvedValue({
		type: "oauth",
		access: "new-access",
		refresh: "new-refresh",
		expires: 123,
	});

	await refreshOAuthToken("old-refresh");

	expect(mocks.refresh).toHaveBeenCalledWith({
		type: "oauth",
		access: "",
		refresh: "old-refresh",
		expires: 0,
	});
});
