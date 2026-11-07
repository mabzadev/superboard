export const R2_FOLDERS = {
	site: "site/",
	files: "files/",
	support: "support/",
	analytics: "analytics/",
	marketing: "marketing/",
	flows: "flows/",
	backups: "backups/",
} as const;

export type R2Folder = (typeof R2_FOLDERS)[keyof typeof R2_FOLDERS];

const KEYED_METHODS = new Set<PropertyKey>([
	"head",
	"get",
	"put",
	"createMultipartUpload",
	"resumeMultipartUpload",
]);

function relativeObject<T extends object>(object: T, folder: string): T {
	return new Proxy(object, {
		get(target, property) {
			const value: unknown = Reflect.get(target, property, target);
			if (property === "key" && typeof value === "string") return value.slice(folder.length);
			if (typeof value !== "function") return value;
			const bound: unknown = value.bind(target);
			return bound;
		},
	});
}

function relativeListing(listed: unknown, folder: string): unknown {
	if (typeof listed !== "object" || listed === null) return listed;
	const objects: unknown = Reflect.get(listed, "objects");
	const prefixes: unknown = Reflect.get(listed, "delimitedPrefixes");
	return {
		...listed,
		...(Array.isArray(objects)
			? {
					objects: objects.map((object: unknown) =>
						typeof object === "object" && object !== null ? relativeObject(object, folder) : object,
					),
				}
			: {}),
		...(Array.isArray(prefixes)
			? {
					delimitedPrefixes: prefixes.map((prefix: unknown) =>
						typeof prefix === "string" ? prefix.slice(folder.length) : prefix,
					),
				}
			: {}),
	};
}

/**
 * Restricts an R2 binding to one folder of a bucket shared by several modules.
 * Keys passed in and keys returned by `list()` are relative to the folder; the
 * objects returned by `head()`, `get()` and `put()` keep their full bucket key.
 */
export function scopedR2Bucket<B extends object>(bucket: B, folder: R2Folder): B {
	return new Proxy(bucket, {
		get(target, property) {
			const value: unknown = Reflect.get(target, property, target);
			if (typeof value !== "function") return value;
			if (KEYED_METHODS.has(property)) {
				return (key: string, ...rest: unknown[]): unknown =>
					Reflect.apply(value, target, [`${folder}${key}`, ...rest]);
			}
			if (property === "delete") {
				return (keys: string | string[]): unknown =>
					Reflect.apply(value, target, [
						Array.isArray(keys) ? keys.map((key) => `${folder}${key}`) : `${folder}${keys}`,
					]);
			}
			if (property === "list") {
				return async (options: { prefix?: string } = {}): Promise<unknown> => {
					const listed: unknown = await Reflect.apply(value, target, [
						{ ...options, prefix: `${folder}${options.prefix ?? ""}` },
					]);
					return relativeListing(listed, folder);
				};
			}
			const bound: unknown = value.bind(target);
			return bound;
		},
	});
}
