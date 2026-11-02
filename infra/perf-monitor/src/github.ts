import { GITHUB_REPO } from "./routes.js";

interface AssociatedPR {
	number: number;
	state: string;
	merged_at: string | null;
	base: { ref: string };
}
const PR_NUMBER_REGEX = /\(#(\d+)\)\s*$/;
function parsePrFromMessage(commitMessage: string): number | null {
	const match = commitMessage.match(PR_NUMBER_REGEX);
	if (!match?.[1]) return null;
	return parseInt(match[1], 10);
}

export async function resolvePrForSha(sha: string, commitMessage?: string): Promise<number | null> {
	if (commitMessage) {
		const fromMessage = parsePrFromMessage(commitMessage);
		if (fromMessage) return fromMessage;
	}

	const url = `https://api.github.com/repos/${GITHUB_REPO}/commits/${sha}/pulls`;

	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "emdash-perf-monitor",
				"x-github-api-version": "2022-11-28",
			},
		});
	} catch (err) {
		console.error("PR lookup failed:", err);
		return null;
	}

	if (!response.ok) {
		console.warn(`PR lookup for ${sha} returned ${response.status}`);
		return null;
	}

	const prs = await response.json<AssociatedPR[]>();

	const mainPr = prs.find((p) => p.merged_at && p.base.ref === "main");
	if (mainPr) return mainPr.number;

	const anyMerged = prs.find((p) => p.merged_at);
	if (anyMerged) return anyMerged.number;

	return null;
}
