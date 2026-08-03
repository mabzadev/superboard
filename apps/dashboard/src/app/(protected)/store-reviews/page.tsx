"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Send, ShieldCheck, Star } from "lucide-react";
import AppHeader from "@/components/layout/app-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useProjectSelection } from "@/context/useProjectSelection";
import { showErrorNotification, showSuccessNotification } from "@/lib/Notifications";
import {
  approveStoreReviewDraft,
  createStoreReviewDraft,
  getStoreReviews,
  publishStoreReviewDraft,
  syncStoreReviews,
  type StoreReview,
} from "@/api/reputation/reputationService";

const reviewDate = (value: unknown) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)))
  : "—";

export default function StoreReviewsPage() {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [reviews, setReviews] = useState<StoreReview[]>([]);
  const [syncState, setSyncState] = useState<Array<Record<string, unknown>>>([]);
  const [unanswered, setUnanswered] = useState(true);
  const [selected, setSelected] = useState<StoreReview>();
  const [draftBody, setDraftBody] = useState("");
  const [draftId, setDraftId] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const result = await getStoreReviews(projectId, unanswered);
      setReviews(result.data || []);
      setSyncState(result.sync || []);
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to load reviews");
    } finally { setLoading(false); }
  }, [projectId, unanswered]);

  useEffect(() => { void load(); }, [load]);

  const synchronize = async () => {
    if (!projectId) return;
    try {
      await syncStoreReviews(projectId);
      showSuccessNotification("Apple and Google synchronization queued");
    } catch (error) { showErrorNotification(error instanceof Error ? error.message : "Unable to synchronize reviews"); }
  };

  const createDraft = async () => {
    if (!projectId || !selected || !draftBody.trim()) return;
    try {
      const result = await createStoreReviewDraft(projectId, selected.id, draftBody.trim());
      setDraftId(result.id); setDraftStatus("draft");
      showSuccessNotification("Draft saved");
    } catch (error) { showErrorNotification(error instanceof Error ? error.message : "Unable to save the draft"); }
  };

  const approve = async () => {
    if (!projectId || !selected || !draftId) return;
    try {
      await approveStoreReviewDraft(projectId, selected.id, draftId);
      setDraftStatus("approved"); showSuccessNotification("Response approved");
    } catch (error) { showErrorNotification(error instanceof Error ? error.message : "Unable to approve the response"); }
  };

  const publish = async () => {
    if (!projectId || !selected || !draftId) return;
    try {
      await publishStoreReviewDraft(projectId, selected.id, draftId);
      setDraftStatus("queued"); showSuccessNotification("Publication queued");
    } catch (error) { showErrorNotification(error instanceof Error ? error.message : "Unable to publish the response"); }
  };

  return <div className="flex h-dvh flex-col overflow-hidden">
    <AppHeader titleOverride="Store Reviews" />
    <main className="flex-1 space-y-5 overflow-auto p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">App Store and Google Play reviews</h1><p className="text-sm text-muted-foreground">Review history, controlled responses, and unanswered reviews in one module.</p></div><div className="flex gap-2"><Button onClick={() => void synchronize()}><RefreshCw className="mr-2 h-4 w-4" />Synchronize</Button><Button variant="outline" disabled={loading} onClick={() => void load()}>Refresh</Button></div></div>
      <Alert><ShieldCheck /><AlertTitle>Controlled publication</AlertTitle><AlertDescription>A draft must be explicitly approved before it is published to Apple or Google.</AlertDescription></Alert>
      <div className="flex items-center gap-2"><Checkbox checked={unanswered} onCheckedChange={(checked) => setUnanswered(checked === true)} /><span className="text-sm">Show only unanswered reviews</span>{syncState.map((state) => <Badge key={String(state.provider)} variant={state.last_error ? "destructive" : "outline"}>{String(state.provider)} · {state.last_error ? "error" : reviewDate(state.last_synced_at)}</Badge>)}</div>
      <div className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <Card><CardHeader><CardTitle>{reviews.length} reviews</CardTitle></CardHeader><CardContent className="space-y-3">{reviews.map((review) => <button key={review.id} className="w-full rounded-md border p-4 text-left hover:bg-muted" onClick={() => { setSelected(review); setDraftBody(review.response_body || ""); setDraftId(""); setDraftStatus(""); }}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge>{review.provider}</Badge><span className="font-medium">{review.title || review.author_name || "Customer review"}</span></div><div className="flex items-center gap-1 text-amber-500"><Star className="h-4 w-4 fill-current" />{review.rating}/5</div></div><p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{review.body || "No comment"}</p><div className="mt-2 text-xs text-muted-foreground">{review.territory || review.language || "—"} · {review.app_version || "unknown version"} · {reviewDate(review.provider_created_at)}</div></button>)}{!reviews.length && <p className="py-10 text-center text-sm text-muted-foreground">No reviews are available. Start synchronization after verifying store access.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Reply</CardTitle></CardHeader><CardContent className="space-y-3">{selected ? <><div className="rounded-md border p-3"><div className="font-medium">{selected.title || selected.author_name || selected.provider_review_id}</div><p className="mt-2 text-sm text-muted-foreground">{selected.body}</p></div><textarea className="min-h-40 w-full rounded-md border bg-background px-3 py-2 text-sm" maxLength={3500} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} placeholder="Write a factual and personalized response…" /><div className="text-right text-xs text-muted-foreground">{draftBody.length}/3500</div>{!draftId && <Button className="w-full" onClick={() => void createDraft()}>Save draft</Button>}{draftStatus === "draft" && <Button className="w-full" onClick={() => void approve()}><ShieldCheck className="mr-2 h-4 w-4" />Approve</Button>}{draftStatus === "approved" && <Button className="w-full" onClick={() => void publish()}><Send className="mr-2 h-4 w-4" />Publish to {selected.provider === "apple" ? "the App Store" : "Google Play"}</Button>}{draftStatus && <Badge variant="outline">{draftStatus}</Badge>}</> : <p className="text-sm text-muted-foreground">Select a review to prepare a response.</p>}</CardContent></Card>
      </div>
    </main>
  </div>;
}
