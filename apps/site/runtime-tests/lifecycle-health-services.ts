import { z } from "zod";

import analytics from "../../../workers/analytics/src/index.js";
import api from "../../../workers/api/src/index.js";
import app from "../../../workers/app/src/index.js";
import billing from "../../../workers/billing/src/index.js";
import customReference from "../../../workers/custom/reference/src/index.js";
import dynamicLinks from "../../../workers/dynamic-links/src/index.js";
import email from "../../../workers/email/src/index.js";
import files from "../../../workers/files/src/index.js";
import flows from "../../../workers/flows/src/index.js";
import identity from "../../../workers/identity/src/index.js";
import marketing from "../../../workers/marketing/src/index.js";
import mcp from "../../../workers/mcp/src/index.js";
import observability from "../../../workers/observability/src/index.js";
import onboardings from "../../../workers/onboardings/src/index.js";
import paywalls from "../../../workers/paywalls/src/index.js";
import products from "../../../workers/products/src/index.js";
import support from "../../../workers/support/src/index.js";

const workers = {
	CUSTOM_WORKER: ["custom-reference", customReference],
	IDENTITY_SERVICE: ["identity", identity],
	APP_MODULE: ["app", app],
	PRODUCTS_MODULE: ["products", products],
	BILLING: ["api", billing],
	SUPPORT_MODULE: ["support", support],
	FLOWS_MODULE: ["flows", flows],
	ANALYTICS_MODULE: ["analytics", analytics],
	MARKETING_MODULE: ["marketing", marketing],
	EMAIL_SERVICE: ["email", email],
	DYNAMIC_LINKS_MODULE: ["dynamic-links", dynamicLinks],
	FILES_SERVICE: ["files", files],
	PAYWALLS_MODULE: ["paywalls", paywalls],
	ONBOARDINGS_MODULE: ["onboardings", onboardings],
	OBSERVABILITY: ["observability", observability],
	MCP_SERVICE: ["mcp", mcp],
} as const;

export async function dispatchLifecycleApi(
	request: Request,
	env: Record<string, unknown>,
	execution: ExecutionContext,
) {
	const migrations = z
		.record(z.string(), z.array(z.object({ name: z.string() })))
		.parse(JSON.parse(String(env.HEALTH_MIGRATIONS_JSON)));
	const base = {
		...env,
		KV: env.RELEASE_CACHE,
		R2: env.MEDIA,
		PUBLIC_ROUTING_MODE: "active",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		ENVIRONMENT: "local",
		SUPERBOARD_TARGET: "reference-production",
		PUBLIC_API_URL: "https://api.site.test",
		PUBLIC_MCP_URL: "https://mcp.site.test",
		API_DOMAIN: "api.site.test",
		SDK_DOMAIN: "sdk.site.test",
		MCP_DOMAIN: "mcp.site.test",
		AUTH_DOMAIN: "auth.site.test",
		SHORTLINK_DOMAIN: "links.site.test",
		OBSERVABILITY_INTERNAL_TOKEN: "runtime-observability-secret",
		ANALYTICS_DATASET: "runtime",
		MAIL_PROVIDER: env.HEALTH_MAIL_PROVIDER ?? "smtp",
		MAIL_TRANSPORT:
			env.HEALTH_MAIL_PROVIDER === "aws-ses" ||
			request.headers.get("X-Test-Email-Transport") === "smtp"
				? "smtp"
				: "capture",
		IDENTITY_KEYSET: env.HEALTH_IDENTITY_KEYSET,
		REGISTRATION_MODE: "open",
		APPLICATION_AUDIENCE: "autonomy.application",
		OPENGROW_IDENTITY_ISSUER: "https://api.site.test",
		OPENGROW_IDENTITY_AUDIENCE: "opengrow",
		OPENGROW_IDENTITY_TOKEN_TTL: "300",
		ACCESS_TOKEN_TTL: "900",
		REFRESH_TOKEN_TTL: "2592000",
		GOOGLE_AUDIENCES_JSON:
			request.headers.get("IDENTIFIER") === "retirement-user.example.test"
				? '["retirement-provider-client"]'
				: "[]",
		APPLE_AUDIENCES_JSON: "[]",
		MAIL_FROM_NAME: "Runtime",
		MAIL_FROM_ADDRESS: "noreply@example.test",
		MAIL_PREVIEW_TOKEN: "runtime-preview-secret",
		EMAIL_INTERNAL_TOKEN: "runtime-email-secret",
		EMAIL_SMTP_ENCRYPTION_KEY: "runtime-email-encryption-key",
		CUSTOM_WORKER_TOKEN: "retirement-custom-secret",
		APP_KEY: "reference-production",
		MODULE_INTERNAL_TOKEN: "runtime-module-secret",
		FLOWS_INTERNAL_TOKEN: "runtime-flows-secret",
		FILES_INTERNAL_TOKEN: "runtime-files-secret",
		FILES: env.HEALTH_FILES_R2,
		MAX_FILE_BYTES: "10485760",
		ALLOWED_FILE_CONTENT_TYPES_JSON: JSON.stringify(["image/png", "image/jpeg", "application/pdf"]),
	};
	const services = Object.fromEntries(
		Object.entries(workers).map(([binding, [name, worker]]) => [
			binding,
			{
				fetch: async (input: Request | string | URL, init?: RequestInit) => {
					const forwarded = new Request(input, init);
					const moduleEnv = {
						...base,
						SITE_SERVICE: undefined,
						EMAIL_SERVICE: services.EMAIL_SERVICE,
						SITE_OPERATOR_BRIDGE_TOKEN: undefined,
						API_SERVICE: {
							fetch: (apiInput: Request | string | URL, apiInit?: RequestInit) =>
								api.fetch(
									new Request(apiInput, apiInit),
									apiEnv,
									pluginTaskContext(
										execution,
										binding === "BILLING"
											? "supbrd-plugmod-billing"
											: binding === "APP_MODULE" || binding === "IDENTITY_SERVICE"
												? "supbrd-plug-user"
												: binding === "PRODUCTS_MODULE"
													? "supbrd-plug-products"
													: `supbrd-plugmod-${name}`,
									),
								),
						},
						INTERNAL_API_TOKEN:
							name === "flows" ? base.FLOWS_INTERNAL_TOKEN : base.MODULE_INTERNAL_TOKEN,
						DB: env[`HEALTH_${name.replaceAll("-", "_").toUpperCase()}_DB`],
						REFERENCE_DB: env.HEALTH_CUSTOM_REFERENCE_DB,
						D1_EXPECTED_MIGRATION: migrations[name]?.at(-1)?.name,
					};
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each imported real Worker receives its isolated migrated test database
					const response = await worker.fetch(forwarded, moduleEnv as never, execution);
					return response;
				},
			},
		]),
	);
	const apiEnv = {
		...base,
		...services,
		DB: env.HEALTH_API_DB,
		D1_EXPECTED_MIGRATION: migrations.api?.at(-1)?.name,
	};
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- actual API Worker with local D1/KV and service bindings to real Worker handlers
	return api.fetch(request, apiEnv, execution);
}

export function pluginTaskContext(context: ExecutionContext, pluginId: string): ExecutionContext {
	return new Proxy(context, {
		get(target, property) {
			if (property === "props") return { superboard_plugin_id: pluginId };
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
