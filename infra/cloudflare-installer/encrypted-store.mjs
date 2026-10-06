const encoder = new TextEncoder();

export function encryptedStore(env) {
	const bytes = Uint8Array.from(atob(env.INSTALLER_SESSION_KEY), (value) => value.charCodeAt(0));
	if (bytes.length !== 32) throw new Error("INSTALLATION_SESSION_KEY_INVALID");
	const key = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
	return {
		async get(id) {
			const row = await env.INSTALLER_DB.prepare(
				"SELECT payload, expires FROM installer_sessions WHERE id = ?",
			)
				.bind(id)
				.first();
			if (!row || row.expires <= Date.now()) return null;
			const data = Uint8Array.from(atob(row.payload), (value) => value.charCodeAt(0));
			return JSON.parse(
				new TextDecoder().decode(
					await crypto.subtle.decrypt(
						{ name: "AES-GCM", iv: data.slice(0, 12), additionalData: encoder.encode(id) },
						await key,
						data.slice(12),
					),
				),
			);
		},
		async put(id, value, expires = 8_640_000_000_000_000, onlyIfMissing = false) {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const data = await crypto.subtle.encrypt(
				{ name: "AES-GCM", iv, additionalData: encoder.encode(id) },
				await key,
				encoder.encode(JSON.stringify(value)),
			);
			let binary = String.fromCharCode(...iv);
			for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
			await env.INSTALLER_DB.prepare(
				onlyIfMissing
					? "INSERT INTO installer_sessions (id, payload, expires) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING"
					: "INSERT INTO installer_sessions (id, payload, expires) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, expires=excluded.expires",
			)
				.bind(id, btoa(binary), expires)
				.run();
		},
	};
}

export async function cloudflareGrantToken(
	env,
	grantId,
	fetchImpl = fetch,
	minimumValidity = 120_000,
) {
	const store = encryptedStore(env);
	const grant = await store.get(`grant:${grantId}`);
	if (!grant) throw new Error("INSTALLATION_AUTHORIZATION_REQUIRED");
	if (grant.expiresAt > Date.now() + minimumValidity) return grant.token;
	const ticket = crypto.randomUUID();
	const lock = await env.INSTALLER_DB.prepare(
		"INSERT INTO installer_grant_locks (id, ticket, expires) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET ticket=excluded.ticket, expires=excluded.expires WHERE installer_grant_locks.expires < ? RETURNING ticket",
	)
		.bind(grantId, ticket, Date.now() + 60_000, Date.now())
		.first();
	if (!lock) throw new Error("INSTALLATION_AUTHORIZATION_BUSY");
	try {
		const current = await store.get(`grant:${grantId}`);
		if (current.expiresAt > Date.now() + minimumValidity) return current.token;
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
				grant_type: "refresh_token",
				client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
				refresh_token: current.refreshToken,
			}),
			signal: AbortSignal.timeout(30_000),
		});
		if (response.status === 429 || response.status >= 500)
			throw new Error("INSTALLATION_AUTHORIZATION_UNAVAILABLE");
		if (!response.ok) throw new Error("INSTALLATION_AUTHORIZATION_EXPIRED");
		const token = await response.json();
		if (
			!token.access_token ||
			!Number.isFinite(token.expires_in) ||
			token.expires_in <= 120 ||
			token.token_type?.toLowerCase() !== "bearer"
		)
			throw new Error("INSTALLATION_OAUTH_TOKEN_INVALID");
		await store.put(`grant:${grantId}`, {
			...current,
			token: token.access_token,
			refreshToken: token.refresh_token || current.refreshToken,
			expiresAt: Date.now() + token.expires_in * 1000,
		});
		return token.access_token;
	} finally {
		await env.INSTALLER_DB.prepare("DELETE FROM installer_grant_locks WHERE id = ? AND ticket = ?")
			.bind(grantId, ticket)
			.run();
	}
}
