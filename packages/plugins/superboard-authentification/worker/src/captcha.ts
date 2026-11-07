import { readJsonLimited } from "@superboard/contracts/request-body";

const siteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const verificationTimeoutMs = 5_000;
const maximumTokenLength = 2_048;
const maximumResponseBytes = 16_384;
const tokenFields = ["captcha_token", "cf-turnstile-response"] as const;
const configurationErrorCodes = new Set([
	"internal-error",
	"missing-input-secret",
	"invalid-input-secret",
]);

export const captchaTokenHeader = "x-superboard-captcha-token";
export const turnstileScriptId = "superboard-turnstile";
export const turnstileScriptUrl =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type CaptchaRejection = "captcha_required" | "captcha_failed" | "captcha_unavailable";

interface CaptchaConfiguration {
	siteKey: string;
	secret: string;
}

const rejections: Record<CaptchaRejection, { status: 403 | 503; message: string }> = {
	captcha_required: { status: 403, message: "Complete the CAPTCHA challenge" },
	captcha_failed: { status: 403, message: "The CAPTCHA challenge could not be verified" },
	captcha_unavailable: {
		status: 503,
		message: "CAPTCHA verification is temporarily unavailable",
	},
};

function configuredText(env: object, key: string): string | null {
	const value: unknown = Reflect.get(env, key);
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function hasCaptchaSecret(env: object): boolean {
	return configuredText(env, "TURNSTILE_SECRET_KEY") !== null;
}

export function captchaConfiguration(env: object): CaptchaConfiguration | null {
	if (Reflect.get(env, "ENABLE_CAPTCHA") !== true) return null;
	const siteKey = configuredText(env, "TURNSTILE_SITE_KEY");
	const secret = configuredText(env, "TURNSTILE_SECRET_KEY");
	return siteKey && secret ? { siteKey, secret } : null;
}

function captchaToken(headers: Headers, body: Record<string, unknown>): string | null {
	for (const candidate of [
		headers.get(captchaTokenHeader),
		...tokenFields.map((field) => body[field]),
	])
		if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
	return null;
}

/** Verifies the request's Turnstile token when CAPTCHA is configured; `null` lets the request continue. */
export async function captchaRejection(
	env: object,
	headers: Headers,
	body: Record<string, unknown>,
): Promise<CaptchaRejection | null> {
	const configuration = captchaConfiguration(env);
	if (!configuration) return null;
	const token = captchaToken(headers, body);
	if (!token) return "captcha_required";
	if (token.length > maximumTokenLength) return "captcha_failed";
	return verify(configuration.secret, token, headers.get("cf-connecting-ip"));
}

async function verify(
	secret: string,
	token: string,
	remoteIp: string | null,
): Promise<CaptchaRejection | null> {
	const form = new URLSearchParams({
		secret,
		response: token,
		idempotency_key: crypto.randomUUID(),
	});
	if (remoteIp) form.set("remoteip", remoteIp);
	let outcome: unknown;
	try {
		const response = await fetch(siteverifyUrl, {
			method: "POST",
			body: form,
			signal: AbortSignal.timeout(verificationTimeoutMs),
		});
		if (!response.ok) {
			console.error(`[identity-captcha] Turnstile answered with status ${response.status}`);
			return "captcha_unavailable";
		}
		outcome = await readJsonLimited(response, maximumResponseBytes);
	} catch (cause) {
		console.error(
			`[identity-captcha] Turnstile could not be reached: ${cause instanceof Error ? cause.name : "unknown"}`,
		);
		return "captcha_unavailable";
	}
	if (!outcome || typeof outcome !== "object") return "captcha_unavailable";
	if (Reflect.get(outcome, "success") === true) return null;
	const codes: unknown = Reflect.get(outcome, "error-codes");
	if (Array.isArray(codes) && codes.some((code) => configurationErrorCodes.has(String(code)))) {
		console.error(`[identity-captcha] Turnstile rejected the verification: ${codes.join(",")}`);
		return "captcha_unavailable";
	}
	return "captcha_failed";
}

export function captchaRejectionResponse(rejection: CaptchaRejection): Response {
	const { status, message } = rejections[rejection];
	return Response.json(
		{ error: { code: rejection, message, retryable: rejection === "captcha_unavailable" } },
		{
			status,
			headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
		},
	);
}
