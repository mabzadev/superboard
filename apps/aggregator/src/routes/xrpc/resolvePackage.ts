import {
	CompositeHandleResolver,
	DohJsonHandleResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import { json, XRPCError } from "@atcute/xrpc-server";
import { type AggregatorResolvePackage } from "@emdash-cms/registry-lexicons";

import { boundFetch } from "../../utils.js";
import { lookupPackage, throwPackageLookupError } from "./listing-query.js";
import { packageView } from "./views.js";

let cachedResolver: CompositeHandleResolver | null = null;
function getHandleResolver(): CompositeHandleResolver {
	if (!cachedResolver) {
		cachedResolver = new CompositeHandleResolver({
			strategy: "race",
			methods: {
				dns: new DohJsonHandleResolver({
					dohUrl: "https://mozilla.cloudflare-dns.com/dns-query",
					fetch: boundFetch,
				}),
				http: new WellKnownHandleResolver({ fetch: boundFetch }),
			},
		});
	}
	return cachedResolver;
}

export async function resolvePackage(
	env: Env,
	params: AggregatorResolvePackage.$params,
): Promise<Response> {
	let did: string;
	try {
		did = await getHandleResolver().resolve(params.handle);
	} catch (err) {
		throw new XRPCError({
			status: 404,
			error: "HandleNotFound",
			message: `Could not resolve handle '${params.handle}': ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	const session = env.DB.withSession("first-primary");
	const result = await lookupPackage(session, env, did, params.slug);
	if (result.state !== "visible") throwPackageLookupError(result);
	const view = packageView(result.row);
	view.handle = params.handle;
	return json(view);
}
