import { GET, POST } from "@/lib/api";
import { config } from "@/lib/config";

export type StoreReview = {
  id: string;
  provider: "apple" | "google";
  provider_review_id: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  author_name?: string | null;
  language?: string | null;
  territory?: string | null;
  app_version?: string | null;
  provider_created_at?: string | null;
  response_body?: string | null;
  response_state?: string | null;
  latest_draft_status?: string | null;
  revision_count?: number;
};

const reputationPath = (projectId: string, resource = "") => {
  const apiV2 = config.apiPath.replace(/\/v1\/?$/, "/v2");
  return `${apiV2}/reputation/projects/${projectId}${resource}`;
};

export const getStoreReviews = async (projectId: string, unanswered = false): Promise<{ data: StoreReview[]; sync: Array<Record<string, unknown>> }> =>
  (await GET(reputationPath(projectId, `/reviews?unanswered=${unanswered}`))).data;

export const syncStoreReviews = async (projectId: string) =>
  (await POST(reputationPath(projectId, "/sync"), {})).data;

export const createStoreReviewDraft = async (projectId: string, reviewId: string, body: string) =>
  (await POST(reputationPath(projectId, `/reviews/${reviewId}/drafts`), { body })).data;

export const approveStoreReviewDraft = async (projectId: string, reviewId: string, draftId: string) =>
  (await POST(reputationPath(projectId, `/reviews/${reviewId}/drafts/${draftId}/approve`), {})).data;

export const publishStoreReviewDraft = async (projectId: string, reviewId: string, draftId: string) =>
  (await POST(reputationPath(projectId, `/reviews/${reviewId}/drafts/${draftId}/publish`), {})).data;
