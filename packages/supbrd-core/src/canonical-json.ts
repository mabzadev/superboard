export type CanonicalJsonPrimitive = null | boolean | number | string;
export type CanonicalJsonValue =
	| CanonicalJsonPrimitive
	| readonly CanonicalJsonValue[]
	| { readonly [key: string]: CanonicalJsonValue };

export function canonicalizeReleasePayload(value: unknown): string {
	return serializeCanonicalJson(value, new Set<object>());
}

function serializeCanonicalJson(value: unknown, ancestors: Set<object>): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError("Canonical JSON rejects non-finite numbers");
		}
		return JSON.stringify(value);
	}
	if (typeof value === "string") {
		assertUnicodeScalarSequence(value);
		return JSON.stringify(value);
	}
	if (typeof value !== "object") {
		throw new TypeError(`Canonical JSON rejects values of type ${typeof value}`);
	}
	if (ancestors.has(value)) {
		throw new TypeError("Canonical JSON rejects cyclic values");
	}

	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			const items: string[] = [];
			for (let index = 0; index < value.length; index += 1) {
				if (!Object.hasOwn(value, index)) {
					throw new TypeError("Canonical JSON rejects sparse arrays");
				}
				items.push(serializeCanonicalJson(value[index], ancestors));
			}
			return `[${items.join(",")}]`;
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError("Canonical JSON accepts only plain objects");
		}

		const members = Object.keys(value)
			.toSorted()
			.map((key) => {
				assertUnicodeScalarSequence(key);
				return `${JSON.stringify(key)}:${serializeCanonicalJson(Reflect.get(value, key), ancestors)}`;
			});
		return `{${members.join(",")}}`;
	} finally {
		ancestors.delete(value);
	}
}

function assertUnicodeScalarSequence(value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				throw new TypeError("Canonical JSON rejects an unpaired high surrogate");
			}
			index += 1;
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			throw new TypeError("Canonical JSON rejects an unpaired low surrogate");
		}
	}
}
