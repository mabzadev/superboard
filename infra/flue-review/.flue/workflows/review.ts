import {
	defineAgent,
	defineWorkflow,
	type ActionContext,
	type WorkflowRouteHandler,
} from "@flue/runtime";
import { getCloudflareContext, getDurableObjectIdentity } from "@flue/runtime/cloudflare";
import * as v from "valibot";

import { withCapacityRetry } from "../lib/capacity.js";
import { elideLargeDiffSections } from "../lib/diff-budget.js";
import {
	readAppCreds,
	mintInstallationToken,
	fetchUnifiedDiff,
	fetchPullRequestHeadSha,
	fetchPriorReview,
	postReview,
	addEyesReaction,
	removeReaction,
	updateReviewCheck,
} from "../lib/github.js";
import { formatReviewFailureSummary } from "../lib/review-failure.js";
import { reviewResultSchema, type ReviewResult } from "../lib/review-schema.js";
import {
	getReviewWatchdog,
	type ReviewStage,
	type ReviewTerminal,
} from "../lib/review-watchdog.js";
import { untarInto } from "../lib/untar.js";
import { getDefaultWorkspace, getShellSandbox } from "../sandboxes/cloudflare-shell.js";
import review from "../skills/review/SKILL.md" with { type: "skill" };

const reviewPayloadSchema = v.object({
	prNumber: v.number(),
	prTitle: v.string(),
	prBody: v.string(),
	headRef: v.string(),
	headSha: v.optional(v.string()),
	baseRef: v.string(),
	baseSha: v.optional(v.string()),
	owner: v.string(),
	repo: v.string(),
	attemptId: v.optional(v.string()),
	expectedRunId: v.optional(v.string()),
	deliveryId: v.optional(v.string()),
	checkRunId: v.optional(v.number()),
});

type ReviewPayload = v.InferOutput<typeof reviewPayloadSchema>;

const REPO_DIR = "/repo";
const DIFF_PATH = `${REPO_DIR}/.flue-pr.diff`;
const HYDRATED = `${REPO_DIR}/.flue-hydrated`;

const NAME = /^[A-Za-z0-9._-]+$/;
const REF = /^[A-Za-z0-9._][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._][A-Za-z0-9._-]*)*$/;
const SHA = /^[0-9a-f]{40}$/i;

function assertSafe(payload: ReviewPayload): void {
	if (!Number.isInteger(payload.prNumber) || payload.prNumber <= 0) {
		throw new Error("payload.prNumber must be a positive integer");
	}
	if (!payload.prTitle) throw new Error("payload.prTitle is required");
	for (const [key, value] of [
		["owner", payload.owner],
		["repo", payload.repo],
	] as const) {
		if (!value || !NAME.test(value)) throw new Error(`payload.${key} missing or unsafe`);
	}
	for (const [key, value] of [
		["baseRef", payload.baseRef],
		["headRef", payload.headRef],
	] as const) {
		if (!value || !REF.test(value) || value.includes("..")) {
			throw new Error(`payload.${key} missing or not a safe git ref`);
		}
	}
	for (const [key, value] of [
		["baseSha", payload.baseSha],
		["headSha", payload.headSha],
	] as const) {
		if (value !== undefined && !SHA.test(value))
			throw new Error(`payload.${key} is not a full SHA`);
	}
}

function workspaceName(): string {
	return `review-${getDurableObjectIdentity().id}`;
}

function workflowRunId(): string {
	return getDurableObjectIdentity().name;
}

const reviewAgent = defineAgent<Env>(({ env }) => {
	const workspace = getDefaultWorkspace(env.REVIEW_WORKSPACE, workspaceName());
	return {
		model: "cloudflare/@cf/moonshotai/kimi-k2.7-code",
		sandbox: getShellSandbox({ workspace, loader: env.LOADER }),
		cwd: REPO_DIR,
		instructions: [
			"You are EmDash's automated pull request reviewer.",
			"You investigate one PR in depth and return structured, line-anchored findings plus an overall verdict.",
			"You inspect the checked-out repo with the `code` tool (JavaScript over `state.*`); there is no shell.",
			"You are read-only: no posting. The orchestrator posts your review after you finish.",
			"Follow the review skill's protocol exactly and return strictly schema-conformant output.",
		].join(" "),
		skills: [review],
	};
});

