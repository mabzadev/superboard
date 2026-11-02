import { P256Keypair, parseDidKey, type Keypair } from "@atproto/crypto";
import {
	MemoryBlockstore,
	Repo,
	WriteOpAction,
	blocksToCarFile,
	getRecords,
	type RecordCreateOp,
	type RecordPath,
} from "@atproto/repo";

import type { AtprotoDid } from "./types.js";

export interface FakeRepoOptions {
	did: AtprotoDid;
	keypair?: Keypair;
}

interface StoredRecord {
	collection: string;
	rkey: string;
	value: unknown;
}

export class FakeRepo {
	readonly did: AtprotoDid;
	readonly keypair: Keypair;
	readonly storage: MemoryBlockstore;
	private repo: Repo;
	private records = new Map<string, StoredRecord>();

	private constructor(did: AtprotoDid, keypair: Keypair, storage: MemoryBlockstore, repo: Repo) {
		this.did = did;
		this.keypair = keypair;
		this.storage = storage;
		this.repo = repo;
	}

	static async create(options: FakeRepoOptions): Promise<FakeRepo> {
		const keypair = options.keypair ?? (await P256Keypair.create({ exportable: true }));
		const storage = new MemoryBlockstore();
		const repo = await Repo.create(storage, options.did, keypair);
		return new FakeRepo(options.did, keypair, storage, repo);
	}

	didKey(): string {
		return this.keypair.did();
	}

	async publicKeyBytes(): Promise<{ bytes: Uint8Array; jwtAlg: string }> {
		const parsed = parseDidKey(this.didKey());
		return { bytes: parsed.keyBytes, jwtAlg: parsed.jwtAlg };
	}

	async putRecord(collection: string, rkey: string, value: Record<string, unknown>): Promise<void> {
		const op = {
			action: WriteOpAction.Create,
			collection,
			rkey,
			record: value,
		} as unknown as RecordCreateOp;
		this.repo = await this.repo.applyWrites(op, this.keypair);
		this.records.set(`${collection}/${rkey}`, { collection, rkey, value });
	}

	async updateRecord(
		collection: string,
		rkey: string,
		value: Record<string, unknown>,
	): Promise<void> {
		const op = {
			action: WriteOpAction.Update,
			collection,
			rkey,
			record: value,
		} as unknown as RecordCreateOp;
		this.repo = await this.repo.applyWrites(op, this.keypair);
		this.records.set(`${collection}/${rkey}`, { collection, rkey, value });
	}

	async deleteRecord(collection: string, rkey: string): Promise<void> {
		const op = {
			action: WriteOpAction.Delete,
			collection,
			rkey,
		} as unknown as RecordCreateOp;
		this.repo = await this.repo.applyWrites(op, this.keypair);
		this.records.delete(`${collection}/${rkey}`);
	}

	async getRecordCar(collection: string, rkey: string): Promise<Uint8Array> {
		const head = await this.storage.getRoot();
		if (!head) throw new Error("repo has no root commit");
		const path: RecordPath = { collection, rkey };
		const chunks: Uint8Array[] = [];
		for await (const chunk of getRecords(this.storage, head, [path])) {
			chunks.push(chunk);
		}
		return concatBytes(chunks);
	}

	async getFullRepoCar(): Promise<Uint8Array> {
		const head = await this.storage.getRoot();
		if (!head) throw new Error("repo has no root commit");
		const blocks = await this.storage.getBlocks([head]);
		return blocksToCarFile(head, blocks.blocks);
	}

	listRecords(collection: string): Array<{ uri: string; value: unknown }> {
		const items: Array<{ uri: string; value: unknown }> = [];
		for (const r of this.records.values()) {
			if (r.collection !== collection) continue;
			items.push({ uri: `at://${this.did}/${r.collection}/${r.rkey}`, value: r.value });
		}
		return items;
	}

	getRecordValue(collection: string, rkey: string): unknown {
		return this.records.get(`${collection}/${rkey}`)?.value;
	}
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}
