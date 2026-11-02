import { Toast } from "@cloudflare/kumo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { BylineSummary } from "../../../../packages/admin/src/lib/api/bylines";
import type { MediaItem } from "../../../../packages/admin/src/lib/api/media";
import { render } from "./utils/render.tsx";

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		useSearch: () => ({ locale: undefined }),
		useNavigate: () => vi.fn(),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/bylines", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/bylines")
	>("../../../../packages/admin/src/lib/api/bylines");
	return {
		...actual,
		fetchBylines: vi.fn(),
		fetchByline: vi.fn(),
		fetchBylineTranslations: vi.fn().mockResolvedValue({ items: [] }),
		createByline: vi.fn(),
		updateByline: vi.fn(),
		deleteByline: vi.fn(),
		createBylineTranslation: vi.fn(),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/users", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/users")
	>("../../../../packages/admin/src/lib/api/users");
	return {
		...actual,
		fetchUsers: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/byline-fields", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/byline-fields")
	>("../../../../packages/admin/src/lib/api/byline-fields");
	return {
		...actual,
		listBylineFields: vi.fn().mockResolvedValue({ items: [] }),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/media", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/media")
	>("../../../../packages/admin/src/lib/api/media");
	return {
		...actual,
		fetchMediaItem: vi.fn(),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/client", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/client")
	>("../../../../packages/admin/src/lib/api/client");
	return {
		...actual,
		fetchManifest: vi.fn().mockResolvedValue({
			version: "0.0.0",
			hash: "test",
			collections: {},
			plugins: {},
			authMode: "passkey",
			taxonomies: [],
		}),
	};
});

const { fetchBylines, fetchByline, updateByline } =
	await import("../../../../packages/admin/src/lib/api/bylines");
const { fetchMediaItem } = await import("../../../../packages/admin/src/lib/api/media");
const { BylinesPage } = await import("../../../../packages/admin/src/routes/bylines");

function makeByline(overrides: Partial<BylineSummary> = {}): BylineSummary {
	return {
		id: "byline_01",
		slug: "jane-doe",
		displayName: "Jane Doe",
		bio: null,
		avatarMediaId: null,
		websiteUrl: null,
		userId: null,
		isGuest: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		locale: "en",
		translationGroup: null,
		customFields: {},
		...overrides,
	};
}

function makeMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
	return {
		id: "media_avatar_01",
		filename: "avatar.jpg",
		mimeType: "image/jpeg",
		url: "/_emdash/api/media/file/media_avatar_01.jpg",
		storageKey: "media_avatar_01.jpg",
		size: 1024,
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

function TestWrapper({ children }: { children: React.ReactNode }) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return (
		<QueryClientProvider client={queryClient}>
			<Toast.Provider>{children}</Toast.Provider>
		</QueryClientProvider>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("BylinesPage — avatar field (#1250)", () => {
	it("renders the avatar picker in create mode", async () => {
		vi.mocked(fetchBylines).mockResolvedValue({ items: [], nextCursor: undefined });

		const screen = await render(
			<TestWrapper>
				<BylinesPage />
			</TestWrapper>,
		);

		await expect.element(screen.getByText("Create byline")).toBeInTheDocument();
		await expect.element(screen.getByText("Avatar")).toBeInTheDocument();
		expect(vi.mocked(fetchMediaItem)).not.toHaveBeenCalled();
	});

	it("resolves the stored avatar media for preview when editing", async () => {
		const byline = makeByline({ avatarMediaId: "media_avatar_01" });
		vi.mocked(fetchBylines).mockResolvedValue({ items: [byline], nextCursor: undefined });
		vi.mocked(fetchByline).mockResolvedValue(byline);
		vi.mocked(fetchMediaItem).mockResolvedValue(makeMediaItem());

		const screen = await render(
			<TestWrapper>
				<BylinesPage />
			</TestWrapper>,
		);

		await screen.getByRole("button", { name: /Jane Doe/ }).click();

		await expect.element(screen.getByText("Avatar")).toBeInTheDocument();
		await vi.waitFor(() =>
			expect(vi.mocked(fetchMediaItem)).toHaveBeenCalledWith("media_avatar_01"),
		);
	});

	it("forwards avatarMediaId in the PATCH body on save", async () => {
		const byline = makeByline({ avatarMediaId: "media_avatar_01" });
		vi.mocked(fetchBylines).mockResolvedValue({ items: [byline], nextCursor: undefined });
		vi.mocked(fetchByline).mockResolvedValue(byline);
		vi.mocked(fetchMediaItem).mockResolvedValue(makeMediaItem());
		vi.mocked(updateByline).mockResolvedValue(byline);

		const screen = await render(
			<TestWrapper>
				<BylinesPage />
			</TestWrapper>,
		);

		await screen.getByRole("button", { name: /Jane Doe/ }).click();
		await screen.getByRole("button", { name: "Save" }).click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(vi.mocked(updateByline)).toHaveBeenCalledTimes(1);
		const [bylineId, body] = vi.mocked(updateByline).mock.calls[0]!;
		expect(bylineId).toBe(byline.id);
		expect(body.avatarMediaId).toBe("media_avatar_01");
	});
});
