import { afterEach, expect, it, vi } from "vitest";
import { refreshOAuthToken } from "./oauth-client";

afterEach(() => vi.unstubAllGlobals());

it("refreshes Codex credentials without relying on pi runtime OAuth exports", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					access_token: "new-access",
					refresh_token: "new-refresh",
					expires_in: 3600,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		),
	);

	const result = await refreshOAuthToken("old-refresh");

	expect(result.access).toBe("new-access");
	expect(result.refresh).toBe("new-refresh");
	expect(fetch).toHaveBeenCalledWith(
		"https://auth.openai.com/oauth/token",
		expect.objectContaining({
			method: "POST",
			body: expect.any(URLSearchParams),
		}),
	);
});
