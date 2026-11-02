import { createHash, randomUUID } from "node:crypto";
import { open, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isDid, isHandle, type Did, type Handle } from "@atcute/lexicons/syntax";
import { applyEdits, modify, parseTree, printParseErrorCode, type ParseError } from "jsonc-parser";

import { createActorResolver } from "../oauth.js";
import { MANIFEST_MAX_BYTES } from "./load.js";

export type PublisherCheck =
	| { kind: "match"; pinnedDid: Did }
	| { kind: "unpinned" }
	| { kind: "mismatch"; pinnedDid: Did; pinnedDisplay: string };

export type PublisherCheckErrorCode = "MANIFEST_PUBLISHER_UNRESOLVED";

export class PublisherCheckError extends Error {
	override readonly name = "PublisherCheckError";
	readonly code: PublisherCheckErrorCode;
	constructor(code: PublisherCheckErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

export async function checkPublisher(input: {
	manifestPublisher: string | undefined;
	sessionDid: Did;
}): Promise<PublisherCheck> {
	if (input.manifestPublisher === undefined) {
		return { kind: "unpinned" };
	}

	const pinned = input.manifestPublisher;

	if (isDid(pinned)) {
		if (pinned === input.sessionDid) {
			return { kind: "match", pinnedDid: pinned };
		}
		return { kind: "mismatch", pinnedDid: pinned, pinnedDisplay: pinned };
	}

	if (isHandle(pinned)) {
		const resolved = await resolveHandleToDid(pinned);
		if (resolved === input.sessionDid) {
			return { kind: "match", pinnedDid: resolved };
		}
		return { kind: "mismatch", pinnedDid: resolved, pinnedDisplay: pinned };
	}

	throw new PublisherCheckError(
		"MANIFEST_PUBLISHER_UNRESOLVED",
		`publisher value "${pinned}" is neither a DID nor a handle. Edit the manifest to use a valid DID or handle.`,
	);
}

export async function resolveHandleToDid(handle: Handle): Promise<Did> {
	const resolver = createActorResolver();
	try {
		const resolved = await resolver.resolve(handle);
		return resolved.did;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new PublisherCheckError(
			"MANIFEST_PUBLISHER_UNRESOLVED",
			`could not resolve handle "${handle}" to a DID: ${reason}. ` +
				`To avoid the lookup, replace the handle with the DID directly in the manifest (publisher: "did:plc:...").`,
		);
	}
}

export async function writePublisherBack(input: {
	manifestPath: string;
	sessionDid: Did;
	sessionHandle?: string;
	onInfo?: (message: string) => void;
	onWarn?: (message: string) => void;
}): Promise<void> {
	const { manifestPath, sessionDid, sessionHandle, onInfo, onWarn } = input;
	try {
		const initial = await readManifestBounded(manifestPath);
		if (initial.kind === "oversize") {
			onWarn?.(
				`Skipped writing publisher to ${manifestPath} (file is now larger than the ${MANIFEST_MAX_BYTES}-byte cap; the publish succeeded).`,
			);
			return;
		}
		if (initial.kind === "missing") {
			onWarn?.(
				`Skipped writing publisher to ${manifestPath} (file was removed during publish; the publish succeeded).`,
			);
			return;
		}
		const source = initial.source;

		const parseErrors: ParseError[] = [];
		const root = parseTree(source, parseErrors, {
			disallowComments: false,
			allowTrailingComma: true,
			allowEmptyContent: false,
		});
		if (parseErrors.length > 0) {
			const first = parseErrors[0]!;
			onWarn?.(
				`Skipped writing publisher to ${manifestPath} (file no longer parses: ${printParseErrorCode(first.error)}).`,
			);
			return;
		}
		if (!root || root.type !== "object") {
			onWarn?.(
				`Skipped writing publisher to ${manifestPath} (file no longer parses as a JSONC object).`,
			);
			return;
		}
		const hasPublisher = root.children?.some(
			(prop) =>
				prop.type === "property" &&
				prop.children?.[0]?.type === "string" &&
				prop.children[0].value === "publisher",
		);
		if (hasPublisher) {
			onInfo?.(`Skipped writing publisher to ${manifestPath} (already set by user).`);
			return;
		}

		const indent = detectIndent(source);
		const edits = modify(source, ["publisher"], sessionDid, {
			formattingOptions: { insertSpaces: !indent.useTabs, tabSize: indent.size },
			getInsertionIndex: (existingProps) => {
				const licenseIdx = existingProps.indexOf("license");
				if (licenseIdx >= 0) return licenseIdx + 1;
				return existingProps.length;
			},
		});
		if (edits.length === 0) {
			onWarn?.(
				`Skipped writing publisher to ${manifestPath} (no edits produced; file may be malformed).`,
			);
			return;
		}
		const applied = applyEdits(source, edits);

		const updated = sessionHandle ? annotatePublisherLine(applied, sessionHandle) : applied;

		const expectedHash = sha256(source);
		const tmp = join(dirname(manifestPath), `.${randomUUID()}.tmp`);
		await writeFile(tmp, updated, "utf8");
		let currentHash: string | null;
		try {
			const current = await readManifestBounded(manifestPath);
			currentHash = current.kind === "ok" ? sha256(current.source) : null;
		} catch {
			currentHash = null;
		}
		if (currentHash !== expectedHash) {
			await unlinkIgnoreMissing(tmp);
			onWarn?.(
				`Skipped writing publisher to ${manifestPath} (file changed during publish; no edits made). The publish succeeded; you can pin manually on your next edit.`,
			);
			return;
		}
		await rename(tmp, manifestPath);
		onInfo?.(`Pinned publisher to ${sessionDid} in ${manifestPath}.`);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		onWarn?.(
			`Could not pin publisher to ${manifestPath}: ${reason}. ` +
				`The publish succeeded; you can add publisher manually on your next edit.`,
		);
	}
}

type BoundedReadResult =
	| { kind: "ok"; source: string }
	| { kind: "oversize" }
	| { kind: "missing" };

async function readManifestBounded(filePath: string): Promise<BoundedReadResult> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(filePath, "r");
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as { code: unknown }).code === "ENOENT"
		) {
			return { kind: "missing" };
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
		if (totalRead > MANIFEST_MAX_BYTES) return { kind: "oversize" };
		return { kind: "ok", source: buffer.subarray(0, totalRead).toString("utf8") };
	} finally {
		await handle.close().catch(() => {});
	}
}

