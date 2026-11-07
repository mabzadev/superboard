import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { encodePath } from "../api.js";
import { UsageError } from "../errors.js";
import { bytes, table } from "../format.js";

const MEBIBYTE = 1024 * 1024;
export const MULTIPART_THRESHOLD = 50 * MEBIBYTE;
export const PART_SIZE = 50 * MEBIBYTE;
const CONTENT_TYPES = {
	".avif": "image/avif",
	".css": "text/css",
	".csv": "text/csv",
	".gif": "image/gif",
	".html": "text/html",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript",
	".json": "application/json",
	".md": "text/markdown",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".pdf": "application/pdf",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain",
	".wav": "audio/wav",
	".webm": "video/webm",
	".webp": "image/webp",
	".zip": "application/zip",
};

const bucketPath = (family, bucket, path) =>
	`/storage/${family}/${encodeURIComponent(bucket)}${path === undefined ? "" : `/${encodePath(path)}`}`;

function objectPath(path) {
	if (!path || path.startsWith("/"))
		throw new UsageError("Object paths are relative, such as reports/2026.csv.");
	return path;
}

async function multipart(ctx, { bucket, path, file, size, contentType, upsert, resume }) {
	const api = ctx.api();
	const base = `/storage/uploads/${encodeURIComponent(bucket)}`;
	const partSize = ctx.limits.partSize;
	const count = Math.ceil(size / partSize);
	const sizeOf = (part) => Math.min(partSize, size - (part - 1) * partSize);
	const received = new Map();
	let uploadId = resume;
	if (uploadId) {
		const status = await api.request("GET", `${base}/${encodeURIComponent(uploadId)}`);
		if (status.path !== path)
			throw new UsageError(`Upload ${uploadId} belongs to ${status.path}, not ${path}.`);
		for (const part of status.parts ?? []) {
			if (part.part_number > count)
				throw new UsageError("Resume with the same file; the parts do not match.");
			received.set(part.part_number, part.size);
		}
	} else {
		({ upload_id: uploadId } = await api.request("POST", base, {
			json: { path, content_type: contentType, upsert },
		}));
	}
	const handle = await open(file, "r");
	try {
		for (let part = 1; part <= count; part += 1) {
			if (received.get(part) === sizeOf(part)) continue;
			const buffer = Buffer.alloc(sizeOf(part));
			// oxlint-disable-next-line no-await-in-loop -- one part in memory at a time, in order
			await handle.read(buffer, 0, buffer.length, (part - 1) * partSize);
			// oxlint-disable-next-line no-await-in-loop -- parts are sent in order so a failure can resume
			await api.request("PUT", `${base}/${encodeURIComponent(uploadId)}/${part}`, {
				body: buffer,
				headers: { "Content-Type": "application/octet-stream" },
			});
			if (!ctx.json) ctx.err(`Uploaded part ${part}/${count}\n`);
		}
		return await api.request("POST", `${base}/${encodeURIComponent(uploadId)}/complete`);
	} catch (error) {
		error.hint = `Resume with: superboard storage upload ${bucket} ${path} ${file} --resume ${uploadId}`;
		throw error;
	} finally {
		await handle.close();
	}
}

