import { GET, PATCH, POST } from "@/lib/api";
import { config } from "@/lib/config";

export type StoreReview = {
  id: string;
  provider: "apple" | "google";
  provider_review_id: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  original_body?: string | null;
  translated_body?: string | null;
  translation_language?: string | null;
  translation_source?: "provider" | "operator" | null;
  author_name?: string | null;
  language?: string | null;
  territory?: string | null;
  app_version?: string | null;
  provider_created_at?: string | null;
  response_body?: string | null;
  response_state?: string | null;
  latest_draft_id?: string | null;
  latest_draft_body?: string | null;
  latest_draft_status?: string | null;
  revision_count?: number;
  sentiment?: string | null;
  category?: string | null;
  response_character_limit?: number;
};

export type StoreReviewRevision = {
  id: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  provider_updated_at?: string | null;
  captured_at: string;
};

export type StoreReviewDraft = {
  id: string;
  body: string;
  status: string;
  attempts: number;
  approved_at?: string | null;
  published_at?: string | null;
  publish_requested_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

export type StoreReviewAuditEvent = {
  id: string;
  event_type: string;
  actor_type: string;
  actor_id?: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type StoreReviewHistory = {
  review: StoreReview;
  revisions: StoreReviewRevision[];
  drafts: StoreReviewDraft[];
  audit: StoreReviewAuditEvent[];
};

export type StoreReviewFilters = {
  unanswered?: boolean;
  provider?: "" | "apple" | "google";
  sentiment?: "" | "positive" | "mixed" | "negative";
  category?: string;
  rating?: number;
  search?: string;
  cursor?: string | null;
  limit?: number;
};

const reputationPath = (projectId: string, resource = "") => {
  const apiV2 = config.apiPath.replace(/\/v1\/?$/, "/v2");
  return `${apiV2}/reputation/projects/${projectId}${resource}`;
};

export const getStoreReviews = async (
  projectId: string,
  filters: StoreReviewFilters = {}
): Promise<{
  data: StoreReview[];
  sync: Array<Record<string, unknown>>;
  next_cursor?: string | null;
}> => {
  const query = new URLSearchParams();
  query.set("unanswered", String(filters.unanswered === true));
  query.set("limit", String(filters.limit || 50));
  if (filters.provider) query.set("provider", filters.provider);
  if (filters.sentiment) query.set("sentiment", filters.sentiment);
  if (filters.category) query.set("category", filters.category);
  if (filters.rating) query.set("rating", String(filters.rating));
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  if (filters.cursor) query.set("cursor", filters.cursor);
  return (await GET(reputationPath(projectId, `/reviews?${query.toString()}`)))
    .data;
};

export const getStoreReviewHistory = async (
  projectId: string,
  reviewId: string
): Promise<StoreReviewHistory> =>
  (
    await GET(
      reputationPath(
        projectId,
        `/reviews/${encodeURIComponent(reviewId)}/history`
      )
    )
  ).data;

export const updateStoreReviewTranslation = async (
  projectId: string,
  reviewId: string,
  translatedBody: string,
  translationLanguage: string
) =>
  (
    await PATCH(
      reputationPath(
        projectId,
        `/reviews/${encodeURIComponent(reviewId)}/translation`
      ),
      {
        translated_body: translatedBody,
        translation_language: translationLanguage,
      }
    )
  ).data;

export const syncStoreReviews = async (projectId: string) =>
  (await POST(reputationPath(projectId, "/sync"), {})).data;

export const createStoreReviewDraft = async (
  projectId: string,
  reviewId: string,
  body: string
) =>
  (
    await POST(
      reputationPath(
        projectId,
        `/reviews/${encodeURIComponent(reviewId)}/drafts`
      ),
      { body }
    )
  ).data;

export const updateStoreReviewDraft = async (
  projectId: string,
  reviewId: string,
  draftId: string,
  body: string
) =>
  (
    await PATCH(
      reputationPath(
        projectId,
        `/reviews/${encodeURIComponent(reviewId)}/drafts/${encodeURIComponent(draftId)}`
      ),
      { body }
    )
  ).data;

export const approveStoreReviewDraft = async (
  projectId: string,
  reviewId: string,
  draftId: string
) =>
  (
    await POST(
      reputationPath(
        projectId,
        `/reviews/${encodeURIComponent(reviewId)}/drafts/${encodeURIComponent(draftId)}/approve`
      ),
      {}
    )
  ).data;

export const publishStoreReviewDraft = async (
  projectId: string,
  reviewId: string,
  draftId: string
) =>
  (
    await POST(
      reputationPath(
        projectId,
        `/reviews/${encodeURIComponent(reviewId)}/drafts/${encodeURIComponent(draftId)}/publish`
      ),
      {}
    )
  ).data;
