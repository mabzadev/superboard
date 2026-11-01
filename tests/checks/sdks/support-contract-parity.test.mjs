import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The Web and Flutter SDKs ship their own copies of the Support contract
// constants (they cannot import packages/contracts at runtime). This check
// keeps those copies aligned with the canonical definitions.

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const contract = await read("packages/contracts/src/support.ts");
const webClient = await read("sdks/web/src/support/client.js");
const webRealtime = await read("sdks/web/src/support/realtime.js");
const dartClient = await read("sdks/flutter/lib/src/support/client.dart");
const dartRealtime = await read("sdks/flutter/lib/src/support/realtime.dart");

function block(source, pattern, label) {
	const match = pattern.exec(source);
	assert.ok(match, `${label} was not found`);
	return match[1];
}

function quotedStrings(source) {
	return [...source.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
}

// Only integer products such as `64 * 1024` appear in these limits.
function integerExpression(expression, label) {
	const text = expression.trim();
	assert.match(text, /^\d[\d_]*(?:\s*\*\s*\d[\d_]*)*$/u, `${label} is not a constant product`);
	return text
		.split("*")
		.map((factor) => Number(factor.trim().replaceAll("_", "")))
		.reduce((product, factor) => product * factor, 1);
}

function constant(source, pattern, label) {
	return integerExpression(block(source, pattern, label), label);
}

const contractEventTypes = quotedStrings(
	block(contract, /export const SUPPORT_REALTIME_EVENT_TYPES = \[([\s\S]*?)\]/u, "contract events"),
);
const contractLimits = Object.fromEntries(
	block(contract, /export const SUPPORT_LIMITS = Object\.freeze\(\{([\s\S]*?)\}\)/u, "limits")
		.split("\n")
		.map((line) => /^\s*(\w+):\s*([^,]+),?\s*$/u.exec(line))
		.filter(Boolean)
		.map(([, name, value]) => [name, integerExpression(value, `SUPPORT_LIMITS.${name}`)]),
);

test("the canonical Support contract still exposes the mirrored constants", () => {
	assert.ok(contractEventTypes.length > 0);
	for (const name of [
		"pageSizeMaximum",
		"cursorLengthMaximum",
		"identifierLengthMaximum",
		"idempotencyKeyLengthMaximum",
		"messageBodyBytesMaximum",
		"attachmentBytesMaximum",
	])
		assert.equal(typeof contractLimits[name], "number", `SUPPORT_LIMITS.${name}`);
});

test("SDK realtime event allow-lists match SUPPORT_REALTIME_EVENT_TYPES", () => {
	const web = quotedStrings(
		block(webRealtime, /const ALLOWED_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/u, "web events"),
	);
	const dart = quotedStrings(
		block(dartRealtime, /static const _allowedEventTypes = \{([\s\S]*?)\};/u, "Dart events"),
	);
	assert.deepEqual([...web].sort(), [...contractEventTypes].sort(), "Web SDK");
	assert.deepEqual([...dart].sort(), [...contractEventTypes].sort(), "Flutter SDK");
});

test("Web SDK Support limits match SUPPORT_LIMITS", () => {
	const mirrored = {
		MAX_PAGE_SIZE: "pageSizeMaximum",
		MAX_CURSOR_LENGTH: "cursorLengthMaximum",
		MAX_IDENTIFIER_LENGTH: "identifierLengthMaximum",
		MAX_IDEMPOTENCY_KEY_LENGTH: "idempotencyKeyLengthMaximum",
		MAX_MESSAGE_BYTES: "messageBodyBytesMaximum",
		MAX_ATTACHMENT_BYTES: "attachmentBytesMaximum",
	};
	for (const [name, limit] of Object.entries(mirrored)) {
		assert.equal(
			constant(webClient, new RegExp(`^const ${name} = ([^;]+);`, "mu"), name),
			contractLimits[limit],
			`${name} must equal SUPPORT_LIMITS.${limit}`,
		);
	}
});

test("Flutter SDK Support limits match SUPPORT_LIMITS", () => {
	assert.equal(
		constant(dartClient, /^const int maxSupportMessageBodyBytes = ([^;]+);/mu, "message bytes"),
		contractLimits.messageBodyBytesMaximum,
	);
	assert.equal(
		constant(dartClient, /^const int maxSupportAttachmentBytes = ([^;]+);/mu, "attachment bytes"),
		contractLimits.attachmentBytesMaximum,
	);
	// The Dart client inlines the remaining limits at each call site.
	const inlined = [
		[/limit\.clamp\(1, (\d+)\)/gu, "pageSizeMaximum"],
		[/_boundedValue\(cursor, 'cursor', (\d+)\)/gu, "cursorLengthMaximum"],
		[/_boundedValue\(value, 'identifier', (\d+)\)/gu, "identifierLengthMaximum"],
		[/_boundedValue\(value, 'idempotencyKey', (\d+)\)/gu, "idempotencyKeyLengthMaximum"],
	];
	for (const [pattern, limit] of inlined) {
		const values = [...dartClient.matchAll(pattern)].map((match) => Number(match[1]));
		assert.ok(values.length > 0, `no Dart call site found for SUPPORT_LIMITS.${limit}`);
		for (const value of values) assert.equal(value, contractLimits[limit], limit);
	}
});