export const storageCommands = {
	"storage buckets": {
		summary: "List the buckets and their rules",
		usage: "superboard storage buckets",
		async run(ctx) {
			const result = await ctx.api().request("GET", "/manage/buckets");
			ctx.print(result, ({ items }) =>
				table(
					items,
					[
						["NAME", (bucket) => bucket.name],
						["PUBLIC", (bucket) => (bucket.public ? "yes" : "no")],
						["MAX SIZE", (bucket) => bytes(bucket.max_bytes)],
						[
							"TYPES",
							(bucket) => (bucket.allowed_types?.length ? bucket.allowed_types.join(", ") : "any"),
						],
						["READ", (bucket) => bucket.rules?.read ?? ""],
						["WRITE", (bucket) => bucket.rules?.write ?? ""],
						["DELETE", (bucket) => bucket.rules?.delete ?? ""],
					],
					"No buckets yet. Create one in the Front.",
				),
			);
		},
	},
	"storage ls": {
		summary: "List the objects of a bucket",
		usage: "superboard storage ls <bucket> [--prefix p] [--limit n] [--cursor c]",
		positionals: ["bucket"],
		options: {
			prefix: { type: "string", description: "Only paths starting with this prefix" },
			limit: { type: "string", description: "Page size, 100 by default" },
			cursor: { type: "string", description: "Continue after a previous page" },
		},
		async run(ctx, values, [bucket]) {
			const result = await ctx.api().request("GET", bucketPath("list", bucket), {
				query: [
					["prefix", values.prefix],
					["limit", values.limit],
					["cursor", values.cursor],
				],
			});
			ctx.print(result, ({ items }) =>
				table(
					items,
					[
						["PATH", (object) => object.path],
						["SIZE", (object) => bytes(object.size)],
						["TYPE", (object) => object.content_type],
						["UPDATED", (object) => object.updated_at],
					],
					"No objects.",
				),
			);
			if (!ctx.json && result.nextCursor)
				ctx.err(`More objects: add --cursor ${result.nextCursor}\n`);
		},
	},
	"storage upload": {
		summary: "Upload a file; files above 50 MiB are sent in resumable parts",
		usage:
			"superboard storage upload <bucket> <path> <file> [--upsert] [--content-type type] [--resume upload-id]",
		positionals: ["bucket", "path", "file"],
		options: {
			upsert: { type: "boolean", description: "Replace an existing object" },
			"content-type": {
				type: "string",
				description: "Media type; guessed from the extension otherwise",
			},
			resume: { type: "string", description: "Continue an interrupted upload" },
		},
		async run(ctx, values, [bucket, path, file]) {
			const location = resolve(ctx.cwd, file);
			let info;
			try {
				info = await stat(location);
			} catch {
				throw new UsageError(`Cannot read ${file}.`);
			}
			if (!info.isFile()) throw new UsageError(`${file} is not a file.`);
			const contentType =
				values["content-type"] ??
				CONTENT_TYPES[extname(location).toLowerCase()] ??
				"application/octet-stream";
			const upsert = values.upsert === true;
			const result =
				info.size > ctx.limits.multipartThreshold || values.resume
					? await multipart(ctx, {
							bucket,
							path: objectPath(path),
							file: location,
							size: info.size,
							contentType,
							upsert,
							resume: values.resume,
						})
					: await ctx.api().request("PUT", bucketPath("object", bucket, objectPath(path)), {
							body: await readFile(location),
							headers: { "Content-Type": contentType, ...(upsert ? { "x-upsert": "true" } : {}) },
						});
			ctx.print(
				result,
				(object) =>
					`Uploaded ${object.bucket}/${object.path} (${bytes(object.size)}, ${object.content_type})`,
			);
		},
	},
	"storage download": {
		summary: "Download an object to a file or standard output",
		usage: "superboard storage download <bucket> <path> [--out file]",
		positionals: ["bucket", "path"],
		options: { out: { type: "string", description: "File to write; standard output by default" } },
		async run(ctx, values, [bucket, path]) {
			const response = await ctx
				.api()
				.request("GET", bucketPath("object", bucket, objectPath(path)), {
					as: "response",
				});
			const source = response.body ? Readable.fromWeb(response.body) : Readable.from([]);
			if (!values.out) {
				for await (const chunk of source)
					if (!ctx.stdout.write(chunk)) await once(ctx.stdout, "drain");
				return;
			}
			await pipeline(source, createWriteStream(resolve(ctx.cwd, values.out)));
			const size = (await stat(resolve(ctx.cwd, values.out))).size;
			if (ctx.json) ctx.print({ path: values.out, size });
			else ctx.err(`Saved ${bytes(size)} to ${values.out}\n`);
		},
	},
	"storage rm": {
		summary: "Delete an object",
		usage: "superboard storage rm <bucket> <path>",
		positionals: ["bucket", "path"],
		async run(ctx, values, [bucket, path]) {
			const result = await ctx
				.api()
				.request("DELETE", bucketPath("object", bucket, objectPath(path)));
			ctx.print(result, () => `Deleted ${bucket}/${path}`);
		},
	},
};
