import {
	CompositeHandleResolver,
	DohJsonHandleResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";

let resolver: CompositeHandleResolver | undefined;

function getResolver(): CompositeHandleResolver {
	if (!resolver) {
		resolver = new CompositeHandleResolver({
			strategy: "race",
			methods: {
				dns: new DohJsonHandleResolver({ dohUrl: "https://cloudflare-dns.com/dns-query" }),
				http: new WellKnownHandleResolver(),
			},
		});
	}
	return resolver;
}

export async function verifyHandleDID(handle: string): Promise<string | null> {
	if (!handle.includes(".")) return null;

	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above with includes("."), satisfies atcute's template literal type
		const did = await getResolver().resolve(handle as `${string}.${string}`);
		return did;
	} catch {
		return null;
	}
}
