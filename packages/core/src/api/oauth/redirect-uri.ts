export function validateRedirectUri(uri: string): string | null {
	try {
		const url = new URL(uri);

		if (uri.startsWith("//")) {
			return "Protocol-relative redirect URIs are not allowed";
		}

		if (url.protocol === "http:") {
			const host = url.hostname;
			if (host === "127.0.0.1" || host === "localhost" || host === "[::1]") {
				return null;
			}
			return "HTTP redirect URIs are only allowed for localhost";
		}

		if (url.protocol === "https:") {
			return null;
		}

		return `Unsupported redirect URI scheme: ${url.protocol}`;
	} catch {
		return "Invalid redirect URI";
	}
}
