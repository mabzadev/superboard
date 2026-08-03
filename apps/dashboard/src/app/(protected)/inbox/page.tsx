"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleUserRound, ExternalLink, Inbox, MessageSquareText, RefreshCw, RotateCcw, Send, ShieldCheck, Star } from "lucide-react";
import AppHeader from "@/components/layout/app-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useProjectSelection } from "@/context/useProjectSelection";
import { showErrorNotification } from "@/lib/Notifications";
import {
  getInboxMessages,
  getUnifiedInboxItems,
  sendInboxMessage,
  updateInboxConversation,
  type InboxConversation,
  type InboxMessage,
  type UnifiedInboxItem,
} from "@/api/messaging/inboxService";

const dateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "—";

const priorityLabel: Record<UnifiedInboxItem["priority"], string> = {
  low: "Low", normal: "Normal", high: "High", urgent: "Urgent",
};

const sourceLabel: Record<UnifiedInboxItem["source_type"], string> = {
  conversation: "Chat", store_review: "Store review", refund_case: "Refund case",
};

export default function InboxPage() {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [items, setItems] = useState<UnifiedInboxItem[]>([]);
  const [degradedSources, setDegradedSources] = useState<Array<{ source_type: string; code: string; message: string }>>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = useMemo(() => items.find((item) => item.id === selectedId), [items, selectedId]);

  const loadItems = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const result = await getUnifiedInboxItems(projectId, { type: typeFilter, status: statusFilter });
      setItems(result.data || []);
      setDegradedSources(result.degraded_sources || []);
      setSelectedId((current) => result.data?.some((item) => item.id === current) ? current : result.data?.[0]?.id || "");
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to load the Inbox");
    } finally { setLoading(false); }
  }, [projectId, statusFilter, typeFilter]);

  const loadMessages = useCallback(async () => {
    if (!projectId || selected?.source_type !== "conversation") { setMessages([]); return; }
    try {
      const result = await getInboxMessages(projectId, selected.source_id);
      setMessages(result.data || []);
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to load the conversation");
    }
  }, [projectId, selected?.source_id, selected?.source_type]);

  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    const timer = window.setInterval(() => { void loadItems(); void loadMessages(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadItems, loadMessages]);

  const send = async () => {
    if (!projectId || selected?.source_type !== "conversation" || !reply.trim()) return;
    const value = reply.trim();
    setReply("");
    try {
      await sendInboxMessage(projectId, selected.source_id, value);
      await Promise.all([loadMessages(), loadItems()]);
    } catch (error) {
      setReply(value);
      showErrorNotification(error instanceof Error ? error.message : "Unable to send the message");
    }
  };

  const update = async (value: Partial<Pick<InboxConversation, "status" | "priority">>) => {
    if (!projectId || selected?.source_type !== "conversation") return;
    try {
      await updateInboxConversation(projectId, selected.source_id, value);
      await loadItems();
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to update the conversation");
    }
  };

  return <div className="flex h-dvh flex-col overflow-hidden">
    <AppHeader titleOverride="Inbox" />
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Unified Inbox</h1><p className="text-sm text-muted-foreground">Chat conversations, unanswered store reviews, and refund cases in one operational queue.</p></div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filter by source" className="rounded-md border bg-background px-3 text-sm" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All sources</option><option value="conversation">Chat</option><option value="store_review">Store reviews</option><option value="refund_case">Refund cases</option></select>
          <select aria-label="Filter by status" className="rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select>
          <Button variant="outline" disabled={loading} onClick={() => void loadItems()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      </div>
      <Alert><ShieldCheck /><AlertTitle>Projection, not data duplication</AlertTitle><AlertDescription>Each item links to its source domain. Messaging, reputation, refunds, and purchases remain technically isolated.</AlertDescription></Alert>
      {degradedSources.map((source) => <Alert key={`${source.source_type}:${source.code}`} variant="destructive"><AlertTitle>{sourceLabel[source.source_type as UnifiedInboxItem["source_type"]] || "Inbox source"} is unavailable</AlertTitle><AlertDescription>{source.message}. Other Inbox sources continue to work.</AlertDescription></Alert>)}
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border bg-card lg:grid-cols-[380px_1fr]">
        <aside className="min-h-0 overflow-auto border-r">
          {items.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full border-b p-4 text-left transition-colors hover:bg-muted ${selectedId === item.id ? "bg-muted" : ""}`}>
            <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><SourceIcon type={item.source_type} /><span className="truncate font-medium">{item.title}</span></div><Badge variant={item.priority === "urgent" ? "destructive" : "outline"}>{priorityLabel[item.priority]}</Badge></div>
            <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.preview}</div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{sourceLabel[item.source_type]} · {item.status}</span><span>{dateTime(item.updated_at)}</span></div>
          </button>)}
          {!items.length && <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><Inbox className="h-8 w-8" />No Inbox items match these filters.</div>}
        </aside>
        <section className="flex min-h-0 flex-col">
          {selected ? selected.source_type === "conversation" ? <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div className="flex min-w-0 items-center gap-3"><CircleUserRound className="h-8 w-8 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate font-medium">{selected.title}</div><div className="truncate text-xs text-muted-foreground">Customer {selected.customer_reference || "—"}</div></div></div>
              <div className="flex gap-2"><select aria-label="Priority" className="rounded-md border bg-background px-2 text-sm" value={selected.priority} onChange={(event) => void update({ priority: event.target.value as InboxConversation["priority"] })}>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Status" className="rounded-md border bg-background px-2 text-sm" value={selected.status} onChange={(event) => void update({ status: event.target.value as InboxConversation["status"] })}><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select></div>
            </header>
            <div className="flex-1 space-y-3 overflow-auto bg-muted/20 p-5">
              {messages.map((message) => <div key={message.id} className={`flex ${message.sender_kind === "agent" ? "justify-end" : "justify-start"}`}><Card className={`max-w-[78%] px-4 py-3 ${message.sender_kind === "agent" ? "bg-primary text-primary-foreground" : ""}`}><p className="whitespace-pre-wrap text-sm">{message.body || `Attachment: ${message.attachment_name || "file"}`}</p><div className={`mt-1 text-[11px] ${message.sender_kind === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{message.sender_kind === "agent" ? "Team" : "Customer"} · {dateTime(message.created_at)}</div></Card></div>)}
            </div>
            <form className="flex gap-2 border-t p-4" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea className="min-h-12 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm" maxLength={8000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to the customer…" /><Button type="submit" disabled={!reply.trim()}><Send className="mr-2 h-4 w-4" />Send</Button></form>
          </> : <SourceDetail item={selected} /> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select an Inbox item.</div>}
        </section>
      </div>
    </main>
  </div>;
}

function SourceDetail({ item }: { item: UnifiedInboxItem }) {
  const isReview = item.source_type === "store_review";
  const source = item.source;
  return <div className="flex flex-1 items-center justify-center bg-muted/20 p-6"><Card className="w-full max-w-2xl p-6"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><SourceIcon type={item.source_type} /><div><Badge variant="outline">{sourceLabel[item.source_type]}</Badge><h2 className="mt-2 text-xl font-semibold">{item.title}</h2></div></div><Badge variant={item.priority === "urgent" ? "destructive" : "outline"}>{priorityLabel[item.priority]}</Badge></div><p className="mt-5 whitespace-pre-wrap text-sm text-muted-foreground">{item.preview}</p><div className="mt-5 grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2"><Detail label="Status" value={item.status} /><Detail label="Customer" value={item.customer_reference || "—"} /><Detail label={isReview ? "Rating" : "Provider"} value={isReview ? `${source.rating || "—"}/5` : String(source.provider || "—")} /><Detail label={isReview ? "Territory" : "Deadline"} value={isReview ? String(source.territory || source.language || "—") : dateTime(String(source.deadline_at || ""))} /></div><div className="mt-5 flex justify-end"><Button asChild><Link href={item.destination}>{isReview ? "Open response workspace" : "Open Refund Center"}<ExternalLink className="ml-2 h-4 w-4" /></Link></Button></div></Card></div>;
}

function SourceIcon({ type }: { type: UnifiedInboxItem["source_type"] }) {
  if (type === "store_review") return <Star className="h-5 w-5 shrink-0 text-amber-500" />;
  if (type === "refund_case") return <RotateCcw className="h-5 w-5 shrink-0 text-orange-500" />;
  return <MessageSquareText className="h-5 w-5 shrink-0 text-blue-500" />;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium capitalize">{value}</div></div>;
}
