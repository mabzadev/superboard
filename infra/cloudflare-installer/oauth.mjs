const encoder = new TextEncoder();
const stateCookie = "__Host-superboard-oauth";
const sessionCookie = "__Host-superboard-session";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

function random() {
	return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

async function digest(value) {
	return btoa(
		String.fromCharCode(
			...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
		),
	)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function cookie(request, name) {
	return (request.headers.get("Cookie") ?? "")
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1);
}

function setCookie(name, value, seconds) {
	return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}

export function oauthConfigured(env) {
	return Boolean(
		env.INSTALLER_DB &&
		env.CLOUDFLARE_OAUTH_CLIENT_ID &&
		env.CLOUDFLARE_OAUTH_SCOPES &&
		env.INSTALLER_SESSION_KEY &&
		env.INSTALLER_ORIGIN,
	);
}

export function installerOAuth(env, fetchImpl = fetch) {
	if (!oauthConfigured(env)) throw new Error("INSTALLATION_OAUTH_NOT_CONFIGURED");
	const configured = new URL(env.INSTALLER_ORIGIN);
	const origin = configured.origin;
	const loopback = configured.protocol === "http:" && configured.hostname === "localhost";
	if ((!origin.startsWith("https://") && !loopback) || env.INSTALLER_ORIGIN !== origin)
		throw new Error("INSTALLATION_OAUTH_ORIGIN_INVALID");
	const redirectUri = `${origin}/oauth/callback`;
	const db = env.INSTALLER_DB;
	const keyBytes = Uint8Array.from(atob(env.INSTALLER_SESSION_KEY), (char) => char.charCodeAt(0));
	if (keyBytes.length !== 32) throw new Error("INSTALLATION_SESSION_KEY_INVALID");
	const key = crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);

	async function save(id, payload, expires) {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const data = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: encoder.encode(id) },
			await key,
			encoder.encode(JSON.stringify(payload)),
		);
		const encrypted = btoa(String.fromCharCode(...iv, ...new Uint8Array(data)));
		await db
			.prepare("INSERT INTO installer_sessions (id, payload, expires) VALUES (?, ?, ?)")
			.bind(id, encrypted, expires)
			.run();
	}

	async function decode(id, row) {
		if (!row || row.expires <= Date.now()) throw new Error("INSTALLATION_SESSION_EXPIRED");
		const bytes = Uint8Array.from(atob(row.payload), (char) => char.charCodeAt(0));
		return JSON.parse(
			new TextDecoder().decode(
				await crypto.subtle.decrypt(
					{ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(id) },
					await key,
					bytes.slice(12),
				),
			),
		);
	}

	return {
		async start(request) {
			if (new URL(request.url).origin !== origin)
				throw new Error("INSTALLATION_OAUTH_ORIGIN_INVALID");
			const state = random();
			const browser = random();
			const verifier = random();
			await db.prepare("DELETE FROM installer_sessions WHERE expires <= ?").bind(Date.now()).run();
			await save(
				await digest(`state:${state}:${browser}`),
				{ verifier, lang: new URL(request.url).searchParams.get("lang") === "fr" ? "fr" : "en" },
				Date.now() + 600_000,
			);
			const url = new URL("https://dash.cloudflare.com/oauth2/auth");
			url.search = new URLSearchParams({
				client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
				redirect_uri: redirectUri,
				response_type: "code",
				scope: env.CLOUDFLARE_OAUTH_SCOPES,
				state,
				code_challenge: await digest(verifier),
				code_challenge_method: "S256",
			}).toString();
			return new Response(null, {
				status: 302,
				headers: {
					...headers,
					Location: url.href,
					"Set-Cookie": setCookie(stateCookie, browser, 600),
				},
			});
		},
		async callback(request) {
			const url = new URL(request.url);
			if (url.origin !== origin) throw new Error("INSTALLATION_OAUTH_ORIGIN_INVALID");
			const state = url.searchParams.get("state");
			const browser = cookie(request, stateCookie);
			if (!/^[A-Za-z0-9_-]{43}$/u.test(state ?? "") || !/^[A-Za-z0-9_-]{43}$/u.test(browser ?? ""))
				throw new Error("INSTALLATION_OAUTH_STATE_INVALID");
			const id = await digest(`state:${state}:${browser}`);
			const row = await db
				.prepare("DELETE FROM installer_sessions WHERE id = ? RETURNING payload, expires")
				.bind(id)
				.first();
			const stored = await decode(id, row);
			if (url.searchParams.has("error")) throw new Error("INSTALLATION_OAUTH_DENIED");
			const code = url.searchParams.get("code");
			if (!code || code.length > 4096) throw new Error("INSTALLATION_OAUTH_CODE_INVALID");
			const response = await fetchImpl("https://dash.cloudflare.com/oauth2/token", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					...(env.CLOUDFLARE_OAUTH_CLIENT_SECRET
						? {
								Authorization: `Basic ${btoa(`${encodeURIComponent(env.CLOUDFLARE_OAUTH_CLIENT_ID)}:${encodeURIComponent(env.CLOUDFLARE_OAUTH_CLIENT_SECRET)}`)}`,
							}
						: {}),
				},
				body: new URLSearchParams({
					...(!env.CLOUDFLARE_OAUTH_CLIENT_SECRET
						? { client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID }
						: {}),
					grant_type: "authorization_code",
					code,
					redirect_uri: redirectUri,
					code_verifier: stored.verifier,
				}).toString(),
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error("INSTALLATION_OAUTH_EXCHANGE_FAILED");
			const token = await response.json();
			if (
				typeof token.access_token !== "string" ||
				token.access_token.length > 8192 ||
				token.token_type?.toLowerCase() !== "bearer" ||
				!Number.isFinite(token.expires_in) ||
				token.expires_in <= 60
			)
				throw new Error("INSTALLATION_OAUTH_TOKEN_INVALID");
			const session = random();
			const seconds = Math.min(token.expires_in - 30, 3600);
			await save(
				await digest(`session:${session}`),
				{
					token: token.access_token,
					refreshToken: token.refresh_token,
					expiresAt: Date.now() + token.expires_in * 1000,
				},
				Date.now() + seconds * 1000,
			);
			const resultHeaders = new Headers({ ...headers, Location: `${origin}/?lang=${stored.lang}` });
			resultHeaders.append("Set-Cookie", setCookie(stateCookie, "", 0));
			resultHeaders.append("Set-Cookie", setCookie(sessionCookie, session, seconds));
			return new Response(null, { status: 303, headers: resultHeaders });
		},
		async token(request) {
			const session = cookie(request, sessionCookie);
			if (!/^[A-Za-z0-9_-]{43}$/u.test(session ?? ""))
				throw new Error("INSTALLATION_SESSION_REQUIRED");
			const id = await digest(`session:${session}`);
			return (
				await decode(
					id,
					await db
						.prepare("SELECT payload, expires FROM installer_sessions WHERE id = ?")
						.bind(id)
						.first(),
				)
			).token;
		},
		async authorization(request) {
			const session = cookie(request, sessionCookie);
			if (!/^[A-Za-z0-9_-]{43}$/u.test(session ?? ""))
				throw new Error("INSTALLATION_SESSION_REQUIRED");
			const id = await digest(`session:${session}`);
			const grant = await decode(
				id,
				await db
					.prepare("SELECT payload, expires FROM installer_sessions WHERE id = ?")
					.bind(id)
					.first(),
			);
			return { ...grant, id };
		},
		async logout(request) {
			const session = cookie(request, sessionCookie);
			if (session)
				await db
					.prepare("DELETE FROM installer_sessions WHERE id = ?")
					.bind(await digest(`session:${session}`))
					.run();
			return Response.json(
				{ result: true },
				{ headers: { ...headers, "Set-Cookie": setCookie(sessionCookie, "", 0) } },
			);
		},
	};
}