function detectIndent(source: string): { useTabs: boolean; size: number } {
	const lines = source.split("\n");
	for (const line of lines) {
		if (line.length === 0) continue;
		const first = line[0];
		if (first === "\t") return { useTabs: true, size: 1 };
		if (first === " ") {
			let count = 0;
			while (count < line.length && line[count] === " ") count++;
			return { useTabs: false, size: Math.max(2, Math.min(count, 8)) };
		}
	}
	return { useTabs: true, size: 1 };
}

function sha256(source: string): string {
	return createHash("sha256").update(source, "utf8").digest("hex");
}

async function unlinkIgnoreMissing(path: string): Promise<void> {
	const { unlink } = await import("node:fs/promises");
	try {
		await unlink(path);
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as { code: unknown }).code === "ENOENT"
		) {
			return;
		}
	}
}

function annotatePublisherLine(source: string, handle: string): string {
	if (handle.length === 0) return source;

	const tree = parseTree(source);
	if (!tree || tree.type !== "object") return source;
	const publisherProp = tree.children?.find(
		(prop) =>
			prop.type === "property" &&
			prop.children?.[0]?.type === "string" &&
			prop.children[0].value === "publisher",
	);
	const valueNode = publisherProp?.children?.[1];
	if (!valueNode) return source;

	const endOfValue = valueNode.offset + valueNode.length;
	const lineEnd = source.indexOf("\n", endOfValue);
	if (lineEnd < 0) {
		return `${source} // ${handle}`;
	}
	let insertAt = lineEnd;
	if (insertAt > 0 && source[insertAt - 1] === "\r") insertAt -= 1;
	return `${source.slice(0, insertAt)} // ${handle}${source.slice(insertAt)}`;
}
