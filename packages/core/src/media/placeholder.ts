import { encode } from "blurhash";
import { imageSize } from "image-size";

import { normalizeMime } from "./mime.js";

export interface PlaceholderData {
	blurhash: string;
	dominantColor: string;
}

const SUPPORTED_TYPES: Record<string, "jpeg" | "png"> = {
	"image/jpeg": "jpeg",
	"image/jpg": "jpeg",
	"image/png": "png",
};

const MAX_ENCODE_WIDTH = 32;

const MAX_DECODED_BYTES = 32 * 1024 * 1024;

interface DecodedImage {
	width: number;
	height: number;
	data: Uint8Array;
}

async function decodeJpeg(buffer: Uint8Array): Promise<DecodedImage> {
	const { decode } = await import("jpeg-js");
	const result = decode(buffer, { useTArray: true });
	return { width: result.width, height: result.height, data: result.data };
}

async function decodePng(buffer: Uint8Array): Promise<DecodedImage> {
	// @ts-expect-error -- upng-js has no type declarations
	const UPNG = (await import("upng-js")).default;
	const img = UPNG.decode(buffer.buffer);
	const frames: ArrayBuffer[] = UPNG.toRGBA8(img);
	const rgba = new Uint8Array(frames[0]);
	return { width: img.width, height: img.height, data: rgba };
}

function extractDominantColor(data: Uint8Array, width: number, height: number): string {
	let r = 0;
	let g = 0;
	let b = 0;
	let count = 0;

	const len = width * height * 4;
	for (let i = 0; i < len; i += 4) {
		const a = data[i + 3];
		if (a < 128) continue;
		r += data[i];
		g += data[i + 1];
		b += data[i + 2];
		count++;
	}

	if (count === 0) return "rgb(0,0,0)";

	const avgR = Math.round(r / count);
	const avgG = Math.round(g / count);
	const avgB = Math.round(b / count);
	return `rgb(${avgR},${avgG},${avgB})`;
}

export function readDimensions(buffer: Uint8Array): { width: number; height: number } | null {
	try {
		const result = imageSize(buffer);
		if (result.width != null && result.height != null) {
			return { width: result.width, height: result.height };
		}
		return null;
	} catch {
		return null;
	}
}

export async function generatePlaceholder(
	buffer: Uint8Array,
	mimeType: string,
	dimensions?: { width: number; height: number },
): Promise<PlaceholderData | null> {
	const format = SUPPORTED_TYPES[normalizeMime(mimeType)];
	if (!format) return null;

	try {
		const dims = dimensions ?? readDimensions(buffer);

		if (!dims) return null;
		if (dims.width * dims.height * 4 > MAX_DECODED_BYTES) {
			return null;
		}

		const imageData = format === "jpeg" ? await decodeJpeg(buffer) : await decodePng(buffer);
		const { width, height, data } = imageData;

		if (width === 0 || height === 0) return null;

		let encodePixels: Uint8ClampedArray;
		let encodeWidth: number;
		let encodeHeight: number;

		if (width > MAX_ENCODE_WIDTH) {
			const scale = MAX_ENCODE_WIDTH / width;
			encodeWidth = MAX_ENCODE_WIDTH;
			encodeHeight = Math.max(1, Math.round(height * scale));
			encodePixels = downsample(data, width, height, encodeWidth, encodeHeight);
		} else {
			encodeWidth = width;
			encodeHeight = height;
			encodePixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
		}

		const blurhash = encode(encodePixels, encodeWidth, encodeHeight, 4, 3);
		const dominantColor = extractDominantColor(data, width, height);

		return { blurhash, dominantColor };
	} catch {
		return null;
	}
}

function downsample(
	src: Uint8Array,
	srcW: number,
	srcH: number,
	dstW: number,
	dstH: number,
): Uint8ClampedArray {
	const dst = new Uint8ClampedArray(dstW * dstH * 4);

	for (let y = 0; y < dstH; y++) {
		const srcY = Math.floor((y * srcH) / dstH);
		for (let x = 0; x < dstW; x++) {
			const srcX = Math.floor((x * srcW) / dstW);
			const srcIdx = (srcY * srcW + srcX) * 4;
			const dstIdx = (y * dstW + x) * 4;
			dst[dstIdx] = src[srcIdx]!;
			dst[dstIdx + 1] = src[srcIdx + 1]!;
			dst[dstIdx + 2] = src[srcIdx + 2]!;
			dst[dstIdx + 3] = src[srcIdx + 3]!;
		}
	}

	return dst;
}
