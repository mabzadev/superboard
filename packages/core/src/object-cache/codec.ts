const DATE_TAG = "$$emdashDate";

interface TaggedDate {
	[DATE_TAG]: string;
}

function isTaggedDate(value: unknown): value is TaggedDate {
	if (typeof value !== "object" || value === null) return false;
	const keys = Object.keys(value);
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing a JSON-parsed value to read the date tag
	return keys.length === 1 && typeof (value as Record<string, unknown>)[DATE_TAG] === "string";
}

export function encode(value: unknown): string {
	return JSON.stringify(value, function (this: Record<string, unknown>, key, val) {
		const original = this[key];
		if (original instanceof Date) {
			return { [DATE_TAG]: original.toISOString() } satisfies TaggedDate;
		}
		return val;
	});
}

export function decode(raw: string): unknown {
	try {
		return JSON.parse(raw, (_key, value) => {
			if (isTaggedDate(value)) {
				return new Date(value[DATE_TAG]);
			}
			return value;
		});
	} catch {
		return undefined;
	}
}
