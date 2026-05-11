export function isQuotaErrorMessage(message: string): boolean {
	return /\b429\b|quota|usage limits?|rate.?limit|too many requests|limits? reached/i.test(
		message,
	);
}
