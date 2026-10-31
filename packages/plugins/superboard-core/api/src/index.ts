import { parseDeploymentConfiguration } from "@superboard/contracts/deployment-configuration";
import { inspectSqlSchemaHealth } from "@superboard/contracts/health";
import {
	PROJECT_CONTEXT_HEADERS,
	signProjectContext,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { RequestBodyError, readJsonObjectLimited } from "@superboard/contracts/request-body";
import { serializeRouteManifest } from "@superboard/contracts/route-manifest";
import { withRouteManifest } from "@superboard/contracts/route-manifest";
import {
	INTERNAL_ROUTE_REFERENCES_PATH,
	INTERNAL_ROUTE_OWNER_PATH,
	requestedRouteReferences,
	selectRouteReferences,
	RouteReferenceError,
} from "@superboard/contracts/route-reference";
import { registerRouter, registeredRequestDefinition } from "@superboard/contracts/route-registry";
import { resolveRegisteredRoute } from "@superboard/contracts/route-registry";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { resumePendingAccountErasures } from "./lib/account-erasure";
import { refreshAppleNotificationConfigurationsIfDue } from "./lib/apple-notification-configuration";
import { getRequestAuthContext } from "./lib/auth";
import { isBillingQueueJob } from "./lib/billing-dispatch";
import {
	proxyBillingLedger,
	billingLedgerRoute,
	migrateProductsLedger,
	proxyTransferredProductsLedger,
	relayBillingLedger,
} from "./lib/billing-ledger-proxy.js";
import {
	billingServiceEnabled,
	dispatchBillingServiceJob,
	purchasesJwksFromBillingAuthority,
} from "./lib/billing-service";
import { delegatedAppOwner } from "./lib/delegated-route-owner.js";
import { isSsoEnabled } from "./lib/deployment";
import { deploymentRoutes, deploymentWebOrigins } from "./lib/deployment-routes.js";
import {
	DOMAIN_MODULES,
	legacyDomainDestinations,
	domainRouteDestination,
	DOMAIN_SDK_ROUTES,
	PUBLIC_FLOWS_SDK_ROUTES,
	isDomainSdkRoutePath,
	isPublicFlowsSdkRoutePath,
	proxyDomainModule,
	proxyDomainSdkModule,
	proxyLegacyDomainModule,
	proxyPublicFlows,
	proxyPublicMarketing,
	resolveSdkProjectContext,
	resolveAuthorizedProjectContext,
} from "./lib/domain-modules";
import {
	apiRouteSources,
	executingRouteInventory,
	routeReferenceCandidates,
} from "./lib/executing-route-inventory.js";
import { readTextLimited } from "./lib/http-limits";
import { dispatchQueueJob } from "./lib/jobs";
import { proxyAwsSesEvent } from "./lib/mail";
import { runMaintenance } from "./lib/maintenance";
import { quarantinePlatformDeadLetter } from "./lib/platform-dead-letters";
import { pluginHttpAdmission } from "./lib/plugin-http-admission.js";
import { inspectSitePluginWorkerHealth } from "./lib/site-plugin-health";
import {
	isSupportWidgetPath,
	proxySupportProviderEvent,
	proxySupportSurface,
} from "./lib/support-gateway";
import adminRoutes from "./routes/admin";
import { applicationModuleAdmin } from "./routes/application-module-admin.js";
import { applicationPluginRoutes } from "./routes/application-plugin.js";
import applicationUsersAdminRoutes from "./routes/application-users-admin";
import authRoutes from "./routes/auth";
import automationRoutes from "./routes/automation";
import coreCollection, { collectSdkTelemetry } from "./routes/core-collection.js";
import diagnosticsRoutes from "./routes/diagnostics";
import { emailPublicRoutes } from "./routes/email-public.js";
import { filesAdmin, filesAdminRoute } from "./routes/files-admin.js";
import { gatewayAdmin, GATEWAY_ADMIN_PREFIX } from "./routes/gateway-admin.js";
import iapRoutes from "./routes/iap";
import identityAdminRoutes from "./routes/identity-admin";
import identitySsoRoutes from "./routes/identity-sso";
import inboxAdminRoutes from "./routes/inbox-admin";
import instancesRoutes from "./routes/instances";
import linksRoutes from "./routes/links";
import mcpRoutes from "./routes/mcp";
import mcpOauthRoutes from "./routes/mcp-oauth";
import { mcpOperator } from "./routes/mcp-operator.js";
import messagingAdminRoutes from "./routes/messaging-admin";
import oauthRoutes from "./routes/oauth";
import {
	observabilityAdmin,
	receiveObservabilityObservation,
	readObservabilitySummary,
} from "./routes/observability-admin.js";
import platformStatusRoutes, { workerTopology } from "./routes/platform-status";
import pluginTasks from "./routes/plugin-tasks.js";
import projectsRoutes from "./routes/projects";
import purchasesAdminRoutes from "./routes/purchases-admin";
import purchasesProviderWebhooks from "./routes/purchases-provider-webhooks";
import purchasesV2AdminRoutes from "./routes/purchases-v2-admin";
import pushRoutes, { internalPush } from "./routes/push";
import redirectRoute from "./routes/redirect";
import sdkRoutes from "./routes/sdk";
import siteOperatorRoutes from "./routes/site-operator";
import usersRoutes from "./routes/users";
import wellKnownRoutes from "./routes/well-known";
import { Env } from "./types";

export const app = registerRouter(new Hono<{ Bindings: Env }>(), {
	service: "api",
	module: "index.app",
	pluginId: "supbrd-core",
	surface: "internal",
	access: "operator",
});

app.onError((error, c) => {
	if (error instanceof RequestBodyError) {
		return c.json({ error: { code: error.code, message: error.message } }, error.status);
	}
	console.error(
		JSON.stringify({
			event: "api_unhandled_error",
			requestId: c.req.header("x-request-id") || null,
			method: c.req.method,
			path: new URL(c.req.url).pathname,
			error: error instanceof Error ? error.message : String(error),
		}),
	);
	return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
});

const corsMiddleware = cors({
	origin: (origin, c) =>
		isPublicFlowsSdkRoutePath(new URL(c.req.url).pathname) ||
		isSupportWidgetPath(new URL(c.req.url).pathname)
			? allowedEmbeddableSdkOrigin(origin)
			: allowedCorsOrigin(origin, c.env.CORS_ORIGINS_JSON),
	allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
	allowHeaders: [
		"Content-Type",
		"Authorization",
		"X-Api-Key",
		"X-AUTH",
		"X-Project-Id",
		"X-Project-Ref",
		"X-Request-Id",
		"PROJECT-KEY",
		"PLATFORM",
		"IDENTIFIER",
		"X-SuperBoard-Anonymous-ID",
		"X-SuperBoard-App-Version",
		"X-SuperBoard-Build-Number",
		"X-SuperBoard-SDK-Version",
		"X-SuperBoard-Language",
		"X-SuperBoard-Storefront",
		"X-SuperBoard-Campaign",
		"X-SuperBoard-Project-Id",
		"X-SuperBoard-Anonymous-ID",
		"X-SuperBoard-App-Version",
		"X-SuperBoard-Build-Number",
		"X-SuperBoard-SDK-Version",
		"X-SuperBoard-Storefront",
		"X-SuperBoard-Campaign",
		"X-SuperBoard-Project-Id",
		"Idempotency-Key",
		"X-Flows-Version",
		"X-SuperBoard-Flows-SDK-Key",
		"X-SuperBoard-Widget-Key",
		"X-SuperBoard-Widget-Visitor",
		"X-SuperBoard-Widget-Signature",
		"X-SuperBoard-Widget-Timestamp",
		"X-Filename",
		"ENVIRONMENT",
		"LINKSQUARED",
		"x-maintenance-key",
		"x-diagnostics-key",
	],
	exposeHeaders: ["Content-Disposition", "X-Request-Id"],
});
app
	.defineRoute({
		id: "api:cors",
		access: "public",
		exposures: [
			{ surface: "sdk", path: "/*" },
			{ surface: "shortlinks", path: "/*" },
		],
	})
	.options("*", corsMiddleware);
app.use("*", corsMiddleware);

export function allowedCorsOrigin(
	origin: string,
	configured: string | undefined,
): string | undefined {
	try {
		const candidate = new URL(origin).origin;
		if (candidate !== origin.replace(/\/$/u, "")) return undefined;
		const values: unknown = JSON.parse(configured || "[]");
		if (!Array.isArray(values)) return undefined;
		return values.some(
			(value) => typeof value === "string" && value.replace(/\/$/u, "") === candidate,
		)
			? candidate
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * Flows environment keys are intentionally public client credentials. Its web
 * SDK must therefore work on the customer origins where a flow is embedded,
 * while still rejecting malformed/non-HTTP Origin values.
 */
export function allowedEmbeddableSdkOrigin(origin: string): string | undefined {
	try {
		const candidate = new URL(origin);
		const normalized = origin.replace(/\/$/u, "");
		if (
			candidate.origin !== normalized ||
			!new Set(["https:", "http:"]).has(candidate.protocol) ||
			candidate.username ||
			candidate.password
		) {
			return undefined;
		}
		return candidate.origin;
	} catch {
		return undefined;
	}
}

// Public readiness for the API route. It deliberately verifies the central
// state authorities instead of returning a process-only liveness response.
app
	.defineRoute({
		pluginId: "supbrd-core",
		surface: "internal",
		access: "public",
		exposures: [
			{ surface: "sdk", path: "/health" },
			{ surface: "custom-api", path: "/health" },
			{ surface: "shortlinks", path: "/health" },
		],
	})
	.get("/health", async (c) => {
		try {
			const [database, , schema] = await Promise.all([
				c.env.DB.prepare("SELECT 1 AS ready").first<{ ready: number }>(),
				c.env.KV.get("superboard:health:read-probe"),
				inspectSqlSchemaHealth(c.env.DB, c.env.D1_EXPECTED_MIGRATION),
			]);
			if (Number(database?.ready) !== 1) throw new Error("database_readiness_failed");
			if (!c.env.API_DOMAIN || !c.env.SDK_DOMAIN || !c.env.SHORTLINK_DOMAIN) {
				throw new Error("public_domain_configuration_missing");
			}
			const current = schema.status === "current";
			return c.json(
				{
					status: current ? "ok" : "degraded",
					service: "superboard-api",
					environment: c.env.ENVIRONMENT,
					host: c.req.header("host"),
					timestamp: new Date().toISOString(),
					schema,
					...(current ? {} : { reason: "database_schema_not_current" }),
					dependencies: {
						d1: current ? "ok" : "schema_not_current",
						kv: "ok",
						publicDomains: "configured",
					},
				},
				current ? 200 : 503,
				{ "cache-control": "no-store" },
			);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "api_readiness_failed",
					error: error instanceof Error ? error.message : String(error),
				}),
			);
			return c.json(
				{
					status: "degraded",
					service: "superboard-api",
					environment: c.env.ENVIRONMENT,
					timestamp: new Date().toISOString(),
					dependencies: { d1: "unavailable", kv: "unavailable" },
				},
				503,
				{ "cache-control": "no-store" },
			);
		}
	});

