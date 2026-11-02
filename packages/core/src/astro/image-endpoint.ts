import type { APIRoute } from "astro";
// @ts-ignore - astro/assets internal endpoint, resolved by the consumer's Astro build
import { GET as genericGET } from "astro/assets/endpoint/generic";
// @ts-ignore - astro:assets is resolved by the consumer's Astro build
import { getConfiguredImageService, imageConfig } from "astro:assets";

import {
	IMMUTABLE_IMAGE_CACHE,
	matchInternalMediaKey,
	originalMediaHeaders,
} from "../media/image-endpoint.js";

export const prerender = false;

const FORMAT_MIME: Record<string, string> = {
	webp: "image/webp",
	avif: "image/avif",
	png: "image/png",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	gif: "image/gif",
};

function isNotFound(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes("not found") || error.message.includes("NOT_FOUND"))
	);
}

function streamOriginal(body: ReadableStream<Uint8Array>, contentType: string): Response {
	return new Response(body, { status: 200, headers: originalMediaHeaders(contentType) });
}

export const GET: APIRoute = async (ctx) => {
	const url = new URL(ctx.request.url);
	const key = matchInternalMediaKey(url.searchParams.get("href"));
	const storage = ctx.locals.emdash?.storage;

	if (!key || !storage) return genericGET(ctx);

	const service = await getConfiguredImageService();
	if (!("transform" in service)) return genericGET(ctx);

	try {
		const source = await storage.download(key);

		if (!source.contentType.startsWith("image/")) {
			return streamOriginal(source.body, source.contentType);
		}

		const transform = await service.parseURL(url, imageConfig);
		if (!transform) return streamOriginal(source.body, source.contentType);

		const inputBuffer = new Uint8Array(await new Response(source.body).arrayBuffer());
		const { data, format } = await service.transform(inputBuffer, transform, imageConfig);

		return new Response(data, {
			status: 200,
			headers: {
				"Content-Type": FORMAT_MIME[format] ?? source.contentType,
				"Cache-Control": IMMUTABLE_IMAGE_CACHE,
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (error) {
		if (isNotFound(error)) return new Response("Not Found", { status: 404 });
		console.error("[emdash] image transform failed:", error);
		return new Response("Internal Server Error", { status: 500 });
	}
};
