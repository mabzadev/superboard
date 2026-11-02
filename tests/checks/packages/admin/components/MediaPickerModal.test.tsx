import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { MediaPickerModal } from "../../../../../packages/admin/src/components/MediaPickerModal";
import { render } from "../utils/render.tsx";

const UPLOAD_BUTTON_REGEX = /^Upload$/;

vi.mock("../../../../../packages/admin/src/lib/api", async () => {
	const actual = await vi.importActual("../../../../../packages/admin/src/lib/api");
	return {
		...actual,
		fetchMediaList: vi.fn().mockResolvedValue({
			items: [
				{
					id: "m1",
					filename: "photo.jpg",
					mimeType: "image/jpeg",
					url: "/media/photo.jpg",
					size: 1024,
					width: 800,
					height: 600,
					focalX: 0.2,
					focalY: 0.8,
					createdAt: "2024-01-01",
				},
				{
					id: "m2",
					filename: "landscape.png",
					mimeType: "image/png",
					url: "/media/landscape.png",
					size: 2048,
					width: 1200,
					height: 800,
					createdAt: "2024-01-02",
				},
			],
		}),
		fetchMediaProviders: vi.fn().mockResolvedValue([]),
		fetchProviderMedia: vi.fn().mockResolvedValue({ items: [] }),
		uploadMedia: vi.fn().mockResolvedValue({ id: "m3", filename: "new.jpg" }),
		uploadToProvider: vi.fn().mockResolvedValue({}),
		updateMedia: vi.fn().mockResolvedValue({}),
	};
});

