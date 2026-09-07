export interface SiteOperatorIdentity {
	operator_id: string;
	instance_id: string;
	role: number;
}

export const SITE_OPERATOR_HEADERS = {
	context: "x-superboard-site-context",
	signature: "x-superboard-site-signature",
} as const;

const OPERATOR_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const INSTANCE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const ENCODED_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PADDING_PATTERN = /=+$/u;

export async function signSiteOperatorRequest(
	request: Request,
	identity: SiteOperatorIdentity,
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<Headers> {
	if (!validIdentity(identity) || !secret || !Number.isSafeInteger(nowSeconds)) {
		throw new TypeError("Invalid Site operator assertion");
	}
	const url = new URL(request.url);
	const payload = encode(
		new TextEncoder().encode(
			JSON.stringify({
				version: 1,
				...identity,
				issued_at: nowSeconds,
				method: request.method,
				path: `${url.pathname}${url.search}`,
			}),
		),
	);
	const key = await importKey(secret, "sign");
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
	return new Headers({
		[SITE_OPERATOR_HEADERS.context]: payload,
		[SITE_OPERATOR_HEADERS.signature]: encode(new Uint8Array(signature)),
	});
}

export async function verifySiteOperatorRequest(
	request: Request,
	instanceId: string,
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<SiteOperatorIdentity | null> {
	const payload = request.headers.get(SITE_OPERATOR_HEADERS.context) ?? "";
	const signature = request.headers.get(SITE_OPERATOR_HEADERS.signature) ?? "";
	if (
		!secret ||
		!instanceId ||
		payload.length > 4096 ||
		signature.length > 128 ||
		!payload ||
		!signature
	)
		return null;
	try {
		const key = await importKey(secret, "verify");
		if (
			!(await crypto.subtle.verify(
				"HMAC",
				key,
				decode(signature),
				new TextEncoder().encode(payload),
			))
		)
			return null;
		const value: unknown = JSON.parse(new TextDecoder().decode(decode(payload)));
		if (!isRecord(value) || !validIdentity(value) || value.version !== 1) return null;
		const url = new URL(request.url);
		if (
			value.instance_id !== instanceId ||
			value.method !== request.method ||
			value.path !== `${url.pathname}${url.search}` ||
			typeof value.issued_at !== "number" ||
			!Number.isSafeInteger(value.issued_at) ||
			Math.abs(nowSeconds - value.issued_at) > 60
		)
			return null;
		return { operator_id: value.operator_id, instance_id: value.instance_id, role: value.role };
	} catch {
		return null;
	}
}

function validIdentity(value: unknown): value is SiteOperatorIdentity & Record<string, unknown> {
	return (
		isRecord(value) &&
		typeof value.operator_id === "string" &&
		OPERATOR_PATTERN.test(value.operator_id) &&
		typeof value.instance_id === "string" &&
		INSTANCE_PATTERN.test(value.instance_id) &&
		typeof value.role === "number" &&
		Number.isSafeInteger(value.role) &&
		value.role >= 40 &&
		value.role <= 50
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importKey(secret: string, usage: "sign" | "verify") {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		[usage],
	);
}

function encode(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(PADDING_PATTERN, "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
	if (!ENCODED_PATTERN.test(value)) throw new TypeError("Invalid assertion encoding");
	return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) =>
		character.charCodeAt(0),
	);
}

export interface OperatorProjectSummary {
	id: string;
	internal_id: string;
	name: string;
	identifier: string;
	is_test: boolean;
	created_at: string;
	updated_at: string;
}

export interface OperatorInstanceSummary {
	id: string;
	name: string;
	uri_scheme: string;
	get_started_dismissed: boolean;
	created_at: string;
	updated_at: string;
	production: OperatorProjectSummary;
	test: OperatorProjectSummary;
	projects: OperatorProjectSummary[];
}

export interface OperatorProjectScope {
	production_project_ref: string;
	test_project_ref: string;
	instance?: OperatorInstanceSummary;
	projects?: OperatorProjectSummary[];
}
