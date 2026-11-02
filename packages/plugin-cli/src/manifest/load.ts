import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { parseTree, type Node, type ParseError, printParseErrorCode } from "jsonc-parser";
import type { ZodIssue } from "zod";

import { ManifestSchema, type Manifest } from "./schema.js";

export const MANIFEST_FILENAME = "emdash-plugin.jsonc";

export const MANIFEST_MAX_BYTES = 1024 * 1024;

export type ManifestErrorCode =
	| "MANIFEST_NOT_FOUND"
	| "MANIFEST_TOO_LARGE"
	| "MANIFEST_PARSE_ERROR"
	| "MANIFEST_VALIDATION_ERROR";

export class ManifestError extends Error {
	override readonly name = "ManifestError";
	readonly code: ManifestErrorCode;
	readonly path: string;
	readonly issues: ManifestIssue[];

	constructor(
		code: ManifestErrorCode,
		message: string,
		path: string,
		issues: ManifestIssue[] = [],
	) {
		super(message);
		this.code = code;
		this.path = path;
		this.issues = issues;
	}
}

export interface ManifestIssue {
	path: string;
	message: string;
	location?: { line: number; column: number };
}

export interface LoadManifestResult {
	manifest: Manifest;
	path: string;
}

export async function loadManifest(path: string): Promise<LoadManifestResult> {
	const resolved = resolve(path);
	const filePath =
		resolved.endsWith(".jsonc") || resolved.endsWith(".json")
			? resolved
			: resolve(resolved, MANIFEST_FILENAME);

	const source = await readBoundedUtf8(filePath);
	return parseAndValidate(source, filePath);
}

async function readBoundedUtf8(filePath: string): Promise<string> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(filePath, "r");
	} catch (error) {
		if (isNodeNotFoundError(error)) {
			throw new ManifestError(
				"MANIFEST_NOT_FOUND",
				`No manifest at ${filePath}. Create one with: emdash-plugin init`,
				filePath,
			);
		}
		throw error;
	}
	try {
		const buffer = Buffer.allocUnsafe(MANIFEST_MAX_BYTES + 1);
		let totalRead = 0;
		while (totalRead < buffer.length) {
			const { bytesRead } = await handle.read(
				buffer,
				totalRead,
				buffer.length - totalRead,
				totalRead,
			);
			if (bytesRead === 0) break;
			totalRead += bytesRead;
		}
		if (totalRead > MANIFEST_MAX_BYTES) {
			throw new ManifestError(
				"MANIFEST_TOO_LARGE",
				`Manifest at ${filePath} is larger than the ${MANIFEST_MAX_BYTES}-byte cap. Check that you pointed --manifest at the right file.`,
				filePath,
			);
		}
		return buffer.subarray(0, totalRead).toString("utf8");
	} finally {
		await handle.close().catch(() => {});
	}
}

export function parseAndValidateManifest(source: string, path: string): LoadManifestResult {
	return parseAndValidate(source, path);
}

function parseAndValidate(source: string, filePath: string): LoadManifestResult {
	const parseErrors: ParseError[] = [];
	const root = parseTree(source, parseErrors, {
		disallowComments: false,
		allowTrailingComma: true,
		allowEmptyContent: false,
	});

	if (parseErrors.length > 0) {
		const first = parseErrors[0]!;
		const { line, column } = offsetToLineCol(source, first.offset);
		throw new ManifestError(
			"MANIFEST_PARSE_ERROR",
			`${filePath}:${line}:${column}: ${printParseErrorCode(first.error)}`,
			filePath,
		);
	}

	if (!root) {
		throw new ManifestError("MANIFEST_PARSE_ERROR", `${filePath}: file is empty`, filePath);
	}

	const duplicate = findDuplicateKey(root);
	if (duplicate) {
		const { line, column } = offsetToLineCol(source, duplicate.offset);
		throw new ManifestError(
			"MANIFEST_PARSE_ERROR",
			`${filePath}:${line}:${column}: duplicate key "${duplicate.key}". Each property may only be declared once.`,
			filePath,
		);
	}

	const value = nodeToValue(root);

	const result = ManifestSchema.safeParse(value);
	if (!result.success) {
		const issues = result.error.issues.map((issue) => zodIssueToManifestIssue(issue, source, root));
		const summary = issues
			.map((i) => {
				const loc = i.location ? `:${i.location.line}:${i.location.column}` : "";
				return `${filePath}${loc}: ${i.path ? `${i.path}: ` : ""}${i.message}`;
			})
			.join("\n");
		throw new ManifestError(
			"MANIFEST_VALIDATION_ERROR",
			`Manifest validation failed:\n${summary}`,
			filePath,
			issues,
		);
	}

	return { manifest: result.data, path: filePath };
}

