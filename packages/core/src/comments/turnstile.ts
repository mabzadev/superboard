const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function getTurnstileSecretKey(): string {
	return process.env.EMDASH_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || "";
}

export async function verifyTurnstileToken(
	token: string | undefined,
	secretKey: string,
	remoteIp?: string | null,
): Promise<boolean> {
	if (!token) return false;

	const body: Record<string, string> = { secret: secretKey, response: token };
	if (remoteIp) {
		body.remoteip = remoteIp;
	}

	try {
		const res = await fetch(SITEVERIFY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return false;
		const data: { success?: boolean; "error-codes"?: string[] } = await res.json();
		if (!data.success) {
			console.warn("[comments] Turnstile verification failed:", data["error-codes"] ?? []);
		}
		return data.success === true;
	} catch (error) {
		console.error(
			"[comments] Turnstile siteverify request failed:",
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}
