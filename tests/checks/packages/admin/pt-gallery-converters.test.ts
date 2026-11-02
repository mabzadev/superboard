import { describe, it, expect } from "vitest";

import {
	_portableTextToProsemirror,
	_prosemirrorToPortableText,
} from "../../../../packages/admin/src/components/PortableTextEditor";

describe("Gallery conversion (admin converters): PortableText ↔ ProseMirror", () => {
	it("round-trips a WordPress-shaped gallery block without loss", () => {
		const imported = [
			{
				_type: "gallery",
				_key: "wpgal1",
				images: [
					{
						_type: "image",
						_key: "wpimg1",
						asset: {
							_type: "reference",
							_ref: "01ABC",
							url: "/_emdash/api/media/file/01ABC.jpg",
							provider: "cloudflare-images",
						},
						alt: "Beach",
						caption: "Summer 2019",
						blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4",
						dominantColor: "#336699",
					},
					{
						_type: "image",
						_key: "wpimg2",
						asset: { _type: "reference", _ref: "42", url: "https://old-site.com/photo.jpg" },
					},
				],
				columns: 3,
			},
		];

		const pm = _portableTextToProsemirror(imported);
		const galleryNode = pm.content[0] as { type: string; attrs?: Record<string, unknown> };
		expect(galleryNode.type).toBe("gallery");
		expect(galleryNode.attrs?.images).toHaveLength(2);

		const pt = _prosemirrorToPortableText(pm);
		const restored = pt[0] as {
			_type: string;
			images: Array<Record<string, unknown>>;
			columns?: number;
		};

		expect(restored._type).toBe("gallery");
		expect(restored.columns).toBe(3);
		expect(restored.images).toHaveLength(2);

		const [first, second] = restored.images;
		expect(first).toMatchObject({
			_type: "image",
			asset: {
				_type: "reference",
				_ref: "01ABC",
				url: "/_emdash/api/media/file/01ABC.jpg",
				provider: "cloudflare-images",
			},
			alt: "Beach",
			caption: "Summer 2019",
			blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4",
			dominantColor: "#336699",
		});
		expect(second).toMatchObject({
			_type: "image",
			asset: { _type: "reference", _ref: "42", url: "https://old-site.com/photo.jpg" },
		});
		expect(second?.asset).not.toHaveProperty("provider");
	});
});