function zodIssueToManifestIssue(issue: ZodIssue, source: string, root: Node): ManifestIssue {
	const path = narrowZodPath(issue.path);
	const pathStr = formatZodPath(path);

	let offset: number | undefined;
	if (issue.code === "unrecognized_keys") {
		const keys = (issue as ZodIssue & { keys?: readonly string[] }).keys;
		const firstKey = keys?.[0];
		if (firstKey !== undefined) {
			const parent = findNodeAtPath(root, path);
			if (parent?.type === "object" && parent.children) {
				const prop: Node | undefined = parent.children.find(
					(c) =>
						c.type === "property" &&
						c.children?.[0]?.type === "string" &&
						c.children[0].value === firstKey,
				);
				const keyNode = prop?.children?.[0];
				if (keyNode) offset = keyNode.offset;
			}
		}
	}
	if (offset === undefined) {
		offset = findNodeAtPath(root, path)?.offset;
	}

	const location = offset !== undefined ? offsetToLineCol(source, offset) : undefined;
	return location
		? { path: pathStr, message: issue.message, location }
		: { path: pathStr, message: issue.message };
}

function narrowZodPath(path: ReadonlyArray<PropertyKey>): Array<string | number> {
	return path.map((segment) => {
		if (typeof segment === "string" || typeof segment === "number") return segment;
		return segment.toString();
	});
}

function formatZodPath(path: ReadonlyArray<string | number>): string {
	let out = "";
	for (const segment of path) {
		if (typeof segment === "number") {
			out += `[${segment}]`;
		} else {
			out += out.length === 0 ? segment : `.${segment}`;
		}
	}
	return out;
}

function findNodeAtPath(root: Node, path: ReadonlyArray<string | number>): Node | undefined {
	let current: Node | undefined = root;
	let lastResolved: Node | undefined = root;
	for (const segment of path) {
		if (!current) return lastResolved;
		if (typeof segment === "number") {
			if (current.type !== "array" || !current.children) return current;
			const next: Node | undefined = current.children[segment];
			if (!next) return current;
			current = next;
		} else {
			if (current.type !== "object" || !current.children) return current;
			const prop: Node | undefined = current.children.find(
				(c) =>
					c.type === "property" &&
					c.children?.[0]?.type === "string" &&
					c.children[0].value === segment,
			);
			const next: Node | undefined = prop?.children?.[1];
			if (!next) return current;
			current = next;
		}
		lastResolved = current;
	}
	return current;
}

function findDuplicateKey(node: Node): { key: string; offset: number } | undefined {
	if (node.type === "object" && node.children) {
		const seen = new Set<string>();
		for (const prop of node.children) {
			if (prop.type !== "property") continue;
			const keyNode = prop.children?.[0];
			if (!keyNode || keyNode.type !== "string" || typeof keyNode.value !== "string") {
				continue;
			}
			if (seen.has(keyNode.value)) {
				return { key: keyNode.value, offset: keyNode.offset };
			}
			seen.add(keyNode.value);
			const valueNode = prop.children?.[1];
			if (valueNode) {
				const nested = findDuplicateKey(valueNode);
				if (nested) return nested;
			}
		}
	} else if (node.type === "array" && node.children) {
		for (const child of node.children) {
			const nested = findDuplicateKey(child);
			if (nested) return nested;
		}
	}
	return undefined;
}

function nodeToValue(node: Node): unknown {
	switch (node.type) {
		case "object": {
			const obj: Record<string, unknown> = {};
			for (const prop of node.children ?? []) {
				if (prop.type !== "property") continue;
				const [keyNode, valueNode] = prop.children ?? [];
				if (!keyNode || keyNode.type !== "string" || !valueNode) continue;
				if (typeof keyNode.value !== "string") continue;
				obj[keyNode.value] = nodeToValue(valueNode);
			}
			return obj;
		}
		case "array":
			return (node.children ?? []).map((child) => nodeToValue(child));
		case "string":
		case "number":
		case "boolean":
		case "null":
			return node.value;
		default:
			return undefined;
	}
}

function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
	let line = 1;
	let column = 1;
	const max = Math.min(offset, source.length);
	for (let i = 0; i < max; i++) {
		if (source.charCodeAt(i) === 10) {
			line++;
			column = 1;
		} else {
			column++;
		}
	}
	return { line, column };
}

function isNodeNotFoundError(error: unknown): boolean {
	return (
		error instanceof Error && "code" in error && (error as { code: unknown }).code === "ENOENT"
	);
}