app.get("/health/billing", async (c) => {
	if (!c.env.BILLING) return c.json({ status: "unavailable", service: "superboard-billing" }, 503);
	try {
		const response = await c.env.BILLING.fetch("https://billing.internal/internal/v1/health", {
			signal: AbortSignal.timeout(5_000),
		});
		const payload = JSON.parse(await readTextLimited(response, 16_384));
		return c.json(
			{ ...payload, routing_mode: c.env.BILLING_EXECUTION_MODE || "local" },
			response.ok ? 200 : 503,
		);
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "billing_health_failed",
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		return c.json(
			{
				status: "unavailable",
				service: "superboard-billing",
				routing_mode: c.env.BILLING_EXECUTION_MODE || "local",
			},
			503,
		);
	}
});

app.defineRoute(filesAdminRoute).all(filesAdminRoute.path, filesAdmin);
app.route(
	GATEWAY_ADMIN_PREFIX,
	gatewayAdmin(app, async (c, request) => app.fetch(request, c.env, c.executionCtx)),
);
app.get("/up", (c) => c.text("OK", 200));
app.get("/favicon.ico", (c) => c.body(null, 204));

app
	.defineRoute({ pluginId: "superboard-billing", surface: "sdk", access: "public" })
	.get("/.well-known/purchases-jwks.json", async (c) => {
		try {
			return c.json(await purchasesJwksFromBillingAuthority(c.env), 200, {
				"Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
			});
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "purchases_jwks_unavailable",
					error: error instanceof Error ? error.message : String(error),
				}),
			);
			return c.json({ error: "Purchases verification keys unavailable" }, 503);
		}
	});

app
	.defineRoute({ pluginId: "superboard-user", surface: "internal", access: "public" })
	.get("/.well-known/jwks.json", (c) => {
		if ((c.req.header("host") || "") === c.env.AUTH_DOMAIN) {
			return proxyAuthGateway(c.req.raw, c.env.IDENTITY_SERVICE, "/.well-known/jwks.json");
		}
		return proxyPublicService(c.req.raw, c.env.IDENTITY_SERVICE, "/.well-known/jwks.json");
	});

