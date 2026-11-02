import { Toasty } from "@cloudflare/kumo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { userEvent } from "@vitest/browser/context";
import * as React from "react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

import { RevisionHistory } from "../../../../../packages/admin/src/components/RevisionHistory";
import type { Revision, RevisionListResponse } from "../../../../../packages/admin/src/lib/api";
import { render } from "../utils/render.tsx";

vi.mock("../../../../../packages/admin/src/lib/api", async () => {
	const actual = await vi.importActual("../../../../../packages/admin/src/lib/api");
	return {
		...actual,
		fetchRevisions: vi.fn(),
		restoreRevision: vi.fn(),
	};
});

import { fetchRevisions, restoreRevision } from "../../../../../packages/admin/src/lib/api";

const mockFetchRevisions = fetchRevisions as Mock;
const mockRestoreRevision = restoreRevision as Mock;

const REVISIONS_BUTTON_REGEX = /Revisions/i;
const RESTORE_BUTTON_REGEX = /Restore this version/i;
const TIME_REGEX_5_MINS = /5 mins ago/;
const TIME_REGEX_3_HOURS = /3 hours ago/;

function QueryWrapper({ children }: { children: React.ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return (
		<Toasty>
			<QueryClientProvider client={qc}>{children}</QueryClientProvider>
		</Toasty>
	);
}

function makeRevision(overrides: Partial<Revision> = {}): Revision {
	return {
		id: "rev-1",
		collection: "posts",
		entryId: "entry-1",
		data: { title: "Hello World", body: "Content here" },
		authorId: "user-1",
		createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
		...overrides,
	};
}

function makeRevisionList(revisions: Revision[]): RevisionListResponse {
	return { items: revisions, total: revisions.length };
}

beforeEach(() => {
	vi.resetAllMocks();
});

describe("RevisionHistory", () => {
	it("starts collapsed with only header visible", async () => {
		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await expect.element(screen.getByText("Revisions")).toBeInTheDocument();
		const noRevisionsText = screen.getByText("No revisions yet");
		await expect.element(noRevisionsText).not.toBeInTheDocument();
	});

	it("reserves a separate trailing area for an external header control", async () => {
		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" reserveHeaderEnd />
			</QueryWrapper>,
		);

		const trigger = screen.getByRole("button", { name: REVISIONS_BUTTON_REGEX }).element();
		expect(trigger.style.width).toBe("calc(100% - 1.5rem)");
	});

	it("does not fetch revisions until expanded", async () => {
		await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		expect(mockFetchRevisions).not.toHaveBeenCalled();
	});

	it("fetches revisions when header is clicked to expand", async () => {
		mockFetchRevisions.mockResolvedValue(makeRevisionList([]));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		const header = screen.getByText("Revisions");
		await header.click();

		expect(mockFetchRevisions).toHaveBeenCalledWith("posts", "entry-1", { limit: 20 });
	});

	it("shows loading state when expanded and fetching", async () => {
		mockFetchRevisions.mockReturnValue(new Promise(() => {}));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByRole("button", { name: REVISIONS_BUTTON_REGEX }).click();

		const emptyText = screen.getByText("No revisions yet");
		await expect.element(emptyText).not.toBeInTheDocument();
		const errorText = screen.getByText("Failed to load revisions");
		await expect.element(errorText).not.toBeInTheDocument();
	});

	it("shows revision list with relative times", async () => {
		const revisions = [
			makeRevision({
				id: "rev-1",
				createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
			}),
			makeRevision({
				id: "rev-2",
				createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
			}),
		];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();

		await expect.element(screen.getByText(TIME_REGEX_5_MINS)).toBeInTheDocument();
		await expect.element(screen.getByText(TIME_REGEX_3_HOURS)).toBeInTheDocument();
	});

	it("shows 'Current' badge on the first (latest) revision", async () => {
		const revisions = [
			makeRevision({ id: "rev-1" }),
			makeRevision({
				id: "rev-2",
				createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			}),
		];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();

		await expect.element(screen.getByText("Current")).toBeInTheDocument();
	});

	it("does not show restore button on the latest revision", async () => {
		const revisions = [makeRevision({ id: "rev-1" })];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();

		await expect.element(screen.getByText("Current")).toBeInTheDocument();

		const restoreButton = screen.getByRole("button", { name: RESTORE_BUTTON_REGEX });
		await expect.element(restoreButton).not.toBeInTheDocument();
	});

	it("shows restore button on non-latest revisions", async () => {
		const revisions = [
			makeRevision({ id: "rev-1" }),
			makeRevision({
				id: "rev-2",
				createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			}),
		];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();

		await expect.element(screen.getByText("Current")).toBeInTheDocument();

		const restoreButton = screen.getByRole("button", { name: RESTORE_BUTTON_REGEX });
		await expect.element(restoreButton).toBeInTheDocument();
	});

	it("toggles content snapshot when clicking a revision", async () => {
		const revisions = [makeRevision({ id: "rev-1", data: { title: "Latest content" } })];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();
		await expect.element(screen.getByText("Current")).toBeInTheDocument();

		const snapshotLabel = screen.getByText("Content snapshot:");
		await expect.element(snapshotLabel).not.toBeInTheDocument();

		const revisionButton = screen.getByText("Current").element().closest("button")!;
		await userEvent.click(revisionButton);

		await expect.element(screen.getByText("Content snapshot:")).toBeInTheDocument();

		await userEvent.click(revisionButton);

		await expect.element(screen.getByText("Content snapshot:")).not.toBeInTheDocument();
	});

	it("opens confirm dialog then restoreRevision when confirmed", async () => {
		mockRestoreRevision.mockResolvedValue({});
		const onRestored = vi.fn();

		const revisions = [
			makeRevision({ id: "rev-1" }),
			makeRevision({
				id: "rev-2",
				createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			}),
		];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" onRestored={onRestored} />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();
		await expect.element(screen.getByText("Current")).toBeInTheDocument();

		const restoreButton = screen.getByRole("button", { name: RESTORE_BUTTON_REGEX });
		await restoreButton.click();

		await expect.element(screen.getByText("Restore Revision?")).toBeInTheDocument();

		screen.getByRole("button", { name: "Restore" }).element().click();

		await vi.waitFor(() => {
			expect(mockRestoreRevision).toHaveBeenCalledWith("rev-2");
		});
	});

	it("does not call restoreRevision when confirm dialog is cancelled", async () => {
		const revisions = [
			makeRevision({ id: "rev-1" }),
			makeRevision({
				id: "rev-2",
				createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			}),
		];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();
		await expect.element(screen.getByText("Current")).toBeInTheDocument();

		const restoreButton = screen.getByRole("button", { name: RESTORE_BUTTON_REGEX });
		await restoreButton.click();

		await expect.element(screen.getByText("Restore Revision?")).toBeInTheDocument();

		screen.getByRole("button", { name: "Cancel" }).element().click();

		expect(mockRestoreRevision).not.toHaveBeenCalled();
	});

	it("shows error message when fetching revisions fails", async () => {
		mockFetchRevisions.mockRejectedValue(new Error("Network error"));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();

		await expect.element(screen.getByText("Failed to load revisions")).toBeInTheDocument();
	});

	it("shows empty state when no revisions exist", async () => {
		mockFetchRevisions.mockResolvedValue(makeRevisionList([]));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();

		await expect.element(screen.getByText("No revisions yet")).toBeInTheDocument();
	});

	it("hides revision content when collapsed after expanding", async () => {
		mockFetchRevisions.mockResolvedValue(makeRevisionList([]));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		const headerButton = screen.getByRole("button", { name: REVISIONS_BUTTON_REGEX });

		await headerButton.click();
		await expect.element(screen.getByText("No revisions yet")).toBeInTheDocument();

		await headerButton.click();

		await expect.element(screen.getByText("No revisions yet")).not.toBeInTheDocument();
	});

	it("shows total count in header when revisions exist", async () => {
		const revisions = [
			makeRevision({ id: "rev-1" }),
			makeRevision({
				id: "rev-2",
				createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			}),
			makeRevision({
				id: "rev-3",
				createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
			}),
		];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();

		await expect.element(screen.getByText("(3)")).toBeInTheDocument();
	});

	it("shows visual diff when selecting a non-latest revision", async () => {
		const revisions = [
			makeRevision({
				id: "rev-1",
				data: { title: "Updated Title", body: "Same body", newField: "added" },
				createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
			}),
			makeRevision({
				id: "rev-2",
				data: { title: "Original Title", body: "Same body", removed: "gone" },
				createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			}),
		];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();
		await expect.element(screen.getByText("Current")).toBeInTheDocument();

		const revisionButtons = screen.getByText("1 day ago").element().closest("button")!;
		await userEvent.click(revisionButtons);

		await expect
			.element(screen.getByText("from next revision", { exact: false }))
			.toBeInTheDocument();

		await expect.element(screen.getByText("Original Title")).toBeInTheDocument();
		await expect.element(screen.getByText("Updated Title")).toBeInTheDocument();
	});

	it("shows raw snapshot for latest revision (no diff target)", async () => {
		const revisions = [
			makeRevision({
				id: "rev-1",
				data: { title: "Latest" },
				createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
			}),
			makeRevision({
				id: "rev-2",
				data: { title: "Older" },
				createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			}),
		];
		mockFetchRevisions.mockResolvedValue(makeRevisionList(revisions));

		const screen = await render(
			<QueryWrapper>
				<RevisionHistory collection="posts" entryId="entry-1" />
			</QueryWrapper>,
		);

		await screen.getByText("Revisions").click();

		const latestButton = screen.getByText("Current").element().closest("button")!;
		await userEvent.click(latestButton);

		await expect.element(screen.getByText("Content snapshot:")).toBeInTheDocument();
	});
});