function buildPrContext(payload: ReviewPayload, priorReview?: string): string {
	const lines = [
		`PR #${payload.prNumber} in ${payload.owner}/${payload.repo}.`,
		`Head ref: ${payload.headRef}. Base branch: ${payload.baseRef}.`,
		`The repo is checked out at the PR head under ${REPO_DIR}. The unified diff is at ${DIFF_PATH}.`,
		`Title: ${payload.prTitle}`,
		"",
		"## Description",
		"",
		payload.prBody || "(no description provided)",
	];
	if (priorReview) {
		lines.push("", "## Prior review context (this is a re-review)", "", priorReview);
	}
	return lines.join("\n");
}

function hydrateStep(payload: ReviewPayload, step: string, startedAt: number): void {
	console.log(
		JSON.stringify({
			message: "hydrate step",
			step,
			ms: Date.now() - startedAt,
			attemptId: payload.attemptId,
			prNumber: payload.prNumber,
		}),
	);
}

async function hydrate(env: Env, payload: ReviewPayload): Promise<void> {
	const t0 = Date.now();
	const workspace = getDefaultWorkspace(env.REVIEW_WORKSPACE, workspaceName());
	hydrateStep(payload, "workspace created", t0);
	if (await workspace.exists(HYDRATED)) {
		hydrateStep(payload, "already hydrated", t0);
		return;
	}
	if (!payload.headSha) throw new Error("hydrate requires the PR head SHA");

	const url = `https://api.github.com/repos/${payload.owner}/${payload.repo}/tarball/${payload.headSha}`;
	const response = await fetch(url, {
		headers: { "User-Agent": "emdash-flue-review", Accept: "application/vnd.github+json" },
	});
	if (!response.ok || !response.body) {
		throw new Error(`tarball fetch failed: ${response.status} ${await response.text()}`);
	}
	hydrateStep(payload, "tarball response", t0);

	const tarStream = response.body.pipeThrough(new DecompressionStream("gzip"));
	const { files, bytes } = await untarInto(workspace, tarStream, REPO_DIR);
	hydrateStep(payload, `untarred ${files} files ${bytes} bytes`, t0);

	await workspace.writeFile(HYDRATED, new Date().toISOString());
	hydrateStep(payload, "hydrated", t0);
}

function logReviewEvent(
	level: "log" | "error",
	payload: ReviewPayload,
	runId: string,
	message: string,
	extra: Record<string, unknown> = {},
): void {
	console[level](
		JSON.stringify({
			message,
			attemptId: payload.attemptId,
			runId,
			deliveryId: payload.deliveryId,
			prNumber: payload.prNumber,
			headSha: payload.headSha,
			checkRunId: payload.checkRunId,
			...extra,
		}),
	);
}