app.use("*", pluginHttpAdmission);

app.route("/internal/collection/v1", coreCollection);
app
	.defineRoute({
		pluginId: "supbrd-core",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{ surface: "sdk", path: "/v1/data/events", aliases: ["/api/v1/collection/events"] },
		],
	})
	.post("/api/v1/collection/events", async (c) => {
		const resolved = await resolveSdkProjectContext(c.env.DB, c.req.raw, c.env);
		if (!resolved.ok)
			return c.json({ error: { code: resolved.code, message: resolved.message } }, resolved.status);
		return collectSdkTelemetry(c, resolved.context.projectId);
	});

// =============================================
// Route requests by subdomain
// =============================================
app.defineRoute({ continuation: true }).all("*", async (c, next) => {
	const host = c.req.header("host") || new URL(c.req.url).hostname;
	const customPath = new URL(c.req.url).pathname;
	if (
		host === c.env.API_DOMAIN &&
		(customPath === "/custom/v1" || customPath.startsWith("/custom/v1/"))
	)
		return sdkRoutes.fetch(c.req.raw, c.env);

	if (host === c.env.AUTH_DOMAIN && host !== c.env.SDK_DOMAIN) {
		const url = new URL(c.req.url);
		return proxyAuthGateway(c.req.raw, c.env.IDENTITY_SERVICE, `${url.pathname}${url.search}`);
	}

	if (host === c.env.FILES_DOMAIN && host !== c.env.SDK_DOMAIN) {
		const url = new URL(c.req.url);
		if (url.pathname === "/v1/files" || url.pathname.startsWith("/v1/files/")) {
			return proxyPublicService(c.req.raw, c.env.FILES_SERVICE, `${url.pathname}${url.search}`);
		}
		return c.notFound();
	}

	// Mobile SDK custom domain.
	if (host === c.env.SDK_DOMAIN) {
		const pathname = new URL(c.req.url).pathname;
		if (
			pathname === "/api/v1/sdk" ||
			pathname.startsWith("/api/v1/sdk/") ||
			isDomainSdkRoutePath(pathname)
		) {
			return next();
		}
		return sdkRoutes.fetch(c.req.raw, c.env);
	}

	// Short-link custom domain and well-known resources.
	// The workers.dev host is also accepted for tests.
	return next();
});

// =====================================
// Routes for the custom domain and workers.dev.
// =====================================
app
	.defineRoute({ surface: "internal", access: "internal" })
	.get("/internal/site/plugin-health/:pluginId", async (c) => {
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator) return c.json({ error: { code: "OPERATOR_SESSION_REQUIRED" } }, 401);
		return inspectSitePluginWorkerHealth(c.env, c.req.param("pluginId"));
	});
app.route("/internal/site-operator", siteOperatorRoutes);
app.route("/internal/plugin-tasks", pluginTasks);
app.all("/api/v1/plugins/:plugin/projects/:projectRef/*", applicationModuleAdmin);
app.route("/api/v1/auth", authRoutes);
app
	.defineRoute({
		pluginId: "superboard-user",
		surface: "sdk",
		access: "framework",
		exposures: [{ surface: "sdk", path: "/v1/auth", aliases: ["/auth"] }],
	})
	.all("/auth", (c) => proxyIdentityAuth(c.req.raw, c.env, "/auth"));
app
	.defineRoute({
		pluginId: "superboard-user",
		surface: "sdk",
		access: "framework",
		exposures: [
			{ surface: "sdk", path: "/v1/auth/*", aliases: ["/auth/*"] },
			{
				surface: "sdk",
				path: "/v1/auth/oauth2/v1/*",
				executionPath: "/auth/hosted/oauth2/v1/*",
				aliases: ["/oauth2/v1/*"],
			},
			{
				surface: "sdk",
				path: "/v1/auth/identity/v1/*",
				executionPath: "/auth/hosted/identity/v1/*",
				aliases: ["/identity/v1/*"],
			},
			{
				surface: "sdk",
				path: "/v1/auth/embedded-auth/v1/*",
				executionPath: "/auth/hosted/embedded-auth/v1/*",
				aliases: ["/embedded-auth/v1/*"],
			},
			{
				surface: "sdk",
				path: "/v1/auth/saml/sp/v1/*",
				executionPath: "/auth/hosted/saml/sp/v1/*",
				aliases: ["/saml/sp/v1/*"],
			},
			{
				surface: "sdk",
				path: "/v1/auth/client.js",
				executionPath: "/auth/hosted/client.js",
				aliases: ["/client.js"],
			},
			{
				surface: "sdk",
				path: "/v1/auth/client.css",
				executionPath: "/auth/hosted/client.css",
				aliases: ["/client.css"],
			},
			{
				surface: "sdk",
				path: "/v1/auth/.well-known/jwks.json",
				executionPath: "/auth/hosted/.well-known/jwks.json",
				aliases: ["/.well-known/jwks.json"],
			},
			{
				surface: "sdk",
				path: "/v1/auth/.well-known/openid-configuration",
				executionPath: "/auth/hosted/.well-known/openid-configuration",
				aliases: ["/.well-known/openid-configuration"],
			},
			{
				surface: "sdk",
				path: "/v1/auth/.well-known/application-jwks.json",
				executionPath: "/auth/application-jwks",
			},
		],
	})
	.all("/auth/*", async (c) => {
		const url = new URL(c.req.url);
		if (url.pathname === "/auth/application-jwks")
			return proxyPublicService(c.req.raw, c.env.IDENTITY_SERVICE, "/.well-known/jwks.json");
		if (url.pathname.startsWith("/auth/hosted/")) {
			const hostedPath = url.pathname.slice("/auth/hosted".length);
			if (
				!/^\/(?:oauth2\/v1\/|identity\/v1\/|embedded-auth\/v1\/|saml\/sp\/v1\/)/u.test(
					hostedPath,
				) &&
				![
					"/client.js",
					"/client.css",
					"/.well-known/jwks.json",
					"/.well-known/openid-configuration",
				].includes(hostedPath)
			)
				return c.notFound();
			return proxyAuthGateway(c.req.raw, c.env.IDENTITY_SERVICE, `${hostedPath}${url.search}`);
		}
		if (c.req.method === "DELETE" && url.pathname === "/auth/me") {
			return c.json(
				{
					error: {
						code: "account_erasure_route_required",
						message: "Use DELETE /api/v1/sdk/account/v1 with the application SDK headers",
						retryable: false,
					},
				},
				410,
				{ "cache-control": "private, no-store" },
			);
		}
		return await proxyIdentityAuth(c.req.raw, c.env, `${url.pathname}${url.search}`);
	});
