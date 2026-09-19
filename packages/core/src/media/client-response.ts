import { z } from "zod";

const optionalString = z
	.string()
	.nullish()
	.transform((value) => value ?? undefined);
const optionalNumber = z
	.number()
	.nullish()
	.transform((value) => value ?? undefined);
const itemSchema = z.object({
	id: z.string().min(1),
	filename: optionalString,
	mimeType: optionalString,
	url: optionalString,
	previewUrl: optionalString,
	storageKey: optionalString,
	width: optionalNumber,
	height: optionalNumber,
	blurhash: optionalString,
	dominantColor: optionalString,
	alt: optionalString,
	meta: z
		.record(z.string(), z.unknown())
		.nullish()
		.transform((value) => value ?? undefined),
});
const providersSchema = z.object({
	data: z.object({
		items: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					icon: optionalString,
					capabilities: z.object({
						browse: z.boolean(),
						search: z.boolean(),
						upload: z.boolean(),
						delete: z.boolean(),
					}),
				}),
			)
			.default([]),
	}),
});
const listSchema = z.object({ data: z.object({ items: z.array(itemSchema).default([]) }) });
const uploadSchema = z.union([
	z.object({ data: z.object({ item: itemSchema }) }),
	z.object({ item: itemSchema }),
]);

async function readJson(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error(`Media request failed (${response.status})`);
	return response.json();
}

export async function readMediaProvidersResponse(response: Response) {
	return providersSchema.parse(await readJson(response)).data.items;
}
export async function readMediaListResponse(response: Response) {
	return listSchema.parse(await readJson(response)).data.items;
}
export async function readMediaItemResponse(response: Response) {
	const result = uploadSchema.parse(await readJson(response));
	return "data" in result ? result.data.item : result.item;
}
