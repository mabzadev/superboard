import { json } from "@atcute/xrpc-server";
import { type AggregatorDefs, type AggregatorGetPackage } from "@emdash-cms/registry-lexicons";

import { lookupPackage, throwPackageLookupError } from "./listing-query.js";
import { packageView } from "./views.js";

export async function getPackage(
	env: Env,
	params: AggregatorGetPackage.$params,
): Promise<Response> {
	const session = env.DB.withSession("first-primary");
	const result = await lookupPackage(session, env, params.did, params.slug);
	if (result.state !== "visible") throwPackageLookupError(result);
	const view: AggregatorDefs.PackageView = packageView(result.row);
	return json(view);
}
