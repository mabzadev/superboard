import type { Kysely } from "kysely";

interface AuthProviderDescriptorLike {
	id: string;
	storage?: Record<string, { indexes?: Array<string | string[]> }>;
}

interface EmdashLocals {
	db: Kysely<unknown>;
	config: { authProviders?: AuthProviderDescriptorLike[] };
}

export async function getAtprotoStorage(
	emdash: EmdashLocals,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
	const { getAuthProviderStorage } = await import("emdash/api/route-utils");
	const provider = emdash.config.authProviders?.find((p) => p.id === "atproto");
	if (!provider?.storage) return null;

	return getAuthProviderStorage(
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Kysely<unknown> satisfies getAuthProviderStorage's Database parameter
		emdash.db as Parameters<typeof getAuthProviderStorage>[0],
		"atproto",
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- provider.storage shape matches getAuthProviderStorage's expected Record type
		provider.storage as Parameters<typeof getAuthProviderStorage>[2],
	);
}
