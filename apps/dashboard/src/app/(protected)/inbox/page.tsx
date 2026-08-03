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
  ? new Intl.DateTimeFormat("fr-CH", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "—";

const priorityLabel: Record<InboxConversation["priority"], string> = {
  low: "Basse", normal: "Normale", high: "Haute", urgent: "Urgente",
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
      showErrorNotification(error instanceof Error ? error.message : "Impossible de charger l’Inbox");
    } finally { setLoading(false); }
  }, [projectId, statusFilter]);

  const loadMessages = useCallback(async () => {
    if (!projectId || !selectedId) { setMessages([]); return; }
    try {
      const result = await getInboxMessages(projectId, selectedId);
      setMessages(result.data || []);
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Impossible de charger la conversation");
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
      showErrorNotification(error instanceof Error ? error.message : "Envoi impossible");
    }
  };

  const update = async (value: Partial<Pick<InboxConversation, "status" | "priority">>) => {
    if (!projectId || !selectedId) return;
    try {
      await updateInboxConversation(projectId, selectedId, value);
      await loadConversations();
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Mise à jour impossible");
    }
  };

  return <div className="flex h-dvh flex-col overflow-hidden">
    <AppHeader titleOverride="Inbox" />
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Inbox support</h1><p className="text-sm text-muted-foreground">Chat natif VocoStar, assignation et historique dans le dashboard OpenGrow.</p></div>
        <div className="flex gap-2">
          <select aria-label="Filtrer par statut" className="rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Tous</option><option value="open">Ouverts</option><option value="pending">En attente</option><option value="closed">Fermés</option></select>
          <Button variant="outline" disabled={loading} onClick={() => void loadConversations()}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
        </div>
      </div>
      <Alert><ShieldCheck /><AlertTitle>Isolation garantie</AlertTitle><AlertDescription>Le chat possède son propre Worker, sa propre D1 et son propre stockage R2. Une panne de support ne touche jamais Purchases.</AlertDescription></Alert>
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border bg-card lg:grid-cols-[360px_1fr]">
        <aside className="min-h-0 overflow-auto border-r">
          {conversations.map((conversation) => <button key={conversation.id} onClick={() => setSelectedId(conversation.id)} className={`w-full border-b p-4 text-left transition-colors hover:bg-muted ${selectedId === conversation.id ? "bg-muted" : ""}`}>
            <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{conversation.subject || "Conversation VocoStar"}</span><Badge variant={conversation.priority === "urgent" ? "destructive" : "outline"}>{priorityLabel[conversation.priority]}</Badge></div>
            <div className="mt-1 truncate text-sm text-muted-foreground">{conversation.last_message_preview || "Aucun message"}</div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{conversation.status} · {conversation.message_count} message(s)</span><span>{dateTime(conversation.last_message_at || conversation.updated_at)}</span></div>
          </button>)}
          {!conversations.length && <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground"><Inbox className="h-8 w-8" />Aucune conversation pour ce filtre.</div>}
        </aside>
        <section className="flex min-h-0 flex-col">
          {selected ? <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div className="flex min-w-0 items-center gap-3"><CircleUserRound className="h-8 w-8 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate font-medium">{selected.subject || "Client VocoStar"}</div><div className="truncate text-xs text-muted-foreground">Client {selected.external_user_id}</div></div></div>
              <div className="flex gap-2"><select aria-label="Priorité" className="rounded-md border bg-background px-2 text-sm" value={selected.priority} onChange={(event) => void update({ priority: event.target.value as InboxConversation["priority"] })}>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Statut" className="rounded-md border bg-background px-2 text-sm" value={selected.status} onChange={(event) => void update({ status: event.target.value as InboxConversation["status"] })}><option value="open">Ouvert</option><option value="pending">En attente</option><option value="closed">Fermé</option></select></div>
            </header>
            <div className="flex-1 space-y-3 overflow-auto bg-muted/20 p-5">
              {messages.map((message) => <div key={message.id} className={`flex ${message.sender_kind === "agent" ? "justify-end" : "justify-start"}`}><Card className={`max-w-[78%] px-4 py-3 ${message.sender_kind === "agent" ? "bg-primary text-primary-foreground" : ""}`}><p className="whitespace-pre-wrap text-sm">{message.body || `Pièce jointe : ${message.attachment_name || "fichier"}`}</p><div className={`mt-1 text-[11px] ${message.sender_kind === "agent" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{message.sender_kind === "agent" ? "Équipe" : "Client"} · {dateTime(message.created_at)}</div></Card></div>)}
            </div>
            <form className="flex gap-2 border-t p-4" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea className="min-h-12 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm" maxLength={8000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Répondre au client…" /><Button type="submit" disabled={!reply.trim()}><Send className="mr-2 h-4 w-4" />Envoyer</Button></form>
          </> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Sélectionnez une conversation.</div>}
        </section>
      </div>
    </main>
  </div>;
}
