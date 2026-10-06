const issuer = "https://token.actions.githubusercontent.com";
const repository = "mabzadev/superboard";

function decode(value) {
	return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
		char.charCodeAt(0),
	);
}

export async function runnerIdentity(request, fetchImpl = fetch) {
	const authorization = request.headers.get("Authorization") ?? "";
	if (authorization.length > 16_384 || !/^Bearer [A-Za-z0-9_.-]+$/u.test(authorization))
		throw new Error("INSTALLATION_RUNNER_UNAUTHORIZED");
	const parts = authorization.slice(7).split(".");
	if (parts.length !== 3) throw new Error("INSTALLATION_RUNNER_UNAUTHORIZED");
	let header;
	let claims;
	try {
		header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
		claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
	} catch {
		throw new Error("INSTALLATION_RUNNER_UNAUTHORIZED");
	}
	const now = Date.now() / 1000;
	const refs = ["refs/heads/main", "refs/heads/dev"];
	if (
		header.alg !== "RS256" ||
		typeof header.kid !== "string" ||
		claims.iss !== issuer ||
		claims.aud !== "superboard-installer" ||
		claims.repository !== repository ||
		!refs.includes(claims.ref) ||
		claims.workflow_ref !==
			`${repository}/.github/workflows/cloudflare-installations.yml@${claims.ref}` ||
		claims.sub !== `repo:${repository}:ref:${claims.ref}` ||
		claims.runner_environment !== "github-hosted" ||
		!["push", "schedule", "workflow_dispatch"].includes(claims.event_name) ||
		!Number.isFinite(claims.exp) ||
		claims.exp <= now ||
		!Number.isFinite(claims.iat) ||
		claims.iat > now + 60 ||
		(claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60)) ||
		!/^[0-9]+$/u.test(String(claims.run_id ?? ""))
	)
		throw new Error("INSTALLATION_RUNNER_UNAUTHORIZED");
	const response = await fetchImpl(`${issuer}/.well-known/jwks`, {
		signal: AbortSignal.timeout(10_000),
		redirect: "error",
	});
	if (!response.ok) throw new Error("INSTALLATION_RUNNER_KEYS_UNAVAILABLE");
	const text = await response.text();
	if (text.length > 65_536) throw new Error("INSTALLATION_RUNNER_KEYS_INVALID");
	const keys = JSON.parse(text).keys;
	const jwk = Array.isArray(keys)
		? keys.find((key) => key.kid === header.kid && key.kty === "RSA" && key.use === "sig")
		: null;
	if (!jwk) throw new Error("INSTALLATION_RUNNER_UNAUTHORIZED");
	const key = await crypto.subtle.importKey(
		"jwk",
		jwk,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
	if (
		!(await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			decode(parts[2]),
			new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
		))
	)
		throw new Error("INSTALLATION_RUNNER_UNAUTHORIZED");
	return { runId: String(claims.run_id), ref: claims.ref, revision: claims.sha };
}
