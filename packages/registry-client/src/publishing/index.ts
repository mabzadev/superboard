// eslint-disable-next-line @typescript-eslint/no-empty-named-blocks, eslint-plugin-import/no-empty-named-blocks, eslint-plugin-unicorn/require-module-specifiers, import/no-empty-named-blocks, unicorn/require-module-specifiers
import type {} from "@atcute/atproto";
import { Client, type FetchHandler, type FetchHandlerObject, ok } from "@atcute/client";
import type { Nsid } from "@atcute/lexicons";
import type { RegistryRecordCollection, RegistryRecords } from "@emdash-cms/registry-lexicons";

import type { Did } from "../credentials/types.js";

export interface PublishingClientFromHandlerOptions {
	handler: FetchHandler | FetchHandlerObject;

	did: Did;

	pds: string;
}

export interface PublishCreate<C extends RegistryRecordCollection = RegistryRecordCollection> {
	op: "create";
	collection: C;
	rkey: string;
	record: RegistryRecords[C];
}

export interface PublishUpdate<C extends RegistryRecordCollection = RegistryRecordCollection> {
	op: "update";
	collection: C;
	rkey: string;
	record: RegistryRecords[C];
}

export interface PublishDelete {
	op: "delete";
	collection: Nsid;
	rkey: string;
}

export type PublishOperation = PublishCreate | PublishUpdate | PublishDelete;

export interface ApplyWritesResult {
	results: Array<
		| { op: "create"; uri: string; cid: string }
		| { op: "update"; uri: string; cid: string }
		| { op: "delete" }
	>;
}

export class PublishingClient {
	readonly did: Did;
	readonly pds: string;
	readonly #client: Client;

	private constructor(client: Client, did: Did, pds: string) {
		this.#client = client;
		this.did = did;
		this.pds = pds;
	}

	static fromHandler(options: PublishingClientFromHandlerOptions): PublishingClient {
		const client = new Client({ handler: options.handler });
		return new PublishingClient(client, options.did, options.pds);
	}

	async putRecord<C extends RegistryRecordCollection>(input: {
		collection: C;
		rkey: string;
		record: RegistryRecords[C];
		skipValidation?: boolean;
		swapRecord?: string;
	}): Promise<{ uri: string; cid: string }> {
		return this.#putRecord({
			collection: input.collection,
			rkey: input.rkey,
			record: input.record,
			skipValidation: input.skipValidation ?? false,
			...(input.swapRecord !== undefined ? { swapRecord: input.swapRecord } : {}),
		});
	}

	async unsafePutRecord(input: {
		collection: Nsid;
		rkey: string;
		record: Record<string, unknown>;
		skipValidation?: boolean;
		swapRecord?: string;
	}): Promise<{ uri: string; cid: string }> {
		return this.#putRecord({ ...input, skipValidation: input.skipValidation ?? false });
	}

	async #putRecord(input: {
		collection: Nsid;
		rkey: string;
		record: Record<string, unknown>;
		skipValidation: boolean;
		swapRecord?: string;
	}): Promise<{ uri: string; cid: string }> {
		const data = await ok(
			this.#client.post("com.atproto.repo.putRecord", {
				input: {
					repo: this.did,
					collection: input.collection,
					rkey: input.rkey,
					record: input.record,
					validate: !input.skipValidation,
					...(input.swapRecord !== undefined ? { swapRecord: input.swapRecord } : {}),
				},
			}),
		);
		return { uri: data.uri, cid: data.cid };
	}

	async applyWrites(input: {
		writes: PublishOperation[];
		skipValidation?: boolean;
		swapCommit?: string;
	}): Promise<ApplyWritesResult> {
		const writes = input.writes.map((op) => {
			switch (op.op) {
				case "create":
					return {
						$type: "com.atproto.repo.applyWrites#create" as const,
						collection: op.collection,
						rkey: op.rkey,
						value: op.record,
					};
				case "update":
					return {
						$type: "com.atproto.repo.applyWrites#update" as const,
						collection: op.collection,
						rkey: op.rkey,
						value: op.record,
					};
				case "delete":
					return {
						$type: "com.atproto.repo.applyWrites#delete" as const,
						collection: op.collection,
						rkey: op.rkey,
					};
			}
		});

		const data = await ok(
			this.#client.post("com.atproto.repo.applyWrites", {
				input: {
					repo: this.did,
					validate: !(input.skipValidation ?? false),
					writes,
					...(input.swapCommit !== undefined ? { swapCommit: input.swapCommit } : {}),
				},
			}),
		);

		const results: ApplyWritesResult["results"] = (data.results ?? []).map((r) => {
			const $type = (r as { $type?: string }).$type;
			if ($type === "com.atproto.repo.applyWrites#createResult") {
				const cr = r as { uri: string; cid: string };
				return { op: "create", uri: cr.uri, cid: cr.cid };
			}
			if ($type === "com.atproto.repo.applyWrites#updateResult") {
				const ur = r as { uri: string; cid: string };
				return { op: "update", uri: ur.uri, cid: ur.cid };
			}
			return { op: "delete" };
		});
		return { results };
	}

	async getRecord(input: {
		collection: Nsid;
		rkey: string;
	}): Promise<{ uri: string; cid: string; value: unknown }> {
		const data = await ok(
			this.#client.get("com.atproto.repo.getRecord", {
				params: {
					repo: this.did,
					collection: input.collection,
					rkey: input.rkey,
				},
			}),
		);
		return {
			uri: data.uri,
			cid: data.cid ?? "",
			value: data.value,
		};
	}

	async listRecords(input: {
		collection: Nsid;
		limit?: number;
		cursor?: string;
		reverse?: boolean;
	}): Promise<{
		records: Array<{ uri: string; cid: string; value: unknown }>;
		cursor?: string;
	}> {
		const data = await ok(
			this.#client.get("com.atproto.repo.listRecords", {
				params: {
					repo: this.did,
					collection: input.collection,
					...(input.limit !== undefined ? { limit: input.limit } : {}),
					...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
					...(input.reverse !== undefined ? { reverse: input.reverse } : {}),
				},
			}),
		);
		return {
			records: data.records.map((r) => ({
				uri: r.uri,
				cid: r.cid,
				value: r.value,
			})),
			...(data.cursor ? { cursor: data.cursor } : {}),
		};
	}
}