function QueryWrapper({ children }: { children: React.ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderModal(props: Partial<React.ComponentProps<typeof MediaPickerModal>> = {}) {
	const defaultProps: React.ComponentProps<typeof MediaPickerModal> = {
		open: true,
		onOpenChange: vi.fn(),
		onSelect: vi.fn(),
		...props,
	};
	return render(
		<QueryWrapper>
			<MediaPickerModal {...defaultProps} />
		</QueryWrapper>,
	);
}

describe("MediaPickerModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("displaying items", () => {
		it("shows media items when open", async () => {
			const screen = await renderModal({ open: true });
			await expect.element(screen.getByRole("option", { name: "photo.jpg" })).toBeInTheDocument();
			await expect
				.element(screen.getByRole("option", { name: "landscape.png" }))
				.toBeInTheDocument();
			const image = screen
				.getByRole("option", { name: "photo.jpg" })
				.element()
				.querySelector("img");
			expect(image?.style.objectPosition).toBe("20% 80%");
		});

		it("shows the modal title", async () => {
			const screen = await renderModal({ title: "Pick an Image" });
			await expect.element(screen.getByText("Pick an Image")).toBeInTheDocument();
		});
	});

	describe("selection", () => {
		it("single click selects item (highlighted)", async () => {
			const screen = await renderModal();
			const option = screen.getByRole("option", { name: "photo.jpg" });
			await expect.element(option).toBeInTheDocument();

			const btn = option.element().querySelector("button")!;
			btn.click();

			await expect.element(option).toHaveAttribute("aria-selected", "true");
			await expect.element(screen.getByRole("strong")).toBeInTheDocument();
		});

		it("double click selects and calls onSelect", async () => {
			const onSelect = vi.fn();
			const screen = await renderModal({ onSelect });

			const option = screen.getByRole("option", { name: "photo.jpg" });
			await expect.element(option).toBeInTheDocument();

			const btn = option.element().querySelector("button")!;
			btn.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

			expect(onSelect).toHaveBeenCalledWith(
				expect.objectContaining({ id: "m1", filename: "photo.jpg" }),
			);
		});

		it("Insert button disabled when nothing selected", async () => {
			await renderModal();
			await vi.waitFor(() => {
				const allInsertBtns = document.querySelectorAll("button");
				const insertBtns = [...allInsertBtns].filter((b) => b.textContent?.trim() === "Insert");
				const lastInsert = insertBtns.at(-1);
				expect(lastInsert?.disabled).toBe(true);
			});
		});

		it("Insert button enabled when item selected, calls onSelect", async () => {
			const onSelect = vi.fn();
			const screen = await renderModal({ onSelect });

			const option = screen.getByRole("option", { name: "photo.jpg" });
			await expect.element(option).toBeInTheDocument();
			const itemBtn = option.element().querySelector("button")!;
			itemBtn.click();

			await expect.element(option).toHaveAttribute("aria-selected", "true");

			await vi.waitFor(() => {
				const allInsertBtns = document.querySelectorAll("button");
				const insertBtns = [...allInsertBtns].filter((b) => b.textContent?.trim() === "Insert");
				const lastInsert = insertBtns.at(-1)!;
				expect(lastInsert.disabled).toBe(false);
				lastInsert.click();
			});

			expect(onSelect).toHaveBeenCalledWith(
				expect.objectContaining({ id: "m1", filename: "photo.jpg" }),
			);
		});
	});

	describe("URL input", () => {
		it("invalid URL shows error", async () => {
			const screen = await renderModal();

			const urlInput = screen.getByLabelText("Image URL");
			await expect.element(urlInput).toBeInTheDocument();

			const inputEl = urlInput.element() as HTMLInputElement;
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)!.set!;
			nativeInputValueSetter.call(inputEl, "not-a-url");
			inputEl.dispatchEvent(new Event("input", { bubbles: true }));
			inputEl.dispatchEvent(new Event("change", { bubbles: true }));

			await vi.waitFor(() => {
				const urlInsert = [...document.querySelectorAll("button")].find(
					(b) => b.textContent?.trim() === "Insert",
				)!;
				expect(urlInsert.disabled).toBe(false);
				urlInsert.click();
			});

			await expect.element(screen.getByText("Please enter a valid URL")).toBeInTheDocument();
		});

		it("URL input: typing a URL and submitting triggers probe", async () => {
			const onSelect = vi.fn();
			const screen = await renderModal({ onSelect });

			const urlInput = screen.getByLabelText("Image URL");
			const inputEl = urlInput.element() as HTMLInputElement;
			const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)!.set!;
			nativeInputValueSetter.call(inputEl, "https://example.com/test.jpg");
			inputEl.dispatchEvent(new Event("input", { bubbles: true }));
			inputEl.dispatchEvent(new Event("change", { bubbles: true }));

			await vi.waitFor(() => {
				const urlInsert = [...document.querySelectorAll("button")].find(
					(b) => b.textContent?.trim() === "Insert",
				)!;
				urlInsert.click();
			});

			await vi.waitFor(
				() => {
					const called = onSelect.mock.calls.length > 0;
					const hasError =
						document.body.textContent?.includes("Could not load image from URL") ?? false;
					expect(called || hasError).toBe(true);
				},
				{ timeout: 3000 },
			);
		});

		it("hideUrlInput hides the URL input section (for non-image pickers)", async () => {
			const screen = await renderModal({ hideUrlInput: true });

			await expect.element(screen.getByText("Select Image")).toBeInTheDocument();
			expect(document.body.textContent).not.toContain("Insert from URL");
			expect(document.body.textContent).not.toContain("or choose from library");

			const urlInput = document.querySelector('input[aria-label="Image URL"]');
			expect(urlInput).toBeNull();
		});

		it("localOnly hides the URL input section", async () => {
			const screen = await renderModal({ localOnly: true });

			await expect.element(screen.getByText("Select Image")).toBeInTheDocument();
			expect(document.body.textContent).not.toContain("Insert from URL");

			const urlInput = document.querySelector('input[aria-label="Image URL"]');
			expect(urlInput).toBeNull();
		});

		it("renders external provider tabs by default (control for localOnly)", async () => {
			const api = await import("../../../../../packages/admin/src/lib/api");
			(api.fetchMediaProviders as any).mockResolvedValueOnce([
				{
					id: "cloudflare-images",
					name: "Cloudflare Images",
					capabilities: { upload: true, search: false },
				},
			]);

			const screen = await renderModal();
			await expect.element(screen.getByText("Cloudflare Images")).toBeInTheDocument();
		});

		it("localOnly suppresses external provider tabs and skips the providers fetch", async () => {
			const api = await import("../../../../../packages/admin/src/lib/api");
			(api.fetchMediaProviders as any).mockResolvedValueOnce([
				{
					id: "cloudflare-images",
					name: "Cloudflare Images",
					capabilities: { upload: true, search: false },
				},
				{
					id: "unsplash",
					name: "Unsplash",
					capabilities: { upload: false, search: true },
				},
			]);

			const screen = await renderModal({ localOnly: true });

			await expect.element(screen.getByText("Select Image")).toBeInTheDocument();
			expect(document.body.textContent).not.toContain("Cloudflare Images");
			expect(document.body.textContent).not.toContain("Unsplash");
			expect(api.fetchMediaProviders).not.toHaveBeenCalled();
		});
	});

	describe("mediaKind", () => {
		it("uses file-specific copy when mediaKind is 'file'", async () => {
			const api = await import("../../../../../packages/admin/src/lib/api");
			(api.fetchMediaList as any).mockResolvedValueOnce({ items: [] });

			const screen = await renderModal({ mediaKind: "file", hideUrlInput: true });

			await expect.element(screen.getByText("Select File")).toBeInTheDocument();
			expect(document.body.textContent).not.toContain("Select Image");

			await expect.element(screen.getByText("Upload a file to get started")).toBeInTheDocument();
			await expect.element(screen.getByText("Upload File")).toBeInTheDocument();
			expect(document.body.textContent).not.toContain("Upload an image to get started");
			expect(document.body.textContent).not.toContain("Upload Image");
		});

		it("defaults to image-specific copy when mediaKind is unset", async () => {
			const api = await import("../../../../../packages/admin/src/lib/api");
			(api.fetchMediaList as any).mockResolvedValueOnce({ items: [] });

			const screen = await renderModal();

			await expect.element(screen.getByText("Select Image")).toBeInTheDocument();
			await expect.element(screen.getByText("Upload an image to get started")).toBeInTheDocument();
		});
	});

	describe("cancel and close", () => {
		it("Cancel closes modal", async () => {
			const onOpenChange = vi.fn();
			const screen = await renderModal({ onOpenChange });

			await expect.element(screen.getByText("Select Image")).toBeInTheDocument();
			const cancelEl = screen.getByText("Cancel").element();
			const cancelBtn = cancelEl.closest("button")!;
			cancelBtn.click();

			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	describe("state reset", () => {
		it("state resets when modal reopens", async () => {
			const onSelect = vi.fn();
			const onOpenChange = vi.fn();
			const screen = await renderModal({ open: true, onSelect, onOpenChange });

			const option = screen.getByRole("option", { name: "photo.jpg" });
			await expect.element(option).toBeInTheDocument();
			const btn = option.element().querySelector("button")!;
			btn.click();

			await expect.element(option).toHaveAttribute("aria-selected", "true");

			await screen.rerender(
				<QueryWrapper>
					<MediaPickerModal open={false} onOpenChange={onOpenChange} onSelect={onSelect} />
				</QueryWrapper>,
			);

			await screen.rerender(
				<QueryWrapper>
					<MediaPickerModal open={true} onOpenChange={onOpenChange} onSelect={onSelect} />
				</QueryWrapper>,
			);

			await vi.waitFor(() => {
				const allInsertBtns = document.querySelectorAll("button");
				const insertBtns = [...allInsertBtns].filter((b) => b.textContent?.trim() === "Insert");
				const lastInsert = insertBtns.at(-1);
				expect(lastInsert?.disabled).toBe(true);
			});
		});
	});

	describe("upload", () => {
		it("upload button and file input are present", async () => {
			const screen = await renderModal();
			await expect
				.element(screen.getByRole("button", { name: UPLOAD_BUTTON_REGEX }))
				.toBeInTheDocument();
			await expect.element(screen.getByLabelText("Upload file")).toBeInTheDocument();
		});
	});

	describe("load more pagination", () => {
		it("renders Load More button when first page returns nextCursor", async () => {
			const api = await import("../../../../../packages/admin/src/lib/api");
			(api.fetchMediaList as any).mockResolvedValueOnce({
				items: [
					{
						id: "p1",
						filename: "page1.jpg",
						mimeType: "image/jpeg",
						url: "/media/page1.jpg",
						size: 1024,
						width: 800,
						height: 600,
						createdAt: "2024-01-01",
					},
				],
				nextCursor: "cursor-2",
			});

			const screen = await renderModal();
			await expect.element(screen.getByRole("option", { name: "page1.jpg" })).toBeInTheDocument();
			await expect.element(screen.getByRole("button", { name: "Load More" })).toBeInTheDocument();
		});

		it("does not render Load More button when no nextCursor", async () => {
			const screen = await renderModal();
			await expect.element(screen.getByRole("option", { name: "photo.jpg" })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "Load More" }).query()).toBeNull();
		});

		it("keeps already-loaded items visible while fetching the next page", async () => {
			const api = await import("../../../../../packages/admin/src/lib/api");
			const mock = api.fetchMediaList as any;
			mock.mockReset();
			let resolveSecond: (value: unknown) => void = () => {};
			const secondPagePromise = new Promise((resolve) => {
				resolveSecond = resolve;
			});
			mock
				.mockResolvedValueOnce({
					items: [
						{
							id: "p1",
							filename: "page1.jpg",
							mimeType: "image/jpeg",
							url: "/media/page1.jpg",
							size: 1024,
							width: 800,
							height: 600,
							createdAt: "2024-01-01",
						},
					],
					nextCursor: "cursor-2",
				})
				.mockReturnValueOnce(secondPagePromise);

			const screen = await renderModal();
			await expect.element(screen.getByRole("option", { name: "page1.jpg" })).toBeInTheDocument();

			const loadMoreBtn = [...document.querySelectorAll("button")].find(
				(b) => b.textContent?.trim() === "Load More",
			)!;
			loadMoreBtn.click();

			await expect.element(screen.getByRole("option", { name: "page1.jpg" })).toBeInTheDocument();

			resolveSecond({ items: [] });
		});

		it("Load More click fetches the next page with the previous cursor", async () => {
			const api = await import("../../../../../packages/admin/src/lib/api");
			const mock = api.fetchMediaList as any;
			mock.mockReset();
			mock
				.mockResolvedValueOnce({
					items: [
						{
							id: "p1",
							filename: "page1.jpg",
							mimeType: "image/jpeg",
							url: "/media/page1.jpg",
							size: 1024,
							width: 800,
							height: 600,
							createdAt: "2024-01-01",
						},
					],
					nextCursor: "cursor-2",
				})
				.mockResolvedValueOnce({
					items: [
						{
							id: "p2",
							filename: "page2.jpg",
							mimeType: "image/jpeg",
							url: "/media/page2.jpg",
							size: 1024,
							width: 800,
							height: 600,
							createdAt: "2024-01-02",
						},
					],
				});

			const screen = await renderModal();
			await expect.element(screen.getByRole("option", { name: "page1.jpg" })).toBeInTheDocument();

			const loadMoreBtn = [...document.querySelectorAll("button")].find(
				(b) => b.textContent?.trim() === "Load More",
			)!;
			loadMoreBtn.click();

			await expect.element(screen.getByRole("option", { name: "page2.jpg" })).toBeInTheDocument();

			expect(mock).toHaveBeenCalledTimes(2);
			expect(mock.mock.calls[1][0]).toEqual(
				expect.objectContaining({ cursor: "cursor-2", limit: 100 }),
			);
		});
	});
});
