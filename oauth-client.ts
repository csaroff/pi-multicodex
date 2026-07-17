import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

type OAuth = NonNullable<
	ReturnType<typeof openaiCodexProvider>["auth"]["oauth"]
>;
type AuthInteraction = Parameters<OAuth["login"]>[0];

function getOAuth() {
	const oauth = openaiCodexProvider().auth.oauth;
	if (!oauth) throw new Error("OpenAI Codex OAuth is unavailable");
	return oauth;
}

export async function loginOAuthToken(
	interaction: AuthInteraction,
): Promise<OAuthCredentials> {
	return getOAuth().login(interaction);
}

export async function refreshOAuthToken(
	refreshToken: string,
): Promise<OAuthCredentials> {
	return getOAuth().refresh({
		type: "oauth",
		access: "",
		refresh: refreshToken,
		expires: 0,
	});
}
