import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { isDid } from "@atcute/lexicons/syntax";

import type { CredentialStore, Did, PublisherSession } from "./types.js";

const FILE_VERSION = 1;

interface FileEnvelope {
	version: number;
	currentDid: Did | null;
	sessions: Record<string, PublisherSession>;
}

export interface FileCredentialStoreOptions {
	path?: string;
}

const DEFAULT_PATH = join(homedir(), ".emdash", "credentials.json");

export class FileCredentialStore implements CredentialStore {
	readonly path: string;

	constructor(options: FileCredentialStoreOptions = {}) {
		this.path = options.path ?? DEFAULT_PATH;
	}

	async current(): Promise<PublisherSession | null> {
		const envelope = await this.#read();
		if (!envelope.currentDid) return null;
		return envelope.sessions[envelope.currentDid] ?? null;
	}

	async get(did: Did): Promise<PublisherSession | null> {
		const envelope = await this.#read();
		return envelope.sessions[did] ?? null;
	}

	async list(): Promise<PublisherSession[]> {
		const envelope = await this.#read();
		return Object.values(envelope.sessions);
	}

	async put(session: PublisherSession): Promise<void> {
		if (!isPublisherSession(session)) {
			throw new Error(
				`refusing to persist invalid PublisherSession (${safeStringify(session)}). did, handle, pds, updatedAt are all required; did and pds must be non-empty.`,
			);
		}
		const envelope = await this.#read();
		envelope.sessions[session.did] = { ...session };
		if (!envelope.currentDid) envelope.currentDid = session.did;
		await this.#write(envelope);
	}

	async setCurrent(did: Did): Promise<void> {
		const envelope = await this.#read();
		if (!envelope.sessions[did]) {
			throw new Error(`no stored session for ${did}`);
		}
		envelope.currentDid = did;
		await this.#write(envelope);
	}

	async remove(did: Did): Promise<void> {
		const envelope = await this.#read();
		delete envelope.sessions[did];
		if (envelope.currentDid === did) envelope.currentDid = null;
		await this.#write(envelope);
	}

	async #read(): Promise<FileEnvelope> {
		let raw: string;
		try {
			raw = await readFile(this.path, "utf8");
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				return {
					version: FILE_VERSION,
					currentDid: null,
					sessions: emptySessionsMap(),
				};
			}
			throw error;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(
				`credential store at ${this.path} is not valid JSON; refusing to overwrite. delete it manually if it is corrupted.`,
				{ cause: error },
			);
		}

		if (!isFileEnvelope(parsed)) {
			throw new Error(
				`credential store at ${this.path} has an unrecognised shape; refusing to overwrite.`,
			);
		}

		if (!Number.isInteger(parsed.version) || parsed.version < 1 || parsed.version > FILE_VERSION) {
			throw new Error(
				`credential store at ${this.path} has version ${parsed.version}; this CLI understands versions 1..${FILE_VERSION}. Upgrade emdash-plugin or remove the file manually.`,
			);
		}
		const sessions = emptySessionsMap();
		for (const [k, v] of Object.entries(parsed.sessions)) {
			sessions[k] = v;
		}
		return {
			version: parsed.version,
			currentDid: parsed.currentDid,
			sessions,
		};
	}

	async #write(envelope: FileEnvelope): Promise<void> {
		const dir = dirname(this.path);
		await mkdir(dir, { recursive: true, mode: 0o700 });

		const tmp = `${this.path}.tmp`;
		const body = `${JSON.stringify(envelope, null, 2)}\n`;

		try {
			await writeFile(tmp, body, { mode: 0o600, flush: true });
			await rename(tmp, this.path);
			await fsyncDir(dir).catch(() => {});
		} catch (error) {
			await unlink(tmp).catch(() => {});
			throw error;
		}
	}
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable]";
	}
}

function emptySessionsMap(): Record<string, PublisherSession> {
	const obj: Record<string, PublisherSession> = {};
	Object.setPrototypeOf(obj, null);
	return obj;
}

async function fsyncDir(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
	);
}

function isFileEnvelope(input: unknown): input is FileEnvelope {
	if (!isRecord(input)) return false;
	if (typeof input.version !== "number") return false;
	if (input.currentDid !== null && !isDid(input.currentDid)) return false;
	if (!isRecord(input.sessions)) return false;
	for (const [key, session] of Object.entries(input.sessions)) {
		if (!isPublisherSession(session)) return false;
		if (session.did !== key) return false;
	}
	if (input.currentDid !== null && !Object.hasOwn(input.sessions, input.currentDid)) {
		return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPublisherSession(value: unknown): value is PublisherSession {
	if (!isRecord(value)) return false;
	if (!isDid(value.did)) return false;
	if (value.handle !== null && (typeof value.handle !== "string" || value.handle.length === 0)) {
		return false;
	}
	if (typeof value.pds !== "string" || value.pds.length === 0) return false;
	if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return false;
	return true;
}
