import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export async function refreshOAuthToken(
	refreshToken: string,
): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`OpenAI Codex token refresh failed (${response.status}): ${body || response.statusText}`,
		);
	}
	const body = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};
	if (
		!body.access_token ||
		!body.refresh_token ||
		typeof body.expires_in !== "number"
	) {
		throw new Error("OpenAI Codex token refresh response missing fields");
	}
	return {
		access: body.access_token,
		refresh: body.refresh_token,
		expires: Date.now() + body.expires_in * 1000,
	};
}
