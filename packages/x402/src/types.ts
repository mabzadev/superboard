import type { SettleResponse } from "@x402/core/types";

export type Network = `${string}:${string}`;

export type Price =
	| string
	| number
	| { amount: string; asset: string; extra?: Record<string, unknown> };

export interface X402Config {
	payTo: string;
	network: Network;
	defaultPrice?: Price;
	facilitatorUrl?: string;
	scheme?: string;
	maxTimeoutSeconds?: number;
	evm?: boolean;
	svm?: boolean;
	botOnly?: boolean;
	botScoreThreshold?: number;
}

export interface EnforceOptions {
	price?: Price;
	payTo?: string;
	network?: Network;
	scheme?: string;
	description?: string;
	mimeType?: string;
}

export interface EnforceResult {
	paid: boolean;
	skipped: boolean;
	payer?: string;
	settlement?: SettleResponse;
	responseHeaders: Record<string, string>;
}

export interface X402Enforcer {
	enforce(request: Request, options?: EnforceOptions): Promise<Response | EnforceResult>;

	applyHeaders(result: EnforceResult, response: { headers: Headers }): void;

	hasPayment(request: Request): boolean;
}
