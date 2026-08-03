"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleUserRound, Inbox, RefreshCw, Send, ShieldCheck } from "lucide-react";
import AppHeader from "@/components/layout/app-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useProjectSelection } from "@/context/useProjectSelection";
import { showErrorNotification } from "@/lib/Notifications";
import {
  getInboxConversations,
  getInboxMessages,
  sendInboxMessage,
  updateInboxConversation,
  type InboxConversation,
  type InboxMessage,
} from "@/api/messaging/inboxService";

const dateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "—";

const priorityLabel: Record<InboxConversation["priority"], string> = {
  low: "Low", normal: "Normal", high: "High", urgent: "Urgent",
};

export default function InboxPage() {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = useMemo(() => conversations.find((item) => item.id === selectedId), [conversations, selectedId]);

  const loadConversations = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const result = await getInboxConversations(projectId, statusFilter);
      setConversations(result.data || []);
      setSelectedId((current) => current || result.data?.[0]?.id || "");
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to load the Inbox");
    } finally { setLoading(false); }
  }, [projectId, statusFilter]);

  const loadMessages = useCallback(async () => {
    if (!projectId || !selectedId) { setMessages([]); return; }
    try {
      const result = await getInboxMessages(projectId, selectedId);
      setMessages(result.data || []);
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to load the conversation");
    }
  }, [projectId, selectedId]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    const timer = window.setInterval(() => { void loadConversations(); void loadMessages(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadConversations, loadMessages]);

  const send = async () => {
    if (!projectId || !selectedId || !reply.trim()) return;
    const value = reply.trim();
    setReply("");
    try {
      await sendInboxMessage(projectId, selectedId, value);
      await Promise.all([loadMessages(), loadConversations()]);
    } catch (error) {
      setReply(value);
      showErrorNotification(error instanceof Error ? error.message : "Unable to send the message");
    }
  };

  const update = async (value: Partial<Pick<InboxConversation, "status" | "priority">>) => {
    if (!projectId || !selectedId) return;
    try {
      await updateInboxConversation(projectId, selectedId, value);
      await loadConversations();
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to update the conversation");
    }
  };

  return <div className="flex h-dvh flex-col overflow-hidden">
    <AppHeader titleOverride="Inbox" />
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Support Inbox</h1><p className="text-sm text-muted-foreground">Native chat, assignment, and conversation history in one dashboard.</p></div>
        <div className="flex gap-2">
          <select aria-label="Filter by status" className="rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All</option><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select>
          <Button variant="outline" disabled={loading} onClick={() => void loadConversations()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      </div>
      <Alert><ShieldCheck /><AlertTitle>Domain isolation</AlertTitle><AlertDescription>Chat has its own Worker, D1 database, and R2 storage. A support outage never affects Purchases.</AlertDescription></Alert>
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border bg-card lg:grid-cols-[360px_1fr]">
        <aside className="min-h-0 overflow-auto border-r">
          {conversations.map((conversation) => <button key={conversation.id} onClick={() => setSelectedId(conversation.id)} className={`w-full border-b p-4 text-left transition-colors hover:bg-muted ${selectedId === conversation.id ? "bg-muted" : ""}`}>
            <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{conversation.subject || "Support conversation"}</span><Badge variant={conversation.priority === "urgent" ? "destructive" : "outline"}>{priorityLabel[conversation.priority]}</Badge></div>
            <div className="mt-1 truncate text-sm text-muted-foreground">{conversation.last_message_preview || "No messages"}</div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{conversation.status} · {conversation.message_count} message(s)</span><span>{dateTime(conversation.last_message_at || conversation.updated_at)}</span></div>
          </button>)}
          {!conversations.length && <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><Inbox className="h-8 w-8" />No conversations match this filter.</div>}
        </aside>
        <section className="flex min-h-0 flex-col">
          {selected ? <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div className="flex min-w-0 items-center gap-3"><CircleUserRound className="h-8 w-8 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate font-medium">{selected.subject || "Customer"}</div><div className="truncate text-xs text-muted-foreground">Customer {selected.external_user_id}</div></div></div>
              <div className="flex gap-2"><select aria-label="Priority" className="rounded-md border bg-background px-2 text-sm" value={selected.priority} onChange={(event) => void update({ priority: event.target.value as InboxConversation["priority"] })}>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Status" className="rounded-md border bg-background px-2 text-sm" value={selected.status} onChange={(event) => void update({ status: event.target.value as InboxConversation["status"] })}><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select></div>
            </header>
            <div className="flex-1 space-y-3 overflow-auto bg-muted/20 p-5">
              {messages.map((message) => <div key={message.id} className={`flex ${message.sender_kind === "agent" ? "justify-end" : "justify-start"}`}><Card className={`max-w-[78%] px-4 py-3 ${message.sender_kind === "agent" ? "bg-primary text-primary-foreground" : ""}`}><p className="whitespace-pre-wrap text-sm">{message.body || `Attachment: ${message.attachment_name || "file"}`}</p><div className={`mt-1 text-[11px] ${message.sender_kind === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{message.sender_kind === "agent" ? "Team" : "Customer"} · {dateTime(message.created_at)}</div></Card></div>)}
            </div>
            <form className="flex gap-2 border-t p-4" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea className="min-h-12 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm" maxLength={8000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to the customer…" /><Button type="submit" disabled={!reply.trim()}><Send className="mr-2 h-4 w-4" />Send</Button></form>
          </> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select a conversation.</div>}
        </section>
      </div>
    </main>
  </div>;
}
