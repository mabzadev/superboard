export interface CMSAnnotation {
	collection: string;
	id: string;
	field?: string;
	status?: string;
	hasDraft?: boolean;
}

export interface FieldAnnotation {
	"data-emdash-ref": string;
}

export interface EditableOptions {
	status?: string;
	hasDraft?: boolean;
}

export function createEditable(
	collection: string,
	id: string,
	options?: EditableOptions,
): EditProxy {
	const base: CMSAnnotation = {
		collection,
		id,
		...(options?.status && { status: options.status }),
		...(options?.hasDraft && { hasDraft: true }),
	};

	return new Proxy(
		{},
		{
			get(_, prop) {
				if (prop === "toJSON") return () => ({ "data-emdash-ref": JSON.stringify(base) });
				if (typeof prop === "symbol") return undefined;

				if (prop === "data-emdash-ref") return JSON.stringify(base);

				return {
					"data-emdash-ref": JSON.stringify({ ...base, field: String(prop) }),
				} satisfies FieldAnnotation;
			},
			ownKeys() {
				return ["data-emdash-ref"];
			},
			getOwnPropertyDescriptor(_, prop) {
				if (prop === "data-emdash-ref") {
					return {
						configurable: true,
						enumerable: true,
						value: JSON.stringify(base),
					};
				}
				return undefined;
			},
		},
	);
}

export function createNoop(): EditProxy {
	return new Proxy(
		{},
		{
			get(_, prop) {
				if (typeof prop === "symbol") return undefined;
				return undefined;
			},
			ownKeys() {
				return [];
			},
			getOwnPropertyDescriptor() {
				return undefined;
			},
		},
	);
}

export type EditProxy = {
	readonly [field: string]: Partial<FieldAnnotation>;
};
