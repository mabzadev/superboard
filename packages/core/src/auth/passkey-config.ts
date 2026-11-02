export interface PasskeyConfig {
	rpName: string;
	rpId: string;
	origins: string[];
}

export function getPasskeyConfig(
	url: URL,
	siteName?: string,
	siteUrl?: string,
	allowedOrigins?: string[],
): PasskeyConfig {
	let rpName: string;
	let rpId: string;
	let canonicalOrigin: string;

	if (siteUrl) {
		let publicUrl: URL;
		try {
			publicUrl = new URL(siteUrl);
		} catch (e) {
			throw new Error(`Invalid siteUrl: "${siteUrl}"`, { cause: e });
		}
		rpName = siteName || publicUrl.hostname;
		rpId = publicUrl.hostname;
		canonicalOrigin = publicUrl.origin;
	} else {
		rpName = siteName || url.hostname;
		rpId = url.hostname;
		canonicalOrigin = url.origin;
	}

	const origins = [canonicalOrigin];
	if (allowedOrigins) {
		for (const extra of allowedOrigins) {
			if (extra && !origins.includes(extra)) origins.push(extra);
		}
	}

	return { rpName, rpId, origins };
}
