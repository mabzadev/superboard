"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleUserRound,
  Download,
  ExternalLink,
  Inbox,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { inboxDeepLink } from "@/api/messaging/inboxDeepLink";
import {
  getMessagingSettings,
  type MessagingSettingsBootstrap,
} from "@/api/messaging/settingsService";
import {
  executeMessagingMacro,
  getMessagingDraft,
  saveMessagingDraft,
} from "@/api/messaging/operationsService";
import {
  getInboxMessages,
  getUnifiedInboxItems,
  createInboxRealtimeTicket,
  downloadInboxAttachment,
  inboxRealtimeUrl,
  markInboxConversationRead,
  parseInboxRealtimeEvent,
  sendInboxMessage,
  sendInboxAttachment,
  setInboxConversationTyping,
  uploadInboxAttachment,
  updateInboxConversation,
  type InboxConversation,
  type InboxMessage,
  type UnifiedInboxItem,
} from "@/api/messaging/inboxService";

const dateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const priorityLabel: Record<UnifiedInboxItem["priority"], string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const sourceLabel: Record<UnifiedInboxItem["source_type"], string> = {
  conversation: "Support",
  refund_case: "Refund case",
};

export default function InboxPage() {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [items, setItems] = useState<UnifiedInboxItem[]>([]);
  const [degradedSources, setDegradedSources] = useState<
    Array<{ source_type: string; code: string; message: string }>
  >([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [privateNote, setPrivateNote] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<
    "idle" | "connecting" | "live" | "reconnecting"
  >("idle");
  const [customerTyping, setCustomerTyping] = useState(false);
  const [supportSettings, setSupportSettings] =
    useState<MessagingSettingsBootstrap | null>(null);
  const [selectedMacroId, setSelectedMacroId] = useState("");
  const typingTimer = useRef<number | null>(null);
  const customerTypingTimer = useRef<number | null>(null);
  const draftTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const messagesEnd = useRef<HTMLDivElement | null>(null);
  const pendingTextMessage = useRef<{
    body: string;
    privateNote: boolean;
    id: string;
  } | null>(null);
  const requestedSourceId = useRef("");
  const pendingAttachment = useRef<{
    signature: string;
    attachment: {
      key: string;
      filename: string;
      content_type: string;
      size: number;
    };
    id: string;
    body: string;
  } | null>(null);
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId),
    [items, selectedId]
  );

  const loadItems = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const result = await getUnifiedInboxItems(projectId, {
        type: typeFilter,
        status: statusFilter,
      });
      setItems(result.data || []);
      setDegradedSources(result.degraded_sources || []);
      setSelectedId((current) => {
        if (result.data?.some((item) => item.id === current)) return current;
        const requested = result.data?.find(
          (item) => item.source_id === requestedSourceId.current
        );
        return requested?.id || result.data?.[0]?.id || "";
      });
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to load the Inbox"
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter, typeFilter]);

  const loadMessages = useCallback(async () => {
    if (!projectId || selected?.source_type !== "conversation") {
      setMessages([]);
      return;
    }
    try {
      const result = await getInboxMessages(projectId, selected.source_id);
      setMessages(result.data || []);
      try {
        await markInboxConversationRead(projectId, selected.source_id);
        setItems((current) =>
          current.map((item) =>
            item.id === selected.id
              ? { ...item, source: { ...item.source, unread_count: 0 } }
              : item
          )
        );
      } catch {
        // A failed receipt does not hide messages and will retry on refresh.
      }
    } catch (error) {
      showErrorNotification(
        error instanceof Error
          ? error.message
          : "Unable to load the conversation"
      );
    }
  }, [projectId, selected?.id, selected?.source_id, selected?.source_type]);

  useEffect(() => {
    const requested = inboxDeepLink(window.location.search);
    requestedSourceId.current = requested.sourceId;
    setTypeFilter(requested.type);
    setStatusFilter(requested.status);
  }, []);
  useEffect(() => {
    void loadItems();
  }, [loadItems]);
  useEffect(() => {
    if (!projectId) {
      setSupportSettings(null);
      return;
    }
    void getMessagingSettings(projectId)
      .then((result) => setSupportSettings(result.data))
      .catch(() => setSupportSettings(null));
  }, [projectId]);
  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);
  useEffect(() => {
    if (!projectId || selected?.source_type !== "conversation") return;
    let cancelled = false;
    setReply("");
    void getMessagingDraft(projectId, selected.source_id)
      .then((result) => {
        if (!cancelled && result.data?.content)
          setReply((current) => current || result.data?.content || "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selected?.source_id, selected?.source_type]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadItems();
      void loadMessages();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadItems, loadMessages]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end" });
  }, [messages]);
  useEffect(() => {
    if (!projectId || selected?.source_type !== "conversation") {
      setRealtimeStatus("idle");
      setCustomerTyping(false);
      return;
    }
    const conversationId = selected.source_id;
    const retryDelays = [1_000, 2_000, 5_000, 10_000, 30_000];
    let cancelled = false;
    let attempt = 0;
    let retryTimer: number | null = null;
    let socket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (cancelled || retryTimer != null) return;
      setRealtimeStatus("reconnecting");
      setCustomerTyping(false);
      const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
      attempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };
    const connect = async () => {
      if (cancelled) return;
      setRealtimeStatus(attempt > 0 ? "reconnecting" : "connecting");
      try {
        const issued = await createInboxRealtimeTicket(
          projectId,
          conversationId
        );
        if (cancelled) return;
        socket = new WebSocket(
          inboxRealtimeUrl(projectId, conversationId, issued.ticket)
        );
        socket.onopen = () => {
          if (cancelled) return;
          attempt = 0;
          setRealtimeStatus("live");
        };
        socket.onmessage = (message) => {
          const event = parseInboxRealtimeEvent(message.data);
          if (
            !event ||
            (event.conversation_id && event.conversation_id !== conversationId)
          )
            return;
          if (
            event.type === "message.created" &&
            event.message?.conversation_id === conversationId
          ) {
            setMessages((current) => mergeMessage(current, event.message!));
            void markInboxConversationRead(projectId, conversationId).catch(
              () => undefined
            );
            void loadItems();
          } else if (
            event.type === "typing.changed" &&
            event.actor?.kind === "user"
          ) {
            setCustomerTyping(event.active === true);
            if (customerTypingTimer.current)
              window.clearTimeout(customerTypingTimer.current);
            if (event.active) {
              customerTypingTimer.current = window.setTimeout(
                () => setCustomerTyping(false),
                5_000
              );
            }
          }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          socket = null;
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };
    void connect();
    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      if (customerTypingTimer.current)
        window.clearTimeout(customerTypingTimer.current);
      customerTypingTimer.current = null;
      setCustomerTyping(false);
      setRealtimeStatus("idle");
      socket?.close(1000, "Conversation changed");
    };
  }, [loadItems, projectId, selected?.source_id, selected?.source_type]);
  useEffect(
    () => () => {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (customerTypingTimer.current)
        window.clearTimeout(customerTypingTimer.current);
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
    },
    []
  );

  const send = async () => {
    if (!projectId || selected?.source_type !== "conversation" || !reply.trim())
      return;
    const value = reply.trim();
    const pending =
      pendingTextMessage.current?.body === value &&
      pendingTextMessage.current.privateNote === privateNote
        ? pendingTextMessage.current
        : { body: value, privateNote, id: crypto.randomUUID() };
    pendingTextMessage.current = pending;
    setReply("");
    try {
      await sendInboxMessage(
        projectId,
        selected.source_id,
        value,
        pending.id,
        privateNote
      );
      pendingTextMessage.current = null;
      void saveMessagingDraft(projectId, selected.source_id, "").catch(
        () => undefined
      );
      void setInboxConversationTyping(
        projectId,
        selected.source_id,
        false
      ).catch(() => undefined);
      await Promise.all([loadMessages(), loadItems()]);
    } catch (error) {
      setReply(value);
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to send the message"
      );
    }
  };

  const update = async (
    value: Partial<
      Pick<
        InboxConversation,
        | "status"
        | "priority"
        | "assigned_user_id"
        | "assigned_team_id"
        | "inbox_id"
        | "snoozed_until"
      >
    > & { labels?: string[]; custom_attributes?: Record<string, unknown> }
  ) => {
    if (!projectId || selected?.source_type !== "conversation") return;
    try {
      await updateInboxConversation(projectId, selected.source_id, value);
      await loadItems();
    } catch (error) {
      showErrorNotification(
        error instanceof Error
          ? error.message
          : "Unable to update the conversation"
      );
    }
  };

  const updateReply = (value: string) => {
    if (pendingTextMessage.current?.body !== value.trim())
      pendingTextMessage.current = null;
    setReply(value);
    if (!projectId || selected?.source_type !== "conversation") return;
    void setInboxConversationTyping(
      projectId,
      selected.source_id,
      value.trim().length > 0
    ).catch(() => undefined);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void setInboxConversationTyping(
        projectId,
        selected.source_id,
        false
      ).catch(() => undefined);
    }, 2_000);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      if (projectId && selected?.source_type === "conversation") {
        void saveMessagingDraft(projectId, selected.source_id, value).catch(
          () => undefined
        );
      }
    }, 1_000);
  };

  const attach = async (file?: File) => {
    if (!file || !projectId || selected?.source_type !== "conversation") return;
    if (file.size > 10 * 1024 * 1024) {
      showErrorNotification("Attachments are limited to 10 MB");
      return;
    }
    setUploading(true);
    try {
      const signature = `${selected.source_id}:${file.name}:${file.size}:${file.lastModified}`;
      let pending =
        pendingAttachment.current?.signature === signature
          ? pendingAttachment.current
          : null;
      if (!pending) {
        pending = {
          signature,
          attachment: await uploadInboxAttachment(
            projectId,
            selected.source_id,
            file
          ),
          id: crypto.randomUUID(),
          body: reply.trim(),
        };
        pendingAttachment.current = pending;
      }
      await sendInboxAttachment(
        projectId,
        selected.source_id,
        pending.attachment,
        pending.id,
        pending.body
      );
      pendingAttachment.current = null;
      setReply("");
      await Promise.all([loadMessages(), loadItems()]);
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to send the attachment"
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const downloadAttachment = async (message: InboxMessage) => {
    if (!projectId || selected?.source_type !== "conversation") return;
    try {
      const blob = await downloadInboxAttachment(
        projectId,
        selected.source_id,
        message.id
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = message.attachment_name || "attachment";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      showErrorNotification(
        error instanceof Error
          ? error.message
          : "Unable to download the attachment"
      );
    }
  };

  const agents = configurationOptions(
    supportSettings,
    "agent",
    "auth_user_id",
    "display_name"
  );
  const teams = configurationOptions(supportSettings, "team");
  const inboxes = configurationOptions(supportSettings, "inbox");
  const macros = configurationOptions(supportSettings, "macro");
  const cannedResponses = (supportSettings?.entities || [])
    .filter(
      (entity) => entity.entity_type === "canned_response" && entity.enabled
    )
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      content: String(entity.configuration.content || ""),
    }));

  const executeMacro = async () => {
    if (
      !projectId ||
      selected?.source_type !== "conversation" ||
      !selectedMacroId
    )
      return;
    try {
      await executeMessagingMacro(
        projectId,
        selected.source_id,
        selectedMacroId
      );
      setSelectedMacroId("");
      await loadItems();
      showSuccessNotification("Macro applied");
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to apply macro"
      );
    }
  };

  return (
    <div className="flex min-h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Support Inbox</h1>
            <p className="text-sm text-muted-foreground">
              Real-time customer conversations, assignments, attachments, macros
              and private notes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Filter by source"
              className="rounded-md border bg-background px-3 text-sm"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="all">All conversations</option>
              <option value="conversation">Support</option>
            </select>
            <select
              aria-label="Filter by status"
              className="rounded-md border bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="closed">Closed</option>
            </select>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void loadItems()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
        <Alert>
          <ShieldCheck />
          <AlertTitle>Isolated Support runtime</AlertTitle>
          <AlertDescription>
            Conversations, attachments and real-time events are handled by the
            dedicated Support Worker and database.
          </AlertDescription>
        </Alert>
        {degradedSources.map((source) => (
          <Alert
            key={`${source.source_type}:${source.code}`}
            variant="destructive"
          >
            <AlertTitle>
              {sourceLabel[
                source.source_type as UnifiedInboxItem["source_type"]
              ] || "Inbox source"}{" "}
              is unavailable
            </AlertTitle>
            <AlertDescription>
              {source.message}. Other Inbox sources continue to work.
            </AlertDescription>
          </Alert>
        ))}
        <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border bg-card lg:grid-cols-[380px_1fr]">
          <aside className="min-h-0 overflow-auto border-r">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full border-b p-4 text-left transition-colors hover:bg-muted ${selectedId === item.id ? "bg-muted" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <SourceIcon type={item.source_type} />
                    <span className="truncate font-medium">{item.title}</span>
                    {item.source_type === "conversation" &&
                      Number(item.source.unread_count || 0) > 0 && (
                        <Badge>{String(item.source.unread_count)}</Badge>
                      )}
                  </div>
                  <Badge
                    variant={
                      item.priority === "urgent" ? "destructive" : "outline"
                    }
                  >
                    {priorityLabel[item.priority]}
                  </Badge>
                </div>
                <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {item.preview}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {sourceLabel[item.source_type]} · {item.status}
                  </span>
                  <span>{dateTime(item.updated_at)}</span>
                </div>
              </button>
            ))}
            {!items.length && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8" />
                No Inbox items match these filters.
              </div>
            )}
          </aside>
          <section className="flex min-h-0 flex-col">
            {selected ? (
              selected.source_type === "conversation" ? (
                <>
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <CircleUserRound className="h-8 w-8 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium">
                            {selected.title}
                          </div>
                          <Badge
                            variant={
                              realtimeStatus === "live"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {realtimeStatus === "live" ? (
                              <Wifi className="mr-1 h-3 w-3" />
                            ) : (
                              <WifiOff className="mr-1 h-3 w-3" />
                            )}
                            {realtimeStatus === "live"
                              ? "Live"
                              : realtimeStatus === "idle"
                                ? "Offline"
                                : "Connecting"}
                          </Badge>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          Customer {selected.customer_reference || "—"}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <select
                        aria-label="Priority"
                        className="rounded-md border bg-background px-2 text-sm"
                        value={selected.priority}
                        onChange={(event) =>
                          void update({
                            priority: event.target
                              .value as InboxConversation["priority"],
                          })
                        }
                      >
                        {Object.entries(priorityLabel).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Status"
                        className="rounded-md border bg-background px-2 text-sm"
                        value={selected.status}
                        onChange={(event) =>
                          void update({
                            status: event.target
                              .value as InboxConversation["status"],
                          })
                        }
                      >
                        <option value="open">Open</option>
                        <option value="pending">Pending</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                    <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <ConfigurationSelect
                        label="Assigned agent"
                        value={String(selected.source.assigned_user_id || "")}
                        options={agents}
                        onChange={(value) =>
                          void update({ assigned_user_id: value || null })
                        }
                      />
                      <ConfigurationSelect
                        label="Assigned team"
                        value={String(selected.source.assigned_team_id || "")}
                        options={teams}
                        onChange={(value) =>
                          void update({ assigned_team_id: value || null })
                        }
                      />
                      <ConfigurationSelect
                        label="Inbox"
                        value={String(selected.source.inbox_id || "")}
                        options={inboxes}
                        onChange={(value) =>
                          void update({ inbox_id: value || null })
                        }
                      />
                      <input
                        key={`${selected.id}:labels:${String(selected.source.labels_json || "")}`}
                        aria-label="Conversation labels"
                        className="rounded-md border bg-background px-3 py-2 text-sm"
                        defaultValue={conversationLabels(
                          selected.source.labels_json
                        ).join(", ")}
                        placeholder="Labels, comma separated"
                        onBlur={(event) =>
                          void update({
                            labels: event.target.value
                              .split(",")
                              .map((label) => label.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                      <input
                        key={`${selected.id}:snooze:${String(selected.source.snoozed_until || "")}`}
                        aria-label="Snooze until"
                        type="datetime-local"
                        className="rounded-md border bg-background px-3 py-2 text-sm"
                        defaultValue={localDateTime(
                          String(selected.source.snoozed_until || "")
                        )}
                        onBlur={(event) =>
                          void update({
                            snoozed_until: event.target.value
                              ? new Date(event.target.value).toISOString()
                              : null,
                          })
                        }
                      />
                    </div>
                    <textarea
                      key={`${selected.id}:attributes:${String(selected.source.custom_attributes_json || "")}`}
                      aria-label="Conversation custom attributes"
                      className="min-h-16 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                      defaultValue={prettyJson(
                        selected.source.custom_attributes_json
                      )}
                      placeholder="Conversation custom attributes (JSON)"
                      onBlur={(event) => {
                        try {
                          const value = JSON.parse(event.target.value || "{}");
                          if (
                            !value ||
                            typeof value !== "object" ||
                            Array.isArray(value)
                          )
                            throw new Error();
                          void update({ custom_attributes: value });
                        } catch {
                          showErrorNotification(
                            "Custom attributes must be a JSON object"
                          );
                        }
                      }}
                    />
                  </header>
                  <div className="flex-1 space-y-3 overflow-auto bg-muted/20 p-5">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.sender_kind === "agent" ? "justify-end" : "justify-start"}`}
                      >
                        <Card
                          className={`max-w-[78%] px-4 py-3 ${message.visibility === "private" ? "border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50" : message.sender_kind === "agent" ? "bg-primary text-primary-foreground" : ""}`}
                        >
                          <p className="whitespace-pre-wrap text-sm">
                            {message.body ||
                              (message.attachment_name
                                ? "Attachment"
                                : "Empty message")}
                          </p>
                          {message.attachment_name && (
                            <Button
                              type="button"
                              size="sm"
                              variant={
                                message.sender_kind === "agent" &&
                                message.visibility !== "private"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="mt-2"
                              onClick={() => void downloadAttachment(message)}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              {message.attachment_name}
                            </Button>
                          )}
                          <div
                            className={`mt-1 text-[11px] ${message.sender_kind === "agent" && message.visibility !== "private" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                          >
                            {message.visibility === "private"
                              ? "Private note"
                              : message.sender_kind === "agent"
                                ? "Team"
                                : "Customer"}{" "}
                            · {dateTime(message.created_at)}
                          </div>
                        </Card>
                      </div>
                    ))}
                    {customerTyping && (
                      <div
                        aria-live="polite"
                        className="text-xs text-muted-foreground"
                      >
                        Customer is typing…
                      </div>
                    )}
                    <div ref={messagesEnd} />
                  </div>
                  <form
                    className="border-t p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send();
                    }}
                  >
                    <div className="mb-2 flex flex-wrap gap-2">
                      <select
                        aria-label="Insert canned response"
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                        value=""
                        onChange={(event) => {
                          const response = cannedResponses.find(
                            (item) => item.id === event.target.value
                          );
                          if (response) updateReply(response.content);
                        }}
                      >
                        <option value="">Insert canned response…</option>
                        {cannedResponses.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Select macro"
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                        value={selectedMacroId}
                        onChange={(event) =>
                          setSelectedMacroId(event.target.value)
                        }
                      >
                        <option value="">Select macro…</option>
                        {macros.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!selectedMacroId}
                        onClick={() => void executeMacro()}
                      >
                        Apply macro
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        ref={fileInput}
                        className="hidden"
                        type="file"
                        onChange={(event) =>
                          void attach(event.target.files?.[0])
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={uploading || privateNote}
                        aria-label="Attach a file"
                        onClick={() => fileInput.current?.click()}
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <textarea
                        className="min-h-12 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm"
                        maxLength={8000}
                        value={reply}
                        onChange={(event) => updateReply(event.target.value)}
                        placeholder={
                          privateNote
                            ? "Write a private note for the team…"
                            : "Reply to the customer…"
                        }
                      />
                      <Button
                        type="submit"
                        disabled={!reply.trim() || uploading}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {privateNote ? "Add note" : "Send"}
                      </Button>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={privateNote}
                        onChange={(event) => {
                          pendingTextMessage.current = null;
                          setPrivateNote(event.target.checked);
                        }}
                      />
                      Private note — visible only to agents
                    </label>
                  </form>
                </>
              ) : (
                <SourceDetail item={selected} />
              )
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Select an Inbox item.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function conversationLabels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function localDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function configurationOptions(
  settings: MessagingSettingsBootstrap | null,
  type: string,
  valueKey?: string,
  labelKey?: string
) {
  return (settings?.entities || [])
    .filter((entity) => entity.entity_type === type && entity.enabled)
    .map((entity) => ({
      value: String(
        valueKey ? entity.configuration[valueKey] || entity.id : entity.id
      ),
      label: String(
        labelKey ? entity.configuration[labelKey] || entity.name : entity.name
      ),
    }));
}

function ConfigurationSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const known = options.some((option) => option.value === value);
  return (
    <select
      aria-label={label}
      className="rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{label}</option>
      {value && !known && <option value={value}>{value} (legacy)</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(
      typeof value === "string" ? JSON.parse(value) : value || {},
      null,
      2
    );
  } catch {
    return "{}";
  }
}

function mergeMessage(current: InboxMessage[], message: InboxMessage) {
  const existing = current.findIndex((item) => item.id === message.id);
  const next =
    existing >= 0
      ? current.map((item, index) => (index === existing ? message : item))
      : [...current, message];
  return next.sort((left, right) => left.sequence - right.sequence);
}

function SourceDetail({ item }: { item: UnifiedInboxItem }) {
  const source = item.source;
  return (
    <div className="flex flex-1 items-center justify-center bg-muted/20 p-6">
      <Card className="w-full max-w-2xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SourceIcon type={item.source_type} />
            <div>
              <Badge variant="outline">{sourceLabel[item.source_type]}</Badge>
              <h2 className="mt-2 text-xl font-semibold">{item.title}</h2>
            </div>
          </div>
          <Badge
            variant={item.priority === "urgent" ? "destructive" : "outline"}
          >
            {priorityLabel[item.priority]}
          </Badge>
        </div>
        <p className="mt-5 whitespace-pre-wrap text-sm text-muted-foreground">
          {item.preview}
        </p>
        <div className="mt-5 grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2">
          <Detail label="Status" value={item.status} />
          <Detail label="Customer" value={item.customer_reference || "—"} />
          <Detail label="Provider" value={String(source.provider || "—")} />
          <Detail
            label="Deadline"
            value={dateTime(String(source.deadline_at || ""))}
          />
        </div>
        <div className="mt-5 flex justify-end">
          <Button asChild>
            <Link href={item.destination}>
              Open Refund Center
              <ExternalLink className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SourceIcon({ type }: { type: UnifiedInboxItem["source_type"] }) {
  if (type === "refund_case")
    return <RotateCcw className="h-5 w-5 shrink-0 text-orange-500" />;
  return <MessageSquareText className="h-5 w-5 shrink-0 text-blue-500" />;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium capitalize">{value}</div>
    </div>
  );
}
