"use client";

import { useCallback, useEffect, useState } from "react";
import { Languages, RefreshCw, Send, ShieldCheck, Star } from "lucide-react";
import AppHeader from "@/components/layout/app-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import {
  approveStoreReviewDraft,
  createStoreReviewDraft,
  getStoreReviewHistory,
  getStoreReviews,
  publishStoreReviewDraft,
  syncStoreReviews,
  updateStoreReviewDraft,
  updateStoreReviewTranslation,
  type StoreReview,
  type StoreReviewHistory,
} from "@/api/reputation/reputationService";

const reviewDate = (value: unknown) =>
  value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(value)))
    : "—";

const selectClass =
  "h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function StoreReviewsPage() {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [reviews, setReviews] = useState<StoreReview[]>([]);
  const [syncState, setSyncState] = useState<Array<Record<string, unknown>>>(
    []
  );
  const [unanswered, setUnanswered] = useState(true);
  const [provider, setProvider] = useState<"" | "apple" | "google">("");
  const [sentiment, setSentiment] = useState<
    "" | "positive" | "mixed" | "negative"
  >("");
  const [rating, setRating] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<StoreReview>();
  const [history, setHistory] = useState<StoreReviewHistory>();
  const [draftBody, setDraftBody] = useState("");
  const [draftId, setDraftId] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [translationBody, setTranslationBody] = useState("");
  const [translationLanguage, setTranslationLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const responseLimit = selected?.response_character_limit || 3500;

  const applyReview = useCallback((review: StoreReview) => {
    setSelected(review);
    setDraftBody(review.latest_draft_body || review.response_body || "");
    setDraftId(review.latest_draft_id || "");
    setDraftStatus(review.latest_draft_status || "");
    setTranslationBody(review.translated_body || "");
    setTranslationLanguage(review.translation_language || "en");
  }, []);

  const loadHistory = useCallback(
    async (reviewId: string) => {
      if (!projectId) return;
      setDetailLoading(true);
      try {
        const result = await getStoreReviewHistory(projectId, reviewId);
        setHistory(result);
        applyReview(result.review);
      } catch (error) {
        showErrorNotification(
          error instanceof Error
            ? error.message
            : "Unable to load review history"
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [applyReview, projectId]
  );

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const result = await getStoreReviews(projectId, {
        unanswered,
        provider,
        sentiment,
        rating: rating || undefined,
        search: appliedSearch,
      });
      setReviews(result.data || []);
      setSyncState(result.sync || []);
      setNextCursor(result.next_cursor || null);
      const requestedId = new URLSearchParams(window.location.search).get(
        "review"
      );
      if (requestedId) {
        const requested = (result.data || []).find(
          (review) => review.id === requestedId
        );
        if (requested) applyReview(requested);
        await loadHistory(requestedId);
      }
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to load reviews"
      );
    } finally {
      setLoading(false);
    }
  }, [
    appliedSearch,
    applyReview,
    loadHistory,
    projectId,
    provider,
    rating,
    sentiment,
    unanswered,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!projectId || !nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await getStoreReviews(projectId, {
        unanswered,
        provider,
        sentiment,
        rating: rating || undefined,
        search: appliedSearch,
        cursor: nextCursor,
      });
      setReviews((current) => {
        const known = new Set(current.map((review) => review.id));
        return [
          ...current,
          ...(result.data || []).filter((review) => !known.has(review.id)),
        ];
      });
      setNextCursor(result.next_cursor || null);
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to load more reviews"
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const selectReview = async (review: StoreReview) => {
    applyReview(review);
    setHistory(undefined);
    await loadHistory(review.id);
  };

  const synchronize = async () => {
    if (!projectId) return;
    try {
      await syncStoreReviews(projectId);
      showSuccessNotification(
        "App Store and Google Play synchronization queued"
      );
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to synchronize reviews"
      );
    }
  };

  const refreshSelected = async () => {
    if (!selected) return;
    await loadHistory(selected.id);
  };

  const createDraft = async () => {
    if (!projectId || !selected || !draftBody.trim()) return;
    try {
      const result = await createStoreReviewDraft(
        projectId,
        selected.id,
        draftBody.trim()
      );
      setDraftId(result.id);
      setDraftStatus("draft");
      showSuccessNotification("Draft saved");
      await loadHistory(selected.id);
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to save the draft"
      );
    }
  };

  const approve = async () => {
    if (!projectId || !selected || !draftId) return;
    try {
      await approveStoreReviewDraft(projectId, selected.id, draftId);
      setDraftStatus("approved");
      showSuccessNotification("Response approved");
      await loadHistory(selected.id);
    } catch (error) {
      showErrorNotification(
        error instanceof Error
          ? error.message
          : "Unable to approve the response"
      );
    }
  };

  const updateDraft = async () => {
    if (!projectId || !selected || !draftId || !draftBody.trim()) return;
    try {
      await updateStoreReviewDraft(
        projectId,
        selected.id,
        draftId,
        draftBody.trim()
      );
      setDraftStatus("draft");
      showSuccessNotification("Draft changes saved");
      await loadHistory(selected.id);
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to update the draft"
      );
    }
  };

  const publish = async () => {
    if (!projectId || !selected || !draftId) return;
    try {
      await publishStoreReviewDraft(projectId, selected.id, draftId);
      setDraftStatus("queued");
      showSuccessNotification("Publication queued");
      await loadHistory(selected.id);
    } catch (error) {
      showErrorNotification(
        error instanceof Error
          ? error.message
          : "Unable to publish the response"
      );
    }
  };

  const saveTranslation = async () => {
    if (
      !projectId ||
      !selected ||
      !translationBody.trim() ||
      !translationLanguage.trim()
    )
      return;
    try {
      const result = await updateStoreReviewTranslation(
        projectId,
        selected.id,
        translationBody.trim(),
        translationLanguage.trim()
      );
      setTranslationBody(result.translated_body);
      setTranslationLanguage(result.translation_language);
      showSuccessNotification("Operator translation saved");
      await loadHistory(selected.id);
    } catch (error) {
      showErrorNotification(
        error instanceof Error
          ? error.message
          : "Unable to save the translation"
      );
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader titleOverride="Store Reviews" />
      <main className="flex-1 space-y-5 overflow-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              App Store and Google Play reviews
            </h1>
            <p className="text-sm text-muted-foreground">
              Searchable review history, controlled responses, and unanswered
              reviews in one module.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void synchronize()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Synchronize
            </Button>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </div>
        </div>

        <Alert>
          <ShieldCheck />
          <AlertTitle>Controlled publication</AlertTitle>
          <AlertDescription>
            A draft must be explicitly approved before it is published to Apple
            or Google.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={unanswered}
            onCheckedChange={(checked) => setUnanswered(checked === true)}
          />
          <span className="mr-2 text-sm">Only unanswered</span>
          <select
            className={selectClass}
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as typeof provider)
            }
            aria-label="Provider"
          >
            <option value="">All stores</option>
            <option value="apple">App Store</option>
            <option value="google">Google Play</option>
          </select>
          <select
            className={selectClass}
            value={sentiment}
            onChange={(event) =>
              setSentiment(event.target.value as typeof sentiment)
            }
            aria-label="Sentiment"
          >
            <option value="">All sentiment</option>
            <option value="negative">Negative</option>
            <option value="mixed">Mixed</option>
            <option value="positive">Positive</option>
          </select>
          <select
            className={selectClass}
            value={rating}
            onChange={(event) => setRating(Number(event.target.value))}
            aria-label="Rating"
          >
            <option value={0}>All ratings</option>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value} star{value === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedSearch(search.trim());
            }}
          >
            <input
              className={`${selectClass} w-56`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={100}
              placeholder="Search reviews"
              aria-label="Search reviews"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </div>

        <div className="flex flex-wrap gap-2">
          {syncState.map((state) => (
            <Badge
              key={String(state.provider)}
              variant={state.last_error ? "destructive" : "outline"}
              title={state.last_error ? String(state.last_error) : undefined}
            >
              {String(state.provider)} ·{" "}
              {state.last_error ? "error" : reviewDate(state.last_synced_at)}
            </Badge>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_460px]">
          <Card>
            <CardHeader>
              <CardTitle>{reviews.length} loaded reviews</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviews.map((review) => (
                <button
                  key={review.id}
                  className={`w-full rounded-md border p-4 text-left hover:bg-muted ${selected?.id === review.id ? "border-primary" : ""}`}
                  onClick={() => void selectReview(review)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge>{review.provider}</Badge>
                      <span className="font-medium">
                        {review.title ||
                          review.author_name ||
                          "Customer review"}
                      </span>
                      {review.sentiment && (
                        <Badge variant="outline">{review.sentiment}</Badge>
                      )}
                      {review.category && (
                        <Badge variant="outline">{review.category}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-amber-500">
                      <Star className="h-4 w-4 fill-current" />
                      {review.rating}/5
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                    {review.translated_body ||
                      review.body ||
                      "No written comment"}
                  </p>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {review.territory || review.language || "Unknown locale"} ·{" "}
                    {review.app_version || "Unknown version"} ·{" "}
                    {reviewDate(review.provider_created_at)} ·{" "}
                    {review.revision_count || 0} revision
                    {review.revision_count === 1 ? "" : "s"}
                  </div>
                </button>
              ))}
              {!reviews.length && !loading && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No reviews match the current filters.
                </p>
              )}
              {nextCursor && (
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading…" : "Load more reviews"}
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Reply</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selected ? (
                  <>
                    <div className="rounded-md border p-3">
                      <div className="font-medium">
                        {selected.title ||
                          selected.author_name ||
                          selected.provider_review_id}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {selected.translated_body ||
                          selected.body ||
                          "No written comment"}
                      </p>
                      {selected.translated_body &&
                        selected.body &&
                        selected.translated_body !== selected.body && (
                          <details className="mt-2 text-xs text-muted-foreground">
                            <summary>Show original review</summary>
                            <p className="mt-1 whitespace-pre-wrap">
                              {selected.original_body || selected.body}
                            </p>
                          </details>
                        )}
                    </div>
                    <textarea
                      className="min-h-40 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      maxLength={responseLimit}
                      value={draftBody}
                      onChange={(event) => setDraftBody(event.target.value)}
                      placeholder="Write a factual and personalized response…"
                      disabled={
                        Boolean(draftId) &&
                        !["draft", "failed"].includes(draftStatus)
                      }
                    />
                    <div className="text-right text-xs text-muted-foreground">
                      {draftBody.length}/{responseLimit}
                    </div>
                    {!draftId && (
                      <Button
                        className="w-full"
                        onClick={() => void createDraft()}
                      >
                        Save draft
                      </Button>
                    )}
                    {draftStatus === "draft" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          onClick={() => void updateDraft()}
                        >
                          Save changes
                        </Button>
                        <Button onClick={() => void approve()}>
                          <ShieldCheck className="mr-2 h-4 w-4" />
                          Approve
                        </Button>
                      </div>
                    )}
                    {draftStatus === "approved" && (
                      <Button className="w-full" onClick={() => void publish()}>
                        <Send className="mr-2 h-4 w-4" />
                        Publish to{" "}
                        {selected.provider === "apple"
                          ? "the App Store"
                          : "Google Play"}
                      </Button>
                    )}
                    {draftStatus === "failed" && (
                      <div className="grid gap-2">
                        <Button
                          className="w-full"
                          onClick={() => void updateDraft()}
                        >
                          Save correction
                        </Button>
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={() => void publish()}
                        >
                          <Send className="mr-2 h-4 w-4" />
                          Retry unchanged response
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      {draftStatus ? (
                        <Badge variant="outline">{draftStatus}</Badge>
                      ) : (
                        <span />
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={detailLoading}
                        onClick={() => void refreshSelected()}
                      >
                        Refresh status
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select a review to prepare a response.
                  </p>
                )}
              </CardContent>
            </Card>

            {selected && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Languages className="h-4 w-4" />
                    Operator translation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Google may supply an English translation. For other reviews,
                    an operator can record a verified translation without
                    changing the original text.
                  </p>
                  <input
                    className={`${selectClass} w-full`}
                    value={translationLanguage}
                    onChange={(event) =>
                      setTranslationLanguage(event.target.value)
                    }
                    maxLength={35}
                    placeholder="Language tag, for example en"
                    aria-label="Translation language"
                  />
                  <textarea
                    className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    maxLength={10000}
                    value={translationBody}
                    onChange={(event) => setTranslationBody(event.target.value)}
                    placeholder="Verified translated review text"
                  />
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => void saveTranslation()}
                  >
                    Save translation
                  </Button>
                </CardContent>
              </Card>
            )}

            {selected && history && (
              <Card>
                <CardHeader>
                  <CardTitle>History and audit</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <details open>
                    <summary className="cursor-pointer font-medium">
                      Review revisions ({history.revisions.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {history.revisions.map((revision) => (
                        <div
                          key={revision.id}
                          className="rounded-md border p-2"
                        >
                          <div className="flex justify-between">
                            <span>{revision.rating}/5</span>
                            <span className="text-xs text-muted-foreground">
                              {reviewDate(revision.captured_at)}
                            </span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                            {revision.body || "No written comment"}
                          </p>
                        </div>
                      ))}
                      {!history.revisions.length && (
                        <p className="text-xs text-muted-foreground">
                          No revisions captured.
                        </p>
                      )}
                    </div>
                  </details>
                  <details>
                    <summary className="cursor-pointer font-medium">
                      Response attempts ({history.drafts.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {history.drafts.map((draft) => (
                        <div key={draft.id} className="rounded-md border p-2">
                          <div className="flex justify-between">
                            <Badge variant="outline">{draft.status}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {reviewDate(draft.updated_at)}
                            </span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                            {draft.body}
                          </p>
                          {draft.last_error && (
                            <p className="mt-1 text-xs text-destructive">
                              {draft.last_error}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                  <details>
                    <summary className="cursor-pointer font-medium">
                      Audit events ({history.audit.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {history.audit.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-center justify-between rounded-md border p-2"
                        >
                          <span>{event.event_type.replaceAll(".", " ")}</span>
                          <span className="text-xs text-muted-foreground">
                            {event.actor_type} · {reviewDate(event.occurred_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
