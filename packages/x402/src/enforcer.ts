import {
	decodePaymentSignatureHeader,
	encodePaymentRequiredHeader,
	encodePaymentResponseHeader,
} from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer, type ResourceConfig } from "@x402/core/server";

import type { EnforceOptions, EnforceResult, X402Config, X402Enforcer } from "./types.js";

const PAYMENT_SIGNATURE_HEADER = "payment-signature";
const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
const DEFAULT_SCHEME = "exact";
const DEFAULT_MAX_TIMEOUT_SECONDS = 60;
const DEFAULT_BOT_SCORE_THRESHOLD = 30;

let _resourceServer: x402ResourceServer | null = null;

async function getResourceServer(config: X402Config): Promise<x402ResourceServer> {
	const existing = _resourceServer;
	if (existing) return existing;

	const facilitatorUrl = config.facilitatorUrl ?? DEFAULT_FACILITATOR_URL;
	const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
	const server = new x402ResourceServer(facilitator);

	if (config.evm !== false) {
		try {
			const evmMod = await import("@x402/evm/exact/server");
			const evmScheme = new evmMod.ExactEvmScheme();
			server.register("eip155:*", evmScheme);
		} catch {}
	}

	if (config.svm) {
		try {
			const svmMod = await import("@x402/svm/exact/server");
			const svmScheme = new svmMod.ExactSvmScheme();
			server.register("solana:*", svmScheme);
		} catch {}
	}

	await server.initialize();

	_resourceServer = server;
	return server;
}

function isBot(request: Request, threshold: number): boolean {
	const cf: unknown = Reflect.get(request, "cf");
	if (cf == null || typeof cf !== "object") return false;
	const bm: unknown = Reflect.get(cf, "botManagement");
	if (bm == null || typeof bm !== "object") return false;
	const score: unknown = Reflect.get(bm, "score");
	if (typeof score !== "number") return false;
	return score < threshold;
}

export function createEnforcer(config: X402Config): X402Enforcer {
	const botScoreThreshold = config.botScoreThreshold ?? DEFAULT_BOT_SCORE_THRESHOLD;

	return {
		async enforce(request: Request, options?: EnforceOptions): Promise<Response | EnforceResult> {
			if (config.botOnly && !isBot(request, botScoreThreshold)) {
				return { paid: false, skipped: true, responseHeaders: {} };
			}

			const server = await getResourceServer(config);

			const price = options?.price ?? config.defaultPrice;
			if (price == null) {
				throw new Error(
					"x402: No price specified. Pass a price in enforce() options or set defaultPrice in the config.",
				);
			}

			const payTo = options?.payTo ?? config.payTo;
			const network = options?.network ?? config.network;
			const scheme = options?.scheme ?? config.scheme ?? DEFAULT_SCHEME;
			const maxTimeoutSeconds = config.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS;

			const resourceConfig: ResourceConfig = {
				scheme,
				payTo,
				price: normalizePrice(price),
				network,
				maxTimeoutSeconds,
			};

			const url = new URL(request.url);
			const resourceInfo = {
				url: url.pathname,
				description: options?.description,
				mimeType: options?.mimeType,
			};

			const paymentHeader =
				request.headers.get(PAYMENT_SIGNATURE_HEADER) || request.headers.get("PAYMENT-SIGNATURE");

			if (!paymentHeader) {
				return make402(server, resourceConfig, resourceInfo, "Payment required");
			}

			const paymentPayload = decodePaymentSignatureHeader(paymentHeader);
			const requirements = await server.buildPaymentRequirements(resourceConfig);
			const matchingReqs = server.findMatchingRequirements(requirements, paymentPayload);

			if (!matchingReqs) {
				return make402(
					server,
					resourceConfig,
					resourceInfo,
					"Payment does not match accepted requirements",
				);
			}

			const verifyResult = await server.verifyPayment(paymentPayload, matchingReqs);

			if (!verifyResult.isValid) {
				return make402(
					server,
					resourceConfig,
					resourceInfo,
					verifyResult.invalidReason ?? "Payment verification failed",
				);
			}

			const settleResult = await server.settlePayment(paymentPayload, matchingReqs);

			const responseHeaders: Record<string, string> = {};
			if (settleResult) {
				responseHeaders[PAYMENT_RESPONSE_HEADER] = encodePaymentResponseHeader(settleResult);
			}

			return {
				paid: true,
				skipped: false,
				payer: verifyResult.payer,
				settlement: settleResult,
				responseHeaders,
			};
		},

		applyHeaders(result: EnforceResult, response: { headers: Headers }): void {
			for (const [key, value] of Object.entries(result.responseHeaders)) {
				response.headers.set(key, value);
			}
		},

		hasPayment(request: Request): boolean {
			return !!(
				request.headers.get(PAYMENT_SIGNATURE_HEADER) || request.headers.get("PAYMENT-SIGNATURE")
			);
		},
	};
}

async function make402(
	server: x402ResourceServer,
	resourceConfig: ResourceConfig,
	resourceInfo: { url: string; description?: string; mimeType?: string },
	error: string,
): Promise<Response> {
	const requirements = await server.buildPaymentRequirements(resourceConfig);
	const paymentRequired = await server.createPaymentRequiredResponse(
		requirements,
		resourceInfo,
		error,
	);

	return new Response(JSON.stringify(paymentRequired), {
		status: 402,
		headers: {
			"Content-Type": "application/json",
			[PAYMENT_REQUIRED_HEADER]: encodePaymentRequiredHeader(paymentRequired),
		},
	});
}

function normalizePrice(
	price: string | number | { amount: string; asset: string; extra?: Record<string, unknown> },
): string | number | { amount: string; asset: string; extra?: Record<string, unknown> } {
	if (typeof price === "string" && price.startsWith("$")) {
		return price.slice(1);
	}
	return price;
}