app
	.defineRoute({
		pluginId: "superboard-files",
		surface: "sdk",
		access: "sdk-key",
		destination: { service: "files", path: "/v1/files" },
		exposures: [
			{ surface: "sdk", path: "/v1/data/files", aliases: ["/api/v1/app-files", "/v1/files"] },
		],
	})
	.all("/api/v1/app-files", (c) => proxyFilesAlias(c.req.raw, c.env.FILES_SERVICE));
app
	.defineRoute({
		pluginId: "superboard-files",
		surface: "sdk",
		access: "sdk-key",
		destination: { service: "files", path: "/v1/files/*" },
		exposures: [
			{ surface: "sdk", path: "/v1/data/files/*", aliases: ["/api/v1/app-files/*", "/v1/files/*"] },
		],
	})
	.all("/api/v1/app-files/*", (c) => proxyFilesAlias(c.req.raw, c.env.FILES_SERVICE));
app
	.defineRoute({
		pluginId: "superboard-files",
		surface: "sdk",
		access: "sdk-key",
		destination: { service: "files", path: "/v1/downloads/:ticket" },
		exposures: [
			{
				surface: "sdk",
				path: "/v1/data/downloads/:ticket",
				aliases: ["/api/v1/app-downloads/:ticket", "/v1/downloads/:ticket"],
			},
		],
	})
	.get("/api/v1/app-downloads/:ticket", (c) =>
		proxyPublicService(
			c.req.raw,
			c.env.FILES_SERVICE,
			`/v1/downloads/${encodeURIComponent(c.req.param("ticket"))}`,
		),
	);
app.route("/api/v1/users", usersRoutes);
app.route("/api/v1/instances", instancesRoutes);
app.route("/api/v1/projects", projectsRoutes);
app.route("/api/v1/mcp/operator", mcpOperator);
app.route("/api/v1/mcp", mcpRoutes);
app.route("/api/v1/links", linksRoutes);
app.route("/api/v1/sdk", sdkRoutes);
app.route("/api/v1/push", pushRoutes);
app.route("/internal/v1/push", internalPush);
app.route("/api/v1/iap", iapRoutes);
app.use("/api/v1/identity/sso/*", async (c, next) => {
	if (!isSsoEnabled(c.env)) return c.notFound();
	return next();
});
app.route("/api/v1/identity/sso", identitySsoRoutes);
app.route("/api/v1/automation", automationRoutes);
app.route("/api/v1/diagnostics", diagnosticsRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/platform", platformStatusRoutes);
app
	.defineRoute({ surface: "internal", access: "internal" })
	.post("/internal/observability/observations", receiveObservabilityObservation);
app
	.defineRoute({ surface: "internal", access: "internal" })
	.get("/internal/observability/summary", readObservabilitySummary);
app.route("/api/v1/observability", observabilityAdmin);
app.route("/api/v1/application-users/projects", applicationUsersAdminRoutes);
app.route("/", applicationPluginRoutes);
app.route("/api/v1/identity-admin/projects", identityAdminRoutes);
app
	.defineRoute({
		pluginId: "superboard-marketing",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/communication/marketing/tracking/:action/:token",
				aliases: ["/api/v1/marketing/tracking/:action/:token"],
			},
		],
	})
	.all("/api/v1/marketing/tracking/:action/:token", (c) => {
		const action = c.req.param("action");
		if (!["open", "click", "unsubscribe"].includes(action)) return c.notFound();
		return proxyPublicMarketing(c, `/public/v1/tracking/${action}/${c.req.param("token")}`);
	});
app
	.defineRoute({
		pluginId: "superboard-marketing",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/communication/marketing/opt-in/:token",
				aliases: ["/api/v1/marketing/opt-in/:token"],
			},
		],
	})
	.all("/api/v1/marketing/opt-in/:token", (c) => {
		if (!["GET", "POST"].includes(c.req.method)) return c.notFound();
		return proxyPublicMarketing(c, `/public/v1/opt-in/${c.req.param("token")}`);
	});
app
	.defineRoute({
		pluginId: "superboard-marketing",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/communication/marketing/preferences/:token",
				aliases: ["/api/v1/marketing/preferences/:token"],
			},
		],
	})
	.all("/api/v1/marketing/preferences/:token", (c) => {
		if (!["GET", "POST"].includes(c.req.method)) return c.notFound();
		return proxyPublicMarketing(c, `/public/v1/preferences/${c.req.param("token")}`);
	});
app
	.defineRoute({
		pluginId: "superboard-marketing",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/communication/marketing/forms/:formId",
				aliases: ["/api/v1/marketing/forms/:formId"],
			},
		],
	})
	.all("/api/v1/marketing/forms/:formId", (c) => {
		if (!["GET", "POST"].includes(c.req.method)) return c.notFound();
		return proxyPublicMarketing(c, `/public/v1/forms/${c.req.param("formId")}`);
	});
app
	.defineRoute({
		pluginId: "superboard-marketing",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/communication/marketing/forms/:formId/embed.js",
				aliases: ["/api/v1/marketing/forms/:formId/embed.js"],
			},
		],
	})
	.get("/api/v1/marketing/forms/:formId/embed.js", (c) =>
		proxyPublicMarketing(c, `/public/v1/forms/${c.req.param("formId")}/embed.js`),
	);
app
	.defineRoute({
		pluginId: "superboard-marketing",
		surface: "sdk",
		access: "provider-signature",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/communication/marketing/provider-webhooks/:endpointId",
				aliases: ["/api/v1/marketing/provider-webhooks/:endpointId"],
			},
		],
	})
	.post("/api/v1/marketing/provider-webhooks/:endpointId", (c) =>
		proxyPublicMarketing(c, `/public/v1/provider-webhooks/${c.req.param("endpointId")}`),
	);
app
	.defineRoute({
		pluginId: "superboard-email",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/communication/email/aws-ses/events",
				aliases: ["/api/v1/email/aws-ses/events"],
			},
		],
	})
	.post("/api/v1/email/aws-ses/events", (c) => proxyAwsSesEvent(c.env, c.req.raw));
