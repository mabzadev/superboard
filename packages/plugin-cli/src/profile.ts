import type { OAuthSession } from "@atcute/oauth-node-client";

import { createActorResolver } from "./oauth.js";

export interface AtprotoProfile {
	handle: string;
	displayName: string | null;
	pds: string;
}

export async function resolveAtprotoProfile(session: OAuthSession): Promise<AtprotoProfile> {
	const did = session.sub;

	const tokenInfo = await session.getTokenInfo();
	const pds = tokenInfo.aud;
	if (typeof pds !== "string" || pds.length === 0) {
		throw new Error(
			"OAuth session has no `aud` (PDS URL); cannot resolve publisher profile. This is a bug -- please report it.",
		);
	}

	let handle: string = did;
	let displayName: string | null = null;

	try {
		const resolved = await createActorResolver().resolve(did);
		if (resolved.handle && resolved.handle !== "handle.invalid") {
			handle = resolved.handle;
		}
	} catch {}

	try {
		const res = await session.handle(
			`/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.bsky.actor.profile&rkey=self`,
		);
		if (res.ok) {
			displayName = pickDisplayName(await res.json());
		}
	} catch {}

	return { handle, displayName, pds };
}

function pickDisplayName(input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	if (!("value" in input) || !input.value || typeof input.value !== "object") return null;
	if (!("displayName" in input.value)) return null;
	return typeof input.value.displayName === "string" ? input.value.displayName : null;
}
