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

type Method = (...args: unknown[]) => unknown;

interface ListedObjects {
	objects?: object[];
	delimitedPrefixes?: string[];
}

function relativeObject<T extends object>(object: T, folder: string): T {
	return new Proxy(object, {
		get(target, property) {
			const value: unknown = Reflect.get(target, property, target);
			if (property === "key" && typeof value === "string") return value.slice(folder.length);
			return typeof value === "function" ? (value as Method).bind(target) : value;
		},
	});
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
			const method = value as Method;
			if (KEYED_METHODS.has(property)) {
				return (key: string, ...rest: unknown[]) => method.call(target, `${folder}${key}`, ...rest);
			}
			if (property === "delete") {
				return (keys: string | string[]) =>
					method.call(
						target,
						Array.isArray(keys) ? keys.map((key) => `${folder}${key}`) : `${folder}${keys}`,
					);
			}
			if (property === "list") {
				return async (options: { prefix?: string } = {}) => {
					const listed = (await method.call(target, {
						...options,
						prefix: `${folder}${options.prefix ?? ""}`,
					})) as ListedObjects;
					return {
						...listed,
						objects: listed.objects?.map((object) => relativeObject(object, folder)),
						delimitedPrefixes: listed.delimitedPrefixes?.map((prefix) =>
							prefix.slice(folder.length),
						),
					};
				};
			}
			return method.bind(target);
		},
	});
}