app.route("/", emailPublicRoutes);
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/realtime/:ticket",
				aliases: ["/v1/communication/support/realtime/:ticket", "/api/v1/support/realtime/:ticket"],
			},
		],
	})
	.get("/api/v1/support/realtime/:ticket", (c) =>
		proxySupportSurface(
			c,
			`/public/v1/realtime/${encodeURIComponent(c.req.param("ticket"))}`,
			"realtime",
		),
	);
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "provider-signature",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/providers/:provider/:endpointId/events",
				aliases: [
					"/v1/communication/support/providers/:provider/:endpointId/events",
					"/api/v1/support/providers/:provider/:endpointId/events",
				],
			},
		],
	})
	.post("/api/v1/support/providers/:provider/:endpointId/events", (c) =>
		proxySupportProviderEvent(c, c.req.param("provider"), c.req.param("endpointId")),
	);
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "provider-signature",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/providers/:provider/:endpointId/events",
				aliases: [
					"/v1/communication/support/providers/:provider/:endpointId/events",
					"/api/v1/support/providers/:provider/:endpointId/events",
				],
			},
		],
	})
	.get("/api/v1/support/providers/:provider/:endpointId/events", (c) =>
		proxySupportProviderEvent(c, c.req.param("provider"), c.req.param("endpointId")),
	);
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "provider-signature",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/providers/:provider/oauth/callback",
				aliases: [
					"/v1/communication/support/providers/:provider/oauth/callback",
					"/api/v1/support/providers/:provider/oauth/callback",
				],
			},
		],
	})
	.get("/api/v1/support/providers/:provider/oauth/callback", (c) =>
		proxySupportSurface(
			c,
			`/public/v1/providers/${encodeURIComponent(c.req.param("provider"))}/oauth/callback`,
			"oauth",
		),
	);
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/widget",
				aliases: ["/v1/communication/support/widget", "/api/v1/support-widget"],
			},
		],
	})
	.all("/api/v1/support-widget", (c) => proxySupportSurface(c, "/public/v1/widget", "widget"));
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/widget/*",
				aliases: ["/v1/communication/support/widget/*", "/api/v1/support-widget/*"],
			},
		],
	})
	.all("/api/v1/support-widget/*", (c) => {
		const url = new URL(c.req.url);
		const suffix = url.pathname.slice("/api/v1/support-widget".length);
		return proxySupportSurface(c, `/public/v1/widget${suffix}`, "widget");
	});
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/help-center",
				aliases: ["/v1/communication/support/help-center", "/api/v1/support/help-center"],
			},
		],
	})
	.all("/api/v1/support/help-center", (c) =>
		proxySupportSurface(c, "/public/v1/help-center", "help-center"),
	);
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/help-center/*",
				aliases: ["/v1/communication/support/help-center/*", "/api/v1/support/help-center/*"],
			},
		],
	})
	.all("/api/v1/support/help-center/*", (c) => {
		const url = new URL(c.req.url);
		const suffix = url.pathname.slice("/api/v1/support/help-center".length);
		return proxySupportSurface(c, `/public/v1/help-center${suffix}`, "help-center");
	});
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/client",
				aliases: ["/v1/communication/support/client", "/api/v1/support-client"],
			},
		],
	})
	.all("/api/v1/support-client", (c) => proxySupportSurface(c, "/v1", "client"));
app
	.defineRoute({
		pluginId: "superboard-support",
		surface: "sdk",
		access: "sdk-key",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/support/client/*",
				aliases: ["/v1/communication/support/client/*", "/api/v1/support-client/*"],
			},
		],
	})
	.all("/api/v1/support-client/*", (c) => {
		const url = new URL(c.req.url);
		const suffix = url.pathname.slice("/api/v1/support-client".length);
		return proxySupportSurface(c, `/v1${suffix}`, "client");
	});
for (const route of DOMAIN_SDK_ROUTES) {
	app.defineRoute(route.registry).post(route.publicPath, (c) => proxyDomainSdkModule(c, route));
}
for (const route of PUBLIC_FLOWS_SDK_ROUTES) {
	if (route.method === "POST") {
		app
			.defineRoute(route.registry)
			.post(route.publicPath, (c) => proxyPublicFlows(c, route.internalPath));
	} else {
		app
			.defineRoute(route.registry)
			.get(route.publicPath, (c) => proxyPublicFlows(c, route.internalPath));
	}
}
app
	.defineRoute({
		pluginId: "superboard-email",
		surface: "sdk",
		access: "provider-signature",
		exposures: [
			{
				surface: "sdk",
				path: "/v1/communication/email/provider-webhooks/:endpointId",
				aliases: ["/api/v1/email/provider-webhooks/:endpointId"],
			},
		],
	})
	.post("/api/v1/email/provider-webhooks/:endpointId", async (c) => {
		if (!c.env.EMAIL_SERVICE) return c.json({ error: { code: "email_service_unavailable" } }, 503);
		return c.env.EMAIL_SERVICE.fetch(
			new Request(
				`https://email.internal/public/v1/provider-webhooks/${encodeURIComponent(c.req.param("endpointId"))}`,
				c.req.raw,
			),
		);
	});

for (const resource of ["purchases", "refunds", "subscriptions"]) {
	app.all(`/api/v1/products/projects/:projectRef/${resource}`, proxyTransferredProductsLedger);
	app.all(`/api/v1/products/projects/:projectRef/${resource}/*`, proxyTransferredProductsLedger);
}
app.all(
	"/api/v1/products/projects/:projectRef/customers/:customerId/entitlements",
	proxyTransferredProductsLedger,
);
app
	.defineRoute({ surface: "internal", access: "internal" })
	.all("/internal/billing/catalog-ledger", relayBillingLedger);
app
	.defineRoute({ surface: "internal", access: "internal" })
	.all("/internal/billing/catalog-ledger/:rest{.+}", relayBillingLedger);
for (const [moduleName, declaration] of Object.entries(DOMAIN_MODULES)) {
	const name = moduleName as keyof typeof DOMAIN_MODULES;
	const binding = declaration.binding;
	const moduleRoutes = app.defineRoute({
		pluginId: declaration.pluginId,
		surface: "internal",
		access: "operator",
		...(name === "app" ? ({ delegatedOwner: "app" } as const) : {}),
	});
	if (name === "paywalls" || name === "onboardings") {
		moduleRoutes.all(`/api/v1/${name}`, (c) => proxyLegacyDomainModule(c, name));
		app
			.defineRoute({
				id: `api:${name}:operator-proxy`,
				pluginId: declaration.pluginId,
				surface: "internal",
				access: "operator",
				transport: "fallback",
				destinations: Object.values(legacyDomainDestinations(name)),
			})
			.all(`/api/v1/${name}/*`, (c) => proxyLegacyDomainModule(c, name));
	} else {
		moduleRoutes.all(`/api/v1/${name}`, (c) => proxyDomainModule(c, name, binding));
		app
			.defineRoute({
				pluginId: declaration.pluginId,
				surface: "internal",
				access: "operator",
				...(name === "app" ? ({ delegatedOwner: "app" } as const) : {}),
				id: `api:${name}:operator-proxy`,
				transport: "fallback",
				destination: domainRouteDestination(name),
			})
			.all(`/api/v1/${name}/*`, (c) => proxyDomainModule(c, name, binding));
	}
}
app
	.defineRoute({
		id: "api:billing:migrate-products",
		pluginId: "superboard-billing",
		surface: "internal",
		access: "operator",
	})
	.post(`${billingLedgerRoute.rootPath}/migrate-products`, migrateProductsLedger);
app
	.defineRoute({
		pluginId: billingLedgerRoute.pluginId,
		surface: "internal",
		access: "operator",
		transport: "fallback",
	})
	.all(billingLedgerRoute.rootPath, proxyBillingLedger);
app.defineRoute(billingLedgerRoute).all(billingLedgerRoute.path, proxyBillingLedger);
app.use("/api/v1/billing/*", async (c, next) =>
	proxyBillingAdmin(c, next, "/api/v1/billing", "/internal/v1/admin/billing"),
);
app.route("/api/v1/billing", purchasesAdminRoutes);
// The v2 admin surface is additive: existing catalogue/customer operations
// stay available while new resources use stable error envelopes.
app.use("/api/v2/purchases/projects/*", async (c, next) =>
	proxyBillingAdmin(c, next, "/api/v2/purchases/projects", "/internal/v1/admin/purchases/projects"),
);
app.route("/api/v2/purchases/projects", purchasesV2AdminRoutes);
app.defineRoute({ mount: "extend" }).route("/api/v2/purchases/projects", purchasesAdminRoutes);
app.route("/api/v2/purchases/providers/webhooks", purchasesProviderWebhooks);
app.route("/api/v2/messaging/projects", messagingAdminRoutes);
app.route("/api/v2/inbox/projects", inboxAdminRoutes);
app.route("/oauth", oauthRoutes);
app.route("/.well-known", wellKnownRoutes);
app.route("", mcpOauthRoutes);

app
	.defineRoute({ id: "api:route-owner", surface: "internal", access: "internal" })
	.post(INTERNAL_ROUTE_OWNER_PATH, async (c) => {
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator) return c.json({ error: { code: "OPERATOR_SESSION_REQUIRED" } }, 401);
		const body = await readJsonObjectLimited(c.req.raw, 16384);
		if (
			typeof body.method !== "string" ||
			!["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"].includes(body.method) ||
			typeof body.path !== "string" ||
			!body.path.startsWith("/") ||
			body.path.startsWith("//") ||
			body.path.includes("?") ||
			body.path.includes("#")
		)
			return c.json({ error: { code: "ROUTE_REQUEST_INVALID" } }, 422);
		const target = new URL(body.path, "https://api.internal");
		if (target.pathname !== body.path)
			return c.json({ error: { code: "ROUTE_REQUEST_INVALID" } }, 422);
		const matched = app.router
			.match(body.method === "HEAD" ? "GET" : body.method, body.path)[0]
			.map(([[, route]]) => route);
		const definition = registeredRequestDefinition(matched);
		if (!definition) return c.json({ error: { code: "ROUTE_OWNER_UNAVAILABLE" } }, 404);
		const headers = new Headers();
		if (typeof body.project_ref === "string") headers.set("X-Project-Ref", body.project_ref);
		const pluginId =
			definition.delegatedOwner === "app"
				? await delegatedAppOwner(new Request(target, { method: body.method, headers }), c.env)
				: definition.ownerBinding
					? (c.env[definition.ownerBinding] ?? definition.pluginId)
					: definition.pluginId;
		return c.json({ pluginId, routeId: definition.id }, 200, {
			"Cache-Control": "private, no-store",
		});
	});

app
	.defineRoute({ id: "api:route-references", surface: "internal", access: "internal" })
	.get(INTERNAL_ROUTE_REFERENCES_PATH, async (c) => {
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator) return c.json({ error: { code: "OPERATOR_SESSION_REQUIRED" } }, 401);
		try {
			const ids = requestedRouteReferences(new URL(c.req.url));
			const { manifest, candidates } = await routeReferenceCandidates(c.env, app, ids);
			const routes = selectRouteReferences(candidates, ids);
			const { instanceId, environment, service, buildId, releaseId } = manifest;
			return c.json(
				await serializeRouteManifest(routes, {
					instanceId,
					environment,
					service,
					buildId,
					...(releaseId ? { releaseId } : {}),
				}),
			);
		} catch (error) {
			if (error instanceof RouteReferenceError) return c.json({ error: { code: error.code } }, 422);
			throw error;
		}
	});

app
	.defineRoute({ surface: "internal", access: "internal" })
	.get("/internal/site/deployment-configuration", async (c) => {
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator) return c.json({ error: { code: "OPERATOR_SESSION_REQUIRED" } }, 401);
		if (!c.env.SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON)
			return c.json({ error: { code: "DEPLOYMENT_CONFIGURATION_UNAVAILABLE" } }, 503);
		const configuration = parseDeploymentConfiguration(
			c.env.SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON,
		);
		const inventory = await executingRouteInventory(c.env, configuration, app);
		return c.json(
			{
				configuration,
				routes: deploymentRoutes(app, configuration, inventory.routes),
				routeInventory: { ...inventory, routes: undefined },
				webOrigins: deploymentWebOrigins(c.env.CORS_ORIGINS_JSON),
				workers: [...workerTopology(c.env).workers.values()].map((worker) => ({
					id: worker.id,
					name: worker.workerName,
				})),
			},
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	});

// Short link redirect — this must remain last.
app.route("", redirectRoute);

function proxyFilesAlias(
	request: Request,
	binding: Fetcher | undefined,
): Promise<Response> | Response {
	const url = new URL(request.url);
	const suffix = url.pathname.slice("/api/v1/app-files".length);
	return proxyPublicService(request, binding, `/v1/files${suffix}${url.search}`);
}

async function proxyPublicService(
	request: Request,
	binding: Fetcher | undefined,
	path: string,
): Promise<Response> {
	if (!binding)
		return Response.json(
			{
				error: {
					code: "service_unavailable",
					message: "Service is unavailable",
					retryable: true,
				},
			},
			{ status: 503 },
		);
	const headers = new Headers();
	for (const name of [
		"authorization",
		"content-type",
		"content-length",
		"accept",
		"range",
		"if-none-match",
		"if-match",
		"x-filename",
		"x-request-id",
		"cf-connecting-ip",
	]) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	const method = request.method.toUpperCase();
	try {
		return await binding.fetch(`https://service.internal${path}`, {
			method,
			headers,
			body: method === "GET" || method === "HEAD" ? null : request.body,
			signal: AbortSignal.timeout(30_000),
		});
	} catch (cause) {
		console.error(
			JSON.stringify({
				event: "public_service_proxy_failed",
				path: path.split("?", 1)[0],
				error: cause instanceof Error ? cause.message : String(cause),
			}),
		);
		return Response.json(
			{
				error: {
					code: "service_unavailable",
					message: "Service is unavailable",
					retryable: true,
				},
			},
			{ status: 503 },
		);
	}
}

async function proxyAuthGateway(
	request: Request,
	binding: Fetcher | undefined,
	path: string,
): Promise<Response> {
	if (!binding) {
		return Response.json(
			{
				error: {
					code: "identity_service_unavailable",
					message: "Identity service is unavailable",
					retryable: true,
				},
			},
			{ status: 503 },
		);
	}

	const headers = new Headers(request.headers);
	for (const name of [
		"connection",
		"host",
		"keep-alive",
		"proxy-authenticate",
		"proxy-authorization",
		"te",
		"trailer",
		"transfer-encoding",
		"upgrade",
	]) {
		headers.delete(name);
	}
	const publicUrl = new URL(request.headers.get("x-superboard-public-origin") || request.url);
	headers.set("x-forwarded-host", publicUrl.host);
	headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
	headers.set("x-superboard-auth-gateway", "1");

	const method = request.method.toUpperCase();
	try {
		return await binding.fetch(`https://identity.internal${path}`, {
			method,
			headers,
			body: method === "GET" || method === "HEAD" ? null : request.body,
			signal: AbortSignal.timeout(30_000),
		});
	} catch (cause) {
		console.error(
			JSON.stringify({
				event: "auth_gateway_proxy_failed",
				path: path.split("?", 1)[0],
				error: cause instanceof Error ? cause.message : String(cause),
			}),
		);
		return Response.json(
			{
				error: {
					code: "identity_service_unavailable",
					message: "Identity service is unavailable",
					retryable: true,
				},
			},
			{ status: 503 },
		);
	}
}

async function proxyIdentityAuth(request: Request, env: Env, path: string): Promise<Response> {
	const pathname = new URL(`https://identity.internal${path}`).pathname;
	const projectRequired =
		new Set([
			"/auth/register",
			"/auth/signin/password",
			"/auth/anonymous",
			"/auth/request-password-reset",
		]).has(pathname) || pathname.startsWith("/auth/signin/");
	if (!projectRequired) {
		return proxyPublicService(request, env.IDENTITY_SERVICE, path);
	}
	if (!env.IDENTITY_SERVICE || !env.MODULE_INTERNAL_TOKEN) {
		return Response.json(
			{ error: { code: "identity_context_unavailable", retryable: true } },
			{ status: 503 },
		);
	}
	const resolved = await resolveSdkProjectContext(env.DB, request, env);
	if (!resolved.ok) {
		return Response.json(
			{
				error: {
					code: resolved.code,
					message: resolved.message,
					retryable: false,
				},
			},
			{ status: resolved.status },
		);
	}
	const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
	const context: InternalProjectContext = {
		...resolved.context,
		actorId: 0,
		role: "sdk",
		requestId,
		issuedAt: Math.floor(Date.now() / 1_000),
		module: "identity",
		method: request.method.toUpperCase(),
		pathname,
	};
	const signature = await signProjectContext(context, env.MODULE_INTERNAL_TOKEN);
	const headers = new Headers(request.headers);
	headers.delete("authorization");
	headers.set(PROJECT_CONTEXT_HEADERS.token, env.MODULE_INTERNAL_TOKEN);
	headers.set(PROJECT_CONTEXT_HEADERS.projectId, String(context.projectId));
	headers.set(PROJECT_CONTEXT_HEADERS.projectRef, context.projectRef);
	headers.set(PROJECT_CONTEXT_HEADERS.instanceId, String(context.instanceId));
	headers.set(PROJECT_CONTEXT_HEADERS.environment, context.environment);
	headers.set(PROJECT_CONTEXT_HEADERS.actorId, "0");
	headers.set(PROJECT_CONTEXT_HEADERS.role, context.role);
	headers.set(PROJECT_CONTEXT_HEADERS.requestId, context.requestId);
	headers.set(PROJECT_CONTEXT_HEADERS.issuedAt, String(context.issuedAt));
	headers.set(PROJECT_CONTEXT_HEADERS.version, "1");
	headers.set(PROJECT_CONTEXT_HEADERS.signature, signature);
	const method = request.method.toUpperCase();
	return env.IDENTITY_SERVICE.fetch(`https://identity.internal${path}`, {
		method,
		headers,
		body: method === "GET" || method === "HEAD" ? null : request.body,
		signal: AbortSignal.timeout(30_000),
	});
}

async function proxyBillingAdmin(
	c: any,
	next: () => Promise<void>,
	publicPrefix: string,
	internalPrefix: string,
) {
	if (!billingServiceEnabled(c.env)) return next();
	const pathname = new URL(c.req.url).pathname;
	if (c.req.method === "POST" && pathname.endsWith("/connections")) return next();
	const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
	if (!auth) return c.json({ error: "Invalid or expired token" }, 401);
	if (!c.env.BILLING)
		return c.json(
			{
				code: "billing_service_unavailable",
				message: "Billing service is unavailable",
				retryable: true,
			},
			503,
		);
	const source = new URL(c.req.url);
	const internalUrl = new URL(
		`https://billing.internal${internalPrefix}${pathname.slice(publicPrefix.length)}`,
	);
	internalUrl.search = source.search;
	const headers = new Headers(c.req.raw.headers);
	if (auth.siteOperator) {
		const projectRef = pathname.slice(publicPrefix.length).split("/").filter(Boolean)[0] ?? "";
		const project = await resolveAuthorizedProjectContext(
			c.env.DB,
			0,
			projectRef,
			auth.siteOperator,
		);
		if (!project.ok)
			return c.json({ error: { code: project.code, message: project.message } }, project.status);
		const secret = c.env.MODULE_INTERNAL_TOKEN;
		if (!secret) return c.json({ error: { code: "BILLING_BRIDGE_UNAVAILABLE" } }, 503);
		const context: InternalProjectContext = {
			...project.context,
			actorId: 0,
			operatorId: auth.siteOperator.operator_id,
			module: "billing",
			method: c.req.method,
			pathname: internalUrl.pathname,
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		};
		for (const name of [
			...Object.values(PROJECT_CONTEXT_HEADERS),
			"X-SuperBoard-Site-Context",
			"X-SuperBoard-Site-Signature",
			"X-SuperBoard-Site-Operator",
			"X-SuperBoard-Internal-Token",
			"X-SuperBoard-Internal-Actor",
			"Cookie",
		])
			headers.delete(name);
		headers.set(PROJECT_CONTEXT_HEADERS.token, secret);
		headers.set(PROJECT_CONTEXT_HEADERS.projectId, String(context.projectId));
		headers.set(PROJECT_CONTEXT_HEADERS.projectRef, context.projectRef);
		headers.set(PROJECT_CONTEXT_HEADERS.instanceId, String(context.instanceId));
		headers.set(PROJECT_CONTEXT_HEADERS.environment, context.environment);
		headers.set(PROJECT_CONTEXT_HEADERS.actorId, "0");
		headers.set(PROJECT_CONTEXT_HEADERS.operatorId, context.operatorId!);
		headers.set(PROJECT_CONTEXT_HEADERS.role, context.role);
		headers.set(PROJECT_CONTEXT_HEADERS.requestId, context.requestId);
		headers.set(PROJECT_CONTEXT_HEADERS.issuedAt, String(context.issuedAt));
		headers.set(PROJECT_CONTEXT_HEADERS.version, "1");
		headers.set(PROJECT_CONTEXT_HEADERS.signature, await signProjectContext(context, secret));
	} else {
		headers.set("X-SuperBoard-Internal-Actor", String(auth.userId));
	}
	headers.delete("Authorization");
	const response = await c.env.BILLING.fetch(
		new Request(internalUrl, {
			method: c.req.method,
			headers,
			body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
		}),
	);
	return new Response(response.body, {
		status: response.status,
		headers: response.headers,
	});
}

export default withRouteManifest(
	{
		async fetch(request, env, ctx) {
			const url = new URL(request.url);
			const publicHeaders = new Headers(request.headers);
			publicHeaders.set("x-superboard-public-path", url.pathname);
			publicHeaders.set("x-superboard-public-origin", url.origin);
			publicHeaders.set("host", url.host);
			request = new Request(request, { headers: publicHeaders });
			const unified = env.AUTH_DOMAIN === env.SDK_DOMAIN && env.FILES_DOMAIN === env.SDK_DOMAIN;
			const host = url.hostname;
			if (
				unified &&
				host === env.API_DOMAIN &&
				url.pathname !== "/health" &&
				!(url.pathname === "/custom/v1" || url.pathname.startsWith("/custom/v1/"))
			)
				return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
			if (
				unified &&
				host === env.SHORTLINK_DOMAIN &&
				/^\/(?:api|v1|internal|auth|oauth)(?:\/|$)/u.test(url.pathname)
			)
				return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
			const sdkRoute = resolveRegisteredRoute(app, request.method, "sdk", url.pathname);
			const customRoute =
				host === env.API_DOMAIN
					? resolveRegisteredRoute(app, request.method, "custom-api", url.pathname)
					: null;
			if (
				unified &&
				host === env.SDK_DOMAIN &&
				!sdkRoute &&
				!url.pathname.startsWith("/.well-known/")
			)
				return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
			const destination =
				customRoute?.executionPath ??
				(sdkRoute?.route.kind === "canonical" || host === env.SDK_DOMAIN
					? sdkRoute?.executionPath
					: undefined);
			if (destination) {
				url.pathname = destination;
				url.hostname = "api.internal";
				const headers = new Headers(request.headers);
				headers.set("host", "api.internal");
				return app.fetch(new Request(url, new Request(request, { headers })), env, ctx);
			}
			return app.fetch(request, env, ctx);
		},
		async scheduled(_event, env, ctx) {
			ctx.waitUntil(
				resumePendingAccountErasures(env).then((summary) => {
					if (summary.inspected > 0) {
						console.log(
							JSON.stringify({
								event: "application_account_erasures_resumed",
								summary,
							}),
						);
					}
				}),
			);
			if (env.BILLING_QUEUE && !billingServiceEnabled(env)) {
				ctx.waitUntil(env.BILLING_QUEUE.send({ type: "billing.reconcile" }));
			}
			ctx.waitUntil(
				refreshAppleNotificationConfigurationsIfDue(env)
					.then((summary) => {
						console.log(
							JSON.stringify({
								event: "apple_notification_configuration_checked",
								summary,
							}),
						);
					})
					.catch((error) => {
						console.error(
							JSON.stringify({
								event: "apple_notification_configuration_check_failed",
								error: error instanceof Error ? error.message : String(error),
							}),
						);
					}),
			);
			if (env.MAINTENANCE_QUEUE) {
				ctx.waitUntil(env.MAINTENANCE_QUEUE.send({ type: "maintenance.run", days: 3 }));
				return;
			}
			ctx.waitUntil(
				runMaintenance(env, 3, { incremental: true })
					.then((summary) => {
						console.log(JSON.stringify({ event: "maintenance_completed", summary }));
					})
					.catch((error) => {
						console.error(
							JSON.stringify({
								event: "maintenance_failed",
								error: error?.message || String(error),
							}),
						);
					}),
			);
		},
		async queue(batch, env, _ctx) {
			const deadLetterQueues = [
				env.EVENT_DLQ_NAME,
				env.PUSH_DLQ_NAME,
				env.MAINTENANCE_DLQ_NAME,
			].filter((name): name is string => Boolean(name));
			if (deadLetterQueues.includes(batch.queue)) {
				for (const message of batch.messages) {
					try {
						const result = await quarantinePlatformDeadLetter(env.DB, batch.queue, message);
						console.error(
							JSON.stringify({
								event: "platform_job_quarantined",
								queue: batch.queue,
								message_id: message.id,
								job_type: result.jobType,
								replayable: result.replayable,
								duplicate: result.duplicate,
							}),
						);
						message.ack();
					} catch (error) {
						console.error(
							JSON.stringify({
								event: "platform_dead_letter_persistence_failed",
								queue: batch.queue,
								message_id: message.id,
								error: error instanceof Error ? error.message : String(error),
							}),
						);
						message.retry({ delaySeconds: 60 });
					}
				}
				return;
			}
			for (const message of batch.messages) {
				let body: any = null;
				try {
					body = typeof message.body === "string" ? JSON.parse(message.body) : message.body;
					const result =
						isBillingQueueJob(body) && billingServiceEnabled(env)
							? await dispatchBillingServiceJob(env, body)
							: await dispatchQueueJob(env, body);
					console.log(
						JSON.stringify({
							event: "queue_job_completed",
							queue: batch.queue,
							message_id: message.id,
							job_type: body?.type,
							result,
						}),
					);
					message.ack();
				} catch (error: any) {
					console.error(
						JSON.stringify({
							event: "queue_job_failed",
							queue: batch.queue,
							message_id: message.id,
							job_type: body?.type,
							error: error?.message || String(error),
						}),
					);
					if (error?.retryable === false) message.ack();
					else
						message.retry({
							delaySeconds: Math.max(30, Math.min(3600, Number(error?.retryDelaySeconds || 60))),
						});
				}
			}
		},
	} satisfies ExportedHandler<Env>,
	(env) => apiRouteSources(app, env),
	{ service: "api", pluginId: "supbrd-core" },
);
