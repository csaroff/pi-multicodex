import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

type OAuth = NonNullable<
	ReturnType<typeof builtinProviders>[number]["auth"]["oauth"]
>;
type AuthInteraction = Parameters<OAuth["login"]>[0];
type OptionalSignalAuthInteraction = Omit<AuthInteraction, "signal"> & {
	signal?: AbortSignal;
};

let cachedOAuth: OAuth | undefined;

function getOAuth(): OAuth {
	const oauth =
		cachedOAuth ??
		builtinProviders().find((provider) => provider.id === "openai-codex")?.auth
			.oauth;
	if (!oauth) throw new Error("OpenAI Codex OAuth is unavailable");
	cachedOAuth = oauth;
	return oauth;
}

export async function loginOAuthToken(
	interaction: OptionalSignalAuthInteraction,
): Promise<OAuthCredentials> {
	return getOAuth().login({
		...interaction,
		signal: interaction.signal ?? new AbortController().signal,
	});
}

export async function refreshOAuthToken(
	refreshToken: string,
	signal: AbortSignal = new AbortController().signal,
): Promise<OAuthCredentials> {
	return getOAuth().refresh(
		{
			type: "oauth",
			access: "",
			refresh: refreshToken,
			expires: 0,
		},
		signal,
	);
}
