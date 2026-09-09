import type { CustomWorkerJob } from "@superboard/contracts/custom-worker";

import { VocoStarJobError } from "./validation.js";

const localeSeparator = /[\s,]+/u;

export function configureVocostarJob(
	job: CustomWorkerJob,
	values: Record<string, unknown>,
): CustomWorkerJob {
	const voice = job.capability === "vocostar.voice.clone";
	if (
		(voice && values.voice_cloning_enabled === false) ||
		(!voice && values.media_conversion_enabled === false)
	)
		throw new VocoStarJobError("capability_disabled", 403);
	const input = job.payload.input;
	const language = voice
		? job.payload.language
		: input && typeof input === "object" && "language" in input
			? input.language
			: undefined;
	if (
		typeof values.allowed_locales === "string" &&
		values.allowed_locales.trim() &&
		typeof language === "string"
	) {
		if (
			!values.allowed_locales.toLowerCase().split(localeSeparator).includes(language.toLowerCase())
		)
			throw new VocoStarJobError("language_disabled");
	}
	const limit = values.text_max_characters;
	if (
		typeof limit === "number" &&
		Number.isSafeInteger(limit) &&
		limit > 0 &&
		input &&
		typeof input === "object"
	) {
		const text = "text" in input ? input.text : "text_src" in input ? input.text_src : null;
		if (typeof text === "string" && text.length > limit)
			throw new VocoStarJobError("text_too_long");
	}
	const cost = values.media_credit_cost;
	if (
		cost != null &&
		(typeof cost !== "number" || !Number.isSafeInteger(cost) || cost < 0 || cost > 1000000)
	)
		throw new VocoStarJobError("settings_invalid", 503);
	return !voice &&
		typeof cost === "number" &&
		Number.isSafeInteger(cost) &&
		cost >= 0 &&
		cost <= 1000000
		? { ...job, payload: { ...job.payload, creditCost: cost } }
		: job;
}
