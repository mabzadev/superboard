export class SuperBoardError extends Error {
	constructor(code, message, status = 0) {
		super(message);
		this.name = "SuperBoardError";
		this.code = code;
		this.status = status;
	}
}

export class SuperBoardClient {
	#origin;
	#fetch;
	#headers;
	#session = null;
	#generation = 0;
	#refreshing = null;
	#applicationToken = null;

	constructor(options) {
		const url = new URL(options.apiUrl);
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (
			(url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
			url.username ||
			url.password
		)
			throw new TypeError(
				"Use an HTTPS SuperBoard origin, or HTTP on loopback for local development.",
			);
		if (!options.projectKey || !options.appId)
			throw new TypeError("projectKey and appId are required.");
		if (!["web", "desktop"].includes(options.platform ?? "web"))
			throw new TypeError("Unsupported client platform.");
		this.#origin = url.origin;
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#headers = {
			"PROJECT-KEY": options.projectKey,
			IDENTIFIER: options.appId,
			PLATFORM: options.platform ?? "web",
			ENVIRONMENT: options.environment ?? "production",
		};
	}

	get session() {
		return this.#session ? { ...this.#session } : null;
	}

	setSession(session) {
		if (
			!session ||
			typeof session.access_token !== "string" ||
			!session.access_token ||
			typeof session.refresh_token !== "string" ||
			!session.refresh_token
		)
			throw new SuperBoardError(
				"invalid_session",
				"The authentication response does not contain a complete session.",
			);
		this.#generation++;
		this.#session = { ...session };
		this.#applicationToken = null;
	}

	clearSession() {
		this.#generation++;
		this.#session = null;
		this.#applicationToken = null;
		this.#refreshing = null;
	}

	async #authenticate(path, body) {
		this.clearSession();
		const generation = this.#generation;
		const result = await this.request(path, { method: "POST", body, authenticated: false });
		if (generation !== this.#generation)
			throw new SuperBoardError("session_changed", "The session changed while signing in.");
		this.setSession(result);
		return result;
	}

	register(input) {
		return this.#authenticate("/auth/register", input);
	}
	signIn(email, password) {
		return this.#authenticate("/auth/signin/password", { email, password });
	}
	signInAnonymously(installationId) {
		return this.#authenticate("/auth/anonymous", { installation_id: installationId });
	}
	signInWithProvider(provider, input) {
		if (!["google", "apple"].includes(provider))
			throw new TypeError("Unsupported identity provider.");
		return this.#authenticate(`/auth/signin/${provider}`, input);
	}
	getProfile() {
		return this.request("/auth/me");
	}
	updateProfile(profile) {
		return this.request("/auth/me", { method: "PUT", body: profile });
	}

	async refreshSession() {
		if (this.#refreshing) return this.#refreshing;
		if (!this.#session)
			throw new SuperBoardError("session_required", "Sign in before refreshing the session.");
		const generation = this.#generation;
		const refreshToken = this.#session.refresh_token;
		const operation = this.request("/auth/refresh", {
			method: "POST",
			body: { refresh_token: refreshToken },
			authenticated: false,
		})
			.then((result) => {
				if (generation !== this.#generation)
					throw new SuperBoardError("session_changed", "The session changed while refreshing.");
				this.setSession(result);
				return this.session;
			})
			.catch((error) => {
				if (generation === this.#generation && error.status === 401) this.clearSession();
				throw error;
			})
			.finally(() => {
				if (this.#refreshing === operation) this.#refreshing = null;
			});
		this.#refreshing = operation;
		return operation;
	}

	async logout() {
		const generation = this.#generation;
		try {
			if (this.#session) await this.request("/auth/logout", { method: "POST", body: {} });
		} finally {
			if (generation === this.#generation) this.clearSession();
		}
	}

	async getApplicationAccessToken() {
		if (this.#applicationToken && this.#applicationToken.expiresAt > Date.now() + 10000)
			return this.#applicationToken.value;
		const generation = this.#generation;
		const result = await this.request("/auth/superboard-token", { method: "POST", body: {} });
		if (generation !== this.#generation)
			throw new SuperBoardError(
				"session_changed",
				"The session changed while exchanging its token.",
			);
		if (!result?.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 0)
			throw new SuperBoardError(
				"invalid_application_token",
				"The application token response is invalid.",
			);
		this.#applicationToken = {
			value: result.access_token,
			expiresAt: Date.now() + result.expires_in * 1000,
		};
		return result.access_token;
	}

	async request(path, options = {}) {
		if (
			typeof path !== "string" ||
			!path.startsWith("/") ||
			path.startsWith("//") ||
			path.includes("\\") ||
			[...path].some((character) => character.charCodeAt(0) <= 32)
		)
			throw new TypeError(
				"Requests must use an absolute path on the configured SuperBoard origin.",
			);
		const url = new URL(path, this.#origin);
		if (url.origin !== this.#origin) throw new TypeError("Cross-origin SDK request rejected.");
		const method = options.method ?? "GET";
		const authenticated = options.authenticated !== false;
		const headers = new Headers({ ...this.#headers, Accept: "application/json" });
		if (options.body !== undefined) headers.set("Content-Type", "application/json");
		if (!["GET", "HEAD"].includes(method))
			headers.set("Idempotency-Key", options.idempotencyKey ?? crypto.randomUUID());
		if (authenticated) {
			if (!this.#session)
				throw new SuperBoardError(
					"session_required",
					"Sign in before making an authenticated request.",
				);
			const token = options.applicationToken
				? await this.getApplicationAccessToken()
				: this.#session.access_token;
			headers.set("Authorization", `Bearer ${token}`);
		}
		const response = await this.#fetch(url.href, {
			method,
			headers,
			...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
			credentials: "omit",
			redirect: "error",
			signal: options.signal,
		});
		let payload = null;
		if (response.status !== 204) {
			try {
				payload = await response.json();
			} catch {
				throw new SuperBoardError(
					"invalid_response",
					"SuperBoard returned an invalid JSON response.",
					response.status,
				);
			}
		}
		if (!response.ok)
			throw new SuperBoardError(
				payload?.error?.code ?? `http_${response.status}`,
				payload?.error?.message ?? "SuperBoard request failed.",
				response.status,
			);
		return payload && typeof payload === "object" && Object.hasOwn(payload, "data")
			? payload.data
			: payload;
	}
}