async function reportStage(
	env: Env,
	token: string | undefined,
	payload: ReviewPayload,
	runId: string,
	stage: ReviewStage,
	detail: string,
): Promise<boolean> {
	logReviewEvent("log", payload, runId, "review stage changed", { stage });
	if (payload.checkRunId === undefined || !payload.attemptId) return true;

	const active = await getReviewWatchdog(env, payload.attemptId).heartbeat(
		payload.attemptId,
		runId,
		stage,
	);
	if (!active) return false;
	if (token) {
		try {
			await updateReviewCheck(token, payload.owner, payload.repo, payload.checkRunId, {
				prNumber: payload.prNumber,
				runId,
				stage,
				detail,
			});
		} catch (error) {
			logReviewEvent("error", payload, runId, "review stage reporting failed", {
				stage,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return true;
}

async function finishReviewCheck(
	env: Env,
	payload: ReviewPayload,
	runId: string,
	terminal: ReviewTerminal,
): Promise<void> {
	if (payload.checkRunId === undefined || !payload.attemptId) return;
	try {
		const finished = await getReviewWatchdog(env, payload.attemptId).finish(
			payload.attemptId,
			runId,
			terminal,
		);
		if (!finished) {
			logReviewEvent("error", payload, runId, "review attempt was already terminal");
		}
	} catch (error) {
		logReviewEvent("error", payload, runId, "review completion reporting failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function run(context: ActionContext<typeof reviewPayloadSchema>): Promise<ReviewResult> {
	const payload = context.input;

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const env = getCloudflareContext().env as unknown as Env;
	let runId = payload.attemptId ?? "unidentified";

	const creds = readAppCreds(env);
	let token: string | undefined;
	let priorReview: string | undefined;
	let reactionId: number | undefined;
	let stage: ReviewStage = "admitted";
	try {
		assertSafe(payload);
		if (!payload.headSha || !payload.baseSha) {
			throw new Error("Review payload does not include immutable base and head SHAs");
		}
		runId = workflowRunId();
		if (
			payload.attemptId &&
			payload.checkRunId !== undefined &&
			!(await getReviewWatchdog(env, payload.attemptId).identify(
				payload.attemptId,
				payload.expectedRunId ?? payload.attemptId,
				runId,
			))
		) {
			throw new Error("Review attempt is no longer active");
		}
		if (creds) {
			token = await mintInstallationToken(creds);
			reactionId = await addEyesReaction(token, payload.owner, payload.repo, payload.prNumber);
			priorReview = await fetchPriorReview(token, payload.owner, payload.repo, payload.prNumber);
		}

		stage = "hydrating";
		if (
			!(await reportStage(env, token, payload, runId, "hydrating", "Preparing the PR workspace."))
		) {
			throw new Error("Review attempt is no longer active");
		}
		await hydrate(env, payload);

		const session = await context.harness.session();

		stage = "fetching_diff";
		if (
			!(await reportStage(
				env,
				token,
				payload,
				runId,
				"fetching_diff",
				"Fetching the canonical PR diff.",
			))
		) {
			throw new Error("Review attempt is no longer active");
		}
		const diff = await fetchUnifiedDiff(
			payload.owner,
			payload.repo,
			payload.prNumber,
			token,
			payload.baseSha,
			payload.headSha,
		);
		await context.harness.fs.writeFile(DIFF_PATH, elideLargeDiffSections(diff));

		stage = "model_review";
		if (
			!(await reportStage(
				env,
				token,
				payload,
				runId,
				"model_review",
				"The model is reviewing the diff.",
			))
		) {
			throw new Error("Review attempt is no longer active");
		}
		const { data } = await withCapacityRetry(
			(signal) =>
				session.skill("review", {
					args: {
						prContext: buildPrContext(payload, priorReview),
						owner: payload.owner,
						repo: payload.repo,
						prNumber: payload.prNumber,
						baseRef: payload.baseRef,
						headRef: payload.headRef,
						repoDir: REPO_DIR,
						diffPath: DIFF_PATH,
					},
					result: reviewResultSchema,
					signal,
				}),
			{
				label: `review#${payload.prNumber}`,
				attempts: 3,
				perAttemptTimeoutMs: 30 * 60_000,
				onRetry: ({ attempt, delayMs, error }) =>
					context.log.warn?.("[review] model over capacity, backing off", {
						prNumber: payload.prNumber,
						attempt,
						delayMs,
						error: String(error),
					}),
			},
		);

		logReviewEvent("log", payload, runId, "review model result received", {
			hasToken: Boolean(token),
			verdict: data.verdict,
			summaryLength: data.summary.length,
			findingCount: data.findings.length,
		});

		if (token) {
			stage = "posting_review";
			if (
				!(await reportStage(
					env,
					token,
					payload,
					runId,
					"posting_review",
					"Posting the review to GitHub.",
				))
			) {
				throw new Error("Review attempt is no longer active");
			}
			if (payload.headSha) {
				const currentHeadSha = await fetchPullRequestHeadSha(
					token,
					payload.owner,
					payload.repo,
					payload.prNumber,
				);
				if (currentHeadSha.toLowerCase() !== payload.headSha.toLowerCase()) {
					throw new Error("PR head changed before the review could be posted");
				}
			}
			await postReview(
				token,
				payload.owner,
				payload.repo,
				payload.prNumber,
				data,
				payload.headSha,
				payload.attemptId,
			);
		} else {
			logReviewEvent("log", payload, runId, "GitHub App credentials unavailable; skipping post");
		}

		await finishReviewCheck(env, payload, runId, {
			conclusion: "success",
			summary: `The automated review completed with verdict \`${data.verdict}\` and ${data.findings.length} finding(s).`,
		});

		return data;
	} catch (error) {
		logReviewEvent("error", payload, runId, "review run failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		await finishReviewCheck(env, payload, runId, {
			conclusion: "failure",
			summary: formatReviewFailureSummary(stage, error),
		});
		throw error;
	} finally {
		if (token && reactionId !== undefined) {
			await removeReaction(token, payload.owner, payload.repo, payload.prNumber, reactionId);
		}
	}
}

export default defineWorkflow({
	agent: reviewAgent,
	input: reviewPayloadSchema,
	output: reviewResultSchema,
	run,
});

export const route: WorkflowRouteHandler = async (_c, next) => next();
