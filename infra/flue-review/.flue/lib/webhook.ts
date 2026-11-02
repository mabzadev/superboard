const encoder = new TextEncoder();
const NON_HEX = /[^0-9a-fA-F]/;

export function getWebhookDeliveryId(header: string | undefined | null): string | null {
	return header?.trim() || null;
}

export async function verifyWebhookSignature(
	secret: string,
	rawBody: string,
	signatureHeader: string | undefined | null,
): Promise<boolean> {
	if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const provided = hexToBytes(signatureHeader.slice("sha256=".length));
	if (!provided) return false;
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
	if (provided.length !== mac.length) return false;
	return crypto.subtle.timingSafeEqual(provided, mac);
}

function hexToBytes(hex: string): Uint8Array | null {
	if (hex.length === 0 || hex.length % 2 !== 0 || NON_HEX.test(hex)) return null;
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

export interface GatedPr {
	prNumber: number;
	prTitle: string;
	prBody: string;
	headRef: string;
	headSha: string;
	baseRef: string;
	baseSha: string;
	owner: string;
	repo: string;
}

export type GateDecision = { review: true; pr: GatedPr } | { review: false; reason: string };

const REVIEWABLE_ACTIONS = new Set(["opened", "reopened", "ready_for_review"]);
const MANUAL_LABEL = "bot:review";

interface PullRequestEvent {
	action?: string;
	label?: { name?: string };
	pull_request?: {
		number?: number;
		title?: string;
		body?: string | null;
		draft?: boolean;
		head?: { ref?: string; sha?: string };
		base?: { ref?: string; sha?: string };
		user?: { login?: string };
	};
	repository?: { name?: string; owner?: { login?: string } };
}

export function gatePullRequestEvent(event: PullRequestEvent): GateDecision {
	const pr = event.pull_request;
	if (!pr) return { review: false, reason: "no pull_request in payload" };

	const author = pr.user?.login ?? "";
	if (author.endsWith("[bot]")) {
		return { review: false, reason: `author "${author}" is a bot` };
	}

	const action = event.action ?? "";
	const isManual = action === "labeled" && event.label?.name === MANUAL_LABEL;
	if (!isManual && !REVIEWABLE_ACTIONS.has(action)) {
		return { review: false, reason: `action "${action}" is not reviewable` };
	}

	if (pr.draft && action !== "ready_for_review" && !isManual) {
		return { review: false, reason: "PR is a draft" };
	}

	const owner = event.repository?.owner?.login;
	const repo = event.repository?.name;
	const prNumber = pr.number;
	const headRef = pr.head?.ref;
	const headSha = pr.head?.sha;
	const baseRef = pr.base?.ref;
	const baseSha = pr.base?.sha;
	if (!owner || !repo || !prNumber || !headRef || !headSha || !baseRef || !baseSha || !pr.title) {
		return { review: false, reason: "payload missing required PR fields" };
	}

	return {
		review: true,
		pr: {
			prNumber,
			prTitle: pr.title,
			prBody: pr.body ?? "",
			headRef,
			headSha,
			baseRef,
			baseSha,
			owner,
			repo,
		},
	};
}
