"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Ban,
  Download,
  Mail,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  addSubscriberToList,
  createEmailCampaign,
  createEmailSubscriber,
  createEmailTemplate,
  createProviderWebhook,
  createSubscriberList,
  createSubscriberSegment,
  deleteEmailSubscriber,
  deleteEmailTemplate,
  deleteMarketingMedia,
  discardMarketingDeadLetter,
  deleteProviderWebhook,
  deleteSmtpSettings,
  deleteSubscriberList,
  deleteSubscriberSegment,
  downloadMarketingMedia,
  exportEmailSubscribers,
  getDeliveryOutbox,
  getEmailCampaigns,
  getEmailSubscribers,
  getEmailTemplates,
  getMarketingAudit,
  getMarketingDeadLetters,
  getMarketingMedia,
  getMarketingStatistics,
  getProviderWebhooks,
  getSmtpSettings,
  getSubscriberLists,
  getSubscriberSegments,
  importEmailSubscribers,
  refreshSubscriberSegment,
  replayMarketingDeadLetter,
  removeSubscriberFromList,
  retryDeliveryOutbox,
  saveSmtpSettings,
  scheduleEmailCampaign,
  sendTransactionalEmail,
  suppressEmailSubscriber,
  testEmailCampaign,
  testSmtpSettings,
  transitionEmailCampaign,
  updateEmailCampaign,
  updateEmailSubscriber,
  updateEmailTemplate,
  updateSubscriberList,
  updateSubscriberSegment,
  uploadMarketingMedia,
  verifySmtpDomain,
  type DeliveryOutboxItem,
  type EmailCampaign,
  type EmailSubscriber,
  type EmailTemplate,
  type MarketingMedia,
  type MarketingDeadLetter,
  type MarketingStatistics,
  type ProviderWebhook,
  type SmtpSettings,
  type SubscriberList,
  type SubscriberSegment,
} from "@/api/marketing/marketingService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";

const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const textareaClass =
  "min-h-28 w-full rounded-md border bg-background p-3 text-sm";

export function MarketingListPage({ kind }: { kind: "email" | "campaigns" }) {
  return kind === "email" ? <EmailAudiencePage /> : <CampaignManagerPage />;
}

function EmailAudiencePage() {
  const { selectedProject } = useProjectSelection();
  const [subscribers, setSubscribers] = useState<EmailSubscriber[]>([]);
  const [lists, setLists] = useState<SubscriberList[]>([]);
  const [segments, setSegments] = useState<SubscriberSegment[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [doubleOptIn, setDoubleOptIn] = useState(false);
  const [selectedLists, setSelectedLists] = useState<string[]>([]);
  const [editingSubscriber, setEditingSubscriber] =
    useState<EmailSubscriber | null>(null);
  const [subscriberAttributes, setSubscriberAttributes] = useState("{}");
  const [listEditingId, setListEditingId] = useState("");
  const [listName, setListName] = useState("");
  const [listDescription, setListDescription] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [optinMode, setOptinMode] = useState("single");
  const [segmentEditingId, setSegmentEditingId] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [segmentField, setSegmentField] = useState("status");
  const [segmentOperator, setSegmentOperator] = useState("equals");
  const [segmentValue, setSegmentValue] = useState("enabled");
  const [query, setQuery] = useState("");
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [people, groups, savedSegments] = await Promise.all([
        getEmailSubscribers(selectedProject.id, query),
        getSubscriberLists(selectedProject.id),
        getSubscriberSegments(selectedProject.id),
      ]);
      setSubscribers(people);
      setLists(groups);
      setSegments(savedSegments);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [query, selectedProject]);
  useEffect(() => void load(), [load]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      showSuccessNotification(success);
      await load();
      return true;
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const addSubscriber = async () => {
    if (!selectedProject) return;
    const saved = await run(
      () =>
        createEmailSubscriber(selectedProject.id, {
          email,
          name: name || undefined,
          double_opt_in: doubleOptIn,
          list_ids: selectedLists,
          consent_source: "dashboard",
          attributes: {},
        }),
      doubleOptIn ? "Subscriber added; confirmation queued" : "Subscriber added"
    );
    if (saved) {
      setEmail("");
      setName("");
      setSelectedLists([]);
    }
  };
  const importBatch = async () => {
    if (!selectedProject) return;
    const records = importText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [address, displayName] = line.split(",");
        return {
          email: address?.trim(),
          name: displayName?.trim() || undefined,
          attributes: {},
        };
      });
    if (!records.length) return;
    if (
      await run(
        () => importEmailSubscribers(selectedProject.id, records),
        `${records.length} subscriber records imported`
      )
    )
      setImportText("");
  };
  const saveList = async () => {
    if (!selectedProject) return;
    const payload = {
      name: listName,
      description: listDescription || null,
      visibility,
      optin_mode: optinMode,
    };
    const saved = await run(
      () =>
        listEditingId
          ? updateSubscriberList(selectedProject.id, listEditingId, payload)
          : createSubscriberList(selectedProject.id, payload),
      listEditingId ? "List updated" : "List created"
    );
    if (saved) {
      setListEditingId("");
      setListName("");
      setListDescription("");
    }
  };
  const editList = (item: SubscriberList) => {
    setListEditingId(item.id);
    setListName(item.name);
    setListDescription(item.description || "");
    setVisibility(item.visibility);
    setOptinMode(item.optin_mode);
  };
  const saveSegment = async () => {
    if (!selectedProject) return;
    const payload = {
      name: segmentName,
      rules: {
        mode: "all",
        conditions: [
          {
            field: segmentField,
            operator: segmentOperator,
            value: segmentValue,
          },
        ],
      },
    };
    const saved = await run(
      () =>
        segmentEditingId
          ? updateSubscriberSegment(
              selectedProject.id,
              segmentEditingId,
              payload
            )
          : createSubscriberSegment(selectedProject.id, payload),
      segmentEditingId ? "Segment updated" : "Segment created"
    );
    if (saved) {
      setSegmentEditingId("");
      setSegmentName("");
    }
  };
  const editSegment = (item: SubscriberSegment) => {
    const condition = Array.isArray(
      (item.rules as { conditions?: unknown[] }).conditions
    )
      ? (item.rules as { conditions: Array<Record<string, unknown>> })
          .conditions[0]
      : undefined;
    setSegmentEditingId(item.id);
    setSegmentName(item.name);
    setSegmentField(String(condition?.field || "status"));
    setSegmentOperator(String(condition?.operator || "equals"));
    setSegmentValue(String(condition?.value ?? "enabled"));
  };
  const editSubscriber = (item: EmailSubscriber) => {
    setEditingSubscriber(item);
    setEmail(item.email);
    setName(item.name || "");
    setSelectedLists(item.list_ids || []);
    setSubscriberAttributes(JSON.stringify(item.attributes || {}, null, 2));
  };
  const saveSubscriber = async () => {
    if (!selectedProject || !editingSubscriber) return;
    let attributes: Record<string, unknown>;
    try {
      const parsed = JSON.parse(subscriberAttributes) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      attributes = parsed as Record<string, unknown>;
    } catch {
      showErrorNotification("Subscriber attributes must be a JSON object");
      return;
    }
    const previous = new Set(editingSubscriber.list_ids || []);
    const next = new Set(selectedLists);
    const saved = await run(async () => {
      await updateEmailSubscriber(selectedProject.id, editingSubscriber.id, {
        email,
        name: name || null,
        attributes,
      });
      await Promise.all([
        ...selectedLists
          .filter((id) => !previous.has(id))
          .map((id) =>
            addSubscriberToList(selectedProject.id, id, editingSubscriber.id)
          ),
        ...(editingSubscriber.list_ids || [])
          .filter((id) => !next.has(id))
          .map((id) =>
            removeSubscriberFromList(
              selectedProject.id,
              id,
              editingSubscriber.id
            )
          ),
      ]);
    }, "Subscriber updated");
    if (saved) {
      setEditingSubscriber(null);
      setEmail("");
      setName("");
      setSelectedLists([]);
      setSubscriberAttributes("{}");
    }
  };
  const download = async () => {
    if (!selectedProject) return;
    try {
      const blob = await exportEmailSubscribers(selectedProject.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "subscribers.csv";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };
  return (
    <ModulePage
      title="Email"
      description="Subscribers, consent, lists, double opt-in, segmentation and bulk operations."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-3">
            <FormCard
              title={editingSubscriber ? "Edit subscriber" : "Add subscriber"}
            >
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Input
                placeholder="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="max-h-28 space-y-2 overflow-auto rounded-md border p-3">
                {lists.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No lists configured.
                  </p>
                ) : (
                  lists.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLists.includes(item.id)}
                        onChange={(event) =>
                          setSelectedLists((current) =>
                            event.target.checked
                              ? [...current, item.id]
                              : current.filter((id) => id !== item.id)
                          )
                        }
                      />
                      {item.name}
                    </label>
                  ))
                )}
              </div>
              {editingSubscriber ? (
                <textarea
                  aria-label="Subscriber attributes"
                  className={`${textareaClass} font-mono`}
                  value={subscriberAttributes}
                  onChange={(event) =>
                    setSubscriberAttributes(event.target.value)
                  }
                />
              ) : (
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={doubleOptIn}
                    onCheckedChange={setDoubleOptIn}
                  />
                  Double opt-in
                </label>
              )}
              <div className="flex gap-2">
                {editingSubscriber && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingSubscriber(null);
                      setEmail("");
                      setName("");
                      setSelectedLists([]);
                    }}
                  >
                    <X />
                    Cancel
                  </Button>
                )}
                <Button
                  disabled={busy || !email}
                  onClick={() =>
                    void (editingSubscriber
                      ? saveSubscriber()
                      : addSubscriber())
                  }
                >
                  {editingSubscriber ? (
                    <SaveLabel />
                  ) : (
                    <>
                      <Plus />
                      Add subscriber
                    </>
                  )}
                </Button>
              </div>
            </FormCard>
            <FormCard title={listEditingId ? "Edit list" : "Create list"}>
              <Input
                placeholder="List name"
                value={listName}
                onChange={(event) => setListName(event.target.value)}
              />
              <Input
                placeholder="Description"
                value={listDescription}
                onChange={(event) => setListDescription(event.target.value)}
              />
              <select
                aria-label="List visibility"
                className={selectClass}
                value={visibility}
                onChange={(event) => setVisibility(event.target.value)}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
              <select
                aria-label="Opt-in mode"
                className={selectClass}
                value={optinMode}
                onChange={(event) => setOptinMode(event.target.value)}
              >
                <option value="single">Single opt-in</option>
                <option value="double">Double opt-in</option>
              </select>
              <div className="flex gap-2">
                {listEditingId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setListEditingId("");
                      setListName("");
                      setListDescription("");
                    }}
                  >
                    <X />
                    Cancel
                  </Button>
                )}
                <Button disabled={!listName} onClick={() => void saveList()}>
                  {listEditingId ? (
                    <SaveLabel />
                  ) : (
                    <>
                      <Plus />
                      Create list
                    </>
                  )}
                </Button>
              </div>
            </FormCard>
            <FormCard
              title={segmentEditingId ? "Edit segment" : "Create segment"}
            >
              <Input
                placeholder="Segment name"
                value={segmentName}
                onChange={(event) => setSegmentName(event.target.value)}
              />
              <Input
                placeholder="Field or attributes.plan"
                value={segmentField}
                onChange={(event) => setSegmentField(event.target.value)}
              />
              <select
                aria-label="Segment operator"
                className={selectClass}
                value={segmentOperator}
                onChange={(event) => setSegmentOperator(event.target.value)}
              >
                {[
                  "equals",
                  "not_equals",
                  "contains",
                  "starts_with",
                  "exists",
                  "in",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <Input
                placeholder="Value"
                value={segmentValue}
                onChange={(event) => setSegmentValue(event.target.value)}
              />
              <div className="flex gap-2">
                {segmentEditingId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSegmentEditingId("");
                      setSegmentName("");
                    }}
                  >
                    <X />
                    Cancel
                  </Button>
                )}
                <Button
                  disabled={!segmentName || !segmentField}
                  onClick={() => void saveSegment()}
                >
                  {segmentEditingId ? (
                    <SaveLabel />
                  ) : (
                    <>
                      <Plus />
                      Create segment
                    </>
                  )}
                </Button>
              </div>
            </FormCard>
          </div>
          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <div className="flex-1">
                <CardTitle>Subscribers</CardTitle>
                <CardDescription>
                  {subscribers.length} displayed
                </CardDescription>
              </div>
              <Input
                className="max-w-xs"
                placeholder="Search subscribers"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button variant="outline" onClick={() => void download()}>
                <Download />
                Export CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {subscribers.length === 0 ? (
                <Empty text="No subscribers found." />
              ) : (
                subscribers.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium">{item.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.name || "No name"} · consent{" "}
                        {item.consent_status || "unknown"} ·{" "}
                        {item.list_ids?.length || 0} lists
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="rounded-full bg-muted px-2 py-1 text-xs">
                        {item.status}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${item.email}`}
                        onClick={() => editSubscriber(item)}
                      >
                        <Pencil />
                      </Button>
                      {item.status === "enabled" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void run(
                                () =>
                                  suppressEmailSubscriber(
                                    selectedProject.id,
                                    item.id,
                                    "unsubscribe"
                                  ),
                                "Subscriber unsubscribed"
                              )
                            }
                          >
                            Unsubscribe
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Blocklist ${item.email}`}
                            onClick={() =>
                              void run(
                                () =>
                                  suppressEmailSubscriber(
                                    selectedProject.id,
                                    item.id,
                                    "blocklist"
                                  ),
                                "Subscriber blocklisted"
                              )
                            }
                          >
                            <Ban />
                          </Button>
                        </>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${item.email}`}
                        onClick={() =>
                          void run(
                            () =>
                              deleteEmailSubscriber(
                                selectedProject.id,
                                item.id
                              ),
                            "Subscriber deleted"
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <div className="grid gap-6 xl:grid-cols-3">
            <CollectionCard
              title="Lists"
              items={lists.map((item) => ({
                id: item.id,
                name: item.name,
                detail: `${item.subscriber_count || 0} subscribers · ${item.visibility}/${item.optin_mode}`,
              }))}
              onEdit={(id) => {
                const item = lists.find((candidate) => candidate.id === id);
                if (item) editList(item);
              }}
              onDelete={(id) =>
                run(
                  () => deleteSubscriberList(selectedProject.id, id),
                  "List deleted"
                )
              }
            />
            <Card>
              <CardHeader>
                <CardTitle>Segments</CardTitle>
                <CardDescription>
                  Calculated audience membership
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {segments.length === 0 ? (
                  <Empty text="No segments yet." />
                ) : (
                  segments.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.subscriber_count || 0} subscribers
                        </p>
                      </div>
                      <div className="flex">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${item.name}`}
                          onClick={() => editSegment(item)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Refresh ${item.name}`}
                          onClick={() =>
                            void run(
                              () =>
                                refreshSubscriberSegment(
                                  selectedProject.id,
                                  item.id
                                ),
                              "Segment refreshed"
                            )
                          }
                        >
                          <RefreshCw />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${item.name}`}
                          onClick={() =>
                            void run(
                              () =>
                                deleteSubscriberSegment(
                                  selectedProject.id,
                                  item.id
                                ),
                              "Segment deleted"
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <FormCard title="Bulk import">
              <textarea
                className={textareaClass}
                placeholder={"one@example.com,Name\ntwo@example.com,Name"}
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
              />
              <Button
                disabled={!importText.trim()}
                onClick={() => void importBatch()}
              >
                <Upload />
                Import up to 1,000
              </Button>
            </FormCard>
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function CampaignManagerPage() {
  const { selectedProject } = useProjectSelection();
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [media, setMedia] = useState<MarketingMedia[]>([]);
  const [lists, setLists] = useState<SubscriberList[]>([]);
  const [segments, setSegments] = useState<SubscriberSegment[]>([]);
  const [smtp, setSmtp] = useState<SmtpSettings[]>([]);
  const [templateEditingId, setTemplateEditingId] = useState("");
  const [campaignEditingId, setCampaignEditingId] = useState("");
  const [templateForm, setTemplateForm] = useState({
    name: "",
    subject: "",
    type: "campaign",
    format: "html",
    content: "",
  });
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    subject: "",
    templateId: "",
    listId: "",
    segmentId: "",
    smtpId: "",
    tracking: true,
  });
  const [testRecipients, setTestRecipients] = useState<Record<string, string>>(
    {}
  );
  const [campaignSchedules, setCampaignSchedules] = useState<
    Record<string, string>
  >({});
  const [transactional, setTransactional] = useState({
    recipient: "",
    templateId: "",
    subject: "",
  });
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [
        campaignRows,
        templateRows,
        mediaRows,
        listRows,
        segmentRows,
        smtpResult,
      ] = await Promise.all([
        getEmailCampaigns(selectedProject.id),
        getEmailTemplates(selectedProject.id),
        getMarketingMedia(selectedProject.id),
        getSubscriberLists(selectedProject.id),
        getSubscriberSegments(selectedProject.id),
        getSmtpSettings(selectedProject.id),
      ]);
      setCampaigns(campaignRows);
      setTemplates(templateRows);
      setMedia(mediaRows);
      setLists(listRows);
      setSegments(segmentRows);
      setSmtp(smtpResult.profiles || (smtpResult.id ? [smtpResult] : []));
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      showSuccessNotification(success);
      await load();
      return true;
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
      return false;
    }
  };
  const templatePayload = () => ({
    name: templateForm.name,
    subject: templateForm.subject,
    template_type: templateForm.type,
    content_html: templateForm.format === "html" ? templateForm.content : null,
    content_markdown:
      templateForm.format === "markdown" ? templateForm.content : null,
    content_text: templateForm.format === "text" ? templateForm.content : null,
  });
  const addTemplate = async () => {
    if (!selectedProject) return;
    const saved = await run(
      () =>
        templateEditingId
          ? updateEmailTemplate(
              selectedProject.id,
              templateEditingId,
              templatePayload()
            )
          : createEmailTemplate(selectedProject.id, templatePayload()),
      templateEditingId ? "Template updated" : "Template created"
    );
    if (saved) {
      setTemplateEditingId("");
      setTemplateForm({
        name: "",
        subject: "",
        type: "campaign",
        format: "html",
        content: "",
      });
    }
  };
  const editTemplate = (item: EmailTemplate) => {
    const format = item.content_html
      ? "html"
      : item.content_markdown
        ? "markdown"
        : "text";
    setTemplateEditingId(item.id);
    setTemplateForm({
      name: item.name,
      subject: item.subject || "",
      type: item.template_type,
      format,
      content:
        item.content_html || item.content_markdown || item.content_text || "",
    });
  };
  const campaignPayload = () => {
    const template = templates.find(
      (item) => item.id === campaignForm.templateId
    );
    const current = campaigns.find((item) => item.id === campaignEditingId);
    return {
      name: campaignForm.name,
      subject: campaignForm.subject,
      template_id: template?.id || current?.template_id || null,
      content_html:
        template?.content_html ||
        (template?.content_markdown
          ? `<p>${template.content_markdown}</p>`
          : current?.content_html || null),
      content_text:
        template?.content_text ||
        template?.content_markdown ||
        current?.content_text ||
        null,
      list_ids: campaignForm.listId ? [campaignForm.listId] : [],
      segment_ids: campaignForm.segmentId ? [campaignForm.segmentId] : [],
      smtp_profile_id: campaignForm.smtpId || null,
      tracking_enabled: campaignForm.tracking,
    };
  };
  const addCampaign = async () => {
    if (!selectedProject) return;
    const saved = await run(
      () =>
        campaignEditingId
          ? updateEmailCampaign(
              selectedProject.id,
              campaignEditingId,
              campaignPayload()
            )
          : createEmailCampaign(selectedProject.id, campaignPayload()),
      campaignEditingId ? "Campaign updated" : "Campaign draft created"
    );
    if (saved) {
      setCampaignEditingId("");
      setCampaignForm((value) => ({ ...value, name: "", subject: "" }));
    }
  };
  const editCampaign = (item: EmailCampaign) => {
    setCampaignEditingId(item.id);
    setCampaignForm({
      name: item.name,
      subject: item.subject,
      templateId: item.template_id || "",
      listId: item.list_ids?.[0] || "",
      segmentId: item.segment_ids?.[0] || "",
      smtpId: item.smtp_profile_id || "",
      tracking: item.tracking_enabled !== false,
    });
  };
  const action = (
    campaign: EmailCampaign,
    transition: "start" | "pause" | "resume" | "cancel" | "archive"
  ) =>
    selectedProject &&
    run(
      () =>
        transitionEmailCampaign(selectedProject.id, campaign.id, transition),
      `Campaign ${transition} requested`
    );
  const scheduleCampaign = async (campaign: EmailCampaign) => {
    const scheduleAt = campaignSchedules[campaign.id];
    if (!selectedProject || !scheduleAt) return;
    if (
      await run(
        () =>
          scheduleEmailCampaign(
            selectedProject.id,
            campaign.id,
            new Date(scheduleAt).toISOString()
          ),
        "Campaign scheduled"
      )
    ) {
      setCampaignSchedules((current) => ({
        ...current,
        [campaign.id]: "",
      }));
    }
  };
  const sendCampaignTest = async (campaign: EmailCampaign) => {
    const recipient = testRecipients[campaign.id];
    if (!selectedProject || !recipient) return;
    if (
      await run(
        () => testEmailCampaign(selectedProject.id, campaign.id, recipient),
        "Test email accepted"
      )
    ) {
      setTestRecipients((current) => ({ ...current, [campaign.id]: "" }));
    }
  };
  const upload = async (file?: File) => {
    if (!selectedProject || !file) return;
    await run(
      () => uploadMarketingMedia(selectedProject.id, file),
      "Media uploaded"
    );
    if (fileRef.current) fileRef.current.value = "";
  };
  const downloadMedia = async (item: MarketingMedia) => {
    if (!selectedProject) return;
    try {
      const blob = await downloadMarketingMedia(selectedProject.id, item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };
  return (
    <ModulePage
      title="Campaigns"
      description="Templates, media, previews, scheduled campaigns, transactional email and delivery controls."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <FormCard
              title={
                templateEditingId ? "Edit email template" : "Email template"
              }
            >
              <Input
                placeholder="Template name"
                value={templateForm.name}
                onChange={(event) =>
                  setTemplateForm((value) => ({
                    ...value,
                    name: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="Default subject"
                value={templateForm.subject}
                onChange={(event) =>
                  setTemplateForm((value) => ({
                    ...value,
                    subject: event.target.value,
                  }))
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="Template type"
                  className={selectClass}
                  value={templateForm.type}
                  onChange={(event) =>
                    setTemplateForm((value) => ({
                      ...value,
                      type: event.target.value,
                    }))
                  }
                >
                  <option value="campaign">Campaign</option>
                  <option value="transactional">Transactional</option>
                  <option value="system">System</option>
                </select>
                <select
                  aria-label="Editor format"
                  className={selectClass}
                  value={templateForm.format}
                  onChange={(event) =>
                    setTemplateForm((value) => ({
                      ...value,
                      format: event.target.value,
                    }))
                  }
                >
                  <option value="html">HTML</option>
                  <option value="markdown">Markdown</option>
                  <option value="text">Plain text</option>
                </select>
              </div>
              <textarea
                className={`${textareaClass} font-mono`}
                placeholder="Template content"
                value={templateForm.content}
                onChange={(event) =>
                  setTemplateForm((value) => ({
                    ...value,
                    content: event.target.value,
                  }))
                }
              />
              <div className="rounded-md border bg-white p-3 text-black">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Preview
                </p>
                {templateForm.format === "html" ? (
                  <iframe
                    title="Email template preview"
                    sandbox=""
                    className="min-h-40 w-full"
                    srcDoc={templateForm.content}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm">
                    {templateForm.content || "Nothing to preview"}
                  </pre>
                )}
              </div>
              <div className="flex gap-2">
                {templateEditingId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTemplateEditingId("");
                      setTemplateForm({
                        name: "",
                        subject: "",
                        type: "campaign",
                        format: "html",
                        content: "",
                      });
                    }}
                  >
                    <X />
                    Cancel
                  </Button>
                )}
                <Button
                  disabled={!templateForm.name || !templateForm.content}
                  onClick={() => void addTemplate()}
                >
                  {templateEditingId ? (
                    <SaveLabel />
                  ) : (
                    <>
                      <Plus />
                      Create template
                    </>
                  )}
                </Button>
              </div>
            </FormCard>
            <FormCard
              title={campaignEditingId ? "Edit campaign" : "Campaign draft"}
            >
              <Input
                placeholder="Campaign name"
                value={campaignForm.name}
                onChange={(event) =>
                  setCampaignForm((value) => ({
                    ...value,
                    name: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="Subject"
                value={campaignForm.subject}
                onChange={(event) =>
                  setCampaignForm((value) => ({
                    ...value,
                    subject: event.target.value,
                  }))
                }
              />
              <select
                aria-label="Template"
                className={selectClass}
                value={campaignForm.templateId}
                onChange={(event) =>
                  setCampaignForm((value) => ({
                    ...value,
                    templateId: event.target.value,
                  }))
                }
              >
                <option value="">Select template</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="List"
                  className={selectClass}
                  value={campaignForm.listId}
                  onChange={(event) =>
                    setCampaignForm((value) => ({
                      ...value,
                      listId: event.target.value,
                    }))
                  }
                >
                  <option value="">Any list</option>
                  {lists.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Segment"
                  className={selectClass}
                  value={campaignForm.segmentId}
                  onChange={(event) =>
                    setCampaignForm((value) => ({
                      ...value,
                      segmentId: event.target.value,
                    }))
                  }
                >
                  <option value="">Any segment</option>
                  {segments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="SMTP profile"
                  className={selectClass}
                  value={campaignForm.smtpId}
                  onChange={(event) =>
                    setCampaignForm((value) => ({
                      ...value,
                      smtpId: event.target.value,
                    }))
                  }
                >
                  <option value="">Automatic SMTP</option>
                  {smtp.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={campaignForm.tracking}
                  onCheckedChange={(tracking) =>
                    setCampaignForm((value) => ({ ...value, tracking }))
                  }
                />
                Open and click tracking
              </label>
              <div className="flex gap-2">
                {campaignEditingId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCampaignEditingId("");
                      setCampaignForm((value) => ({
                        ...value,
                        name: "",
                        subject: "",
                      }));
                    }}
                  >
                    <X />
                    Cancel
                  </Button>
                )}
                <Button
                  disabled={
                    !campaignForm.name ||
                    !campaignForm.subject ||
                    (!campaignEditingId && !campaignForm.templateId)
                  }
                  onClick={() => void addCampaign()}
                >
                  {campaignEditingId ? (
                    <SaveLabel />
                  ) : (
                    <>
                      <Plus />
                      Create draft
                    </>
                  )}
                </Button>
              </div>
            </FormCard>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Email campaigns</CardTitle>
              <CardDescription>
                Every edit and lifecycle transition is validated and audited.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {campaigns.length === 0 ? (
                <Empty text="No campaigns yet." />
              ) : (
                campaigns.map((item) => (
                  <div key={item.id} className="rounded-md border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm">{item.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.recipient_count || 0} recipients ·{" "}
                          {item.delivered_count || 0} delivered · tracking{" "}
                          {item.tracking_enabled ? "on" : "off"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="rounded-full bg-muted px-2 py-1 text-xs capitalize">
                          {item.status}
                        </span>
                        {["draft", "scheduled", "paused"].includes(
                          item.status
                        ) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${item.name}`}
                            onClick={() => editCampaign(item)}
                          >
                            <Pencil />
                          </Button>
                        )}
                        {["draft", "scheduled"].includes(item.status) && (
                          <Button
                            size="sm"
                            onClick={() => void action(item, "start")}
                          >
                            <Play />
                            Start
                          </Button>
                        )}
                        {["running", "scheduled"].includes(item.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void action(item, "pause")}
                          >
                            <Pause />
                            Pause
                          </Button>
                        )}
                        {item.status === "paused" && (
                          <Button
                            size="sm"
                            onClick={() => void action(item, "resume")}
                          >
                            <Play />
                            Resume
                          </Button>
                        )}
                        {["draft", "scheduled", "running", "paused"].includes(
                          item.status
                        ) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void action(item, "cancel")}
                          >
                            Cancel
                          </Button>
                        )}
                        {["finished", "cancelled"].includes(item.status) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Archive ${item.name}`}
                            onClick={() => void action(item, "archive")}
                          >
                            <Archive />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
                      <Input
                        aria-label={`Schedule ${item.name}`}
                        type="datetime-local"
                        value={campaignSchedules[item.id] || ""}
                        onChange={(event) =>
                          setCampaignSchedules((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        variant="outline"
                        disabled={
                          !campaignSchedules[item.id] ||
                          !["draft", "paused"].includes(item.status)
                        }
                        onClick={() => void scheduleCampaign(item)}
                      >
                        Schedule
                      </Button>
                      <Input
                        aria-label={`Test recipient for ${item.name}`}
                        type="email"
                        placeholder="Test recipient"
                        value={testRecipients[item.id] || ""}
                        onChange={(event) =>
                          setTestRecipients((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        variant="outline"
                        disabled={!testRecipients[item.id]}
                        onClick={() => void sendCampaignTest(item)}
                      >
                        <Send />
                        Test
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <div className="grid gap-6 xl:grid-cols-3">
            <CollectionCard
              title="Templates"
              items={templates.map((item) => ({
                id: item.id,
                name: item.name,
                detail: `${item.template_type} · ${item.subject || "No subject"}`,
              }))}
              onEdit={(id) => {
                const item = templates.find((candidate) => candidate.id === id);
                if (item) editTemplate(item);
              }}
              onDelete={(id) =>
                run(
                  () => deleteEmailTemplate(selectedProject.id, id),
                  "Template deleted"
                )
              }
            />
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Media</CardTitle>
                  <CardDescription>
                    Images, audio, video and PDF
                  </CardDescription>
                </div>
                <>
                  <input
                    ref={fileRef}
                    className="hidden"
                    type="file"
                    accept="image/*,video/*,audio/*,application/pdf"
                    onChange={(event) => void upload(event.target.files?.[0])}
                  />
                  <Button size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload />
                    Upload
                  </Button>
                </>
              </CardHeader>
              <CardContent className="space-y-2">
                {media.length === 0 ? (
                  <Empty text="No media uploaded." />
                ) : (
                  media.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div>
                        <p className="font-medium">{item.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.content_type} ·{" "}
                          {Math.ceil(item.byte_size / 1024)} KB
                        </p>
                      </div>
                      <div className="flex">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Download ${item.filename}`}
                          onClick={() => void downloadMedia(item)}
                        >
                          <Download />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${item.filename}`}
                          onClick={() =>
                            void run(
                              () =>
                                deleteMarketingMedia(
                                  selectedProject.id,
                                  item.id
                                ),
                              "Media deleted"
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <FormCard title="Transactional email">
              <Input
                type="email"
                placeholder="Recipient"
                value={transactional.recipient}
                onChange={(event) =>
                  setTransactional((value) => ({
                    ...value,
                    recipient: event.target.value,
                  }))
                }
              />
              <select
                aria-label="Transactional template"
                className={selectClass}
                value={transactional.templateId}
                onChange={(event) =>
                  setTransactional((value) => ({
                    ...value,
                    templateId: event.target.value,
                  }))
                }
              >
                <option value="">Select template</option>
                {templates
                  .filter((item) => item.template_type !== "campaign")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <Input
                placeholder="Subject override"
                value={transactional.subject}
                onChange={(event) =>
                  setTransactional((value) => ({
                    ...value,
                    subject: event.target.value,
                  }))
                }
              />
              <Button
                disabled={!transactional.recipient || !transactional.templateId}
                onClick={() =>
                  void run(
                    () =>
                      sendTransactionalEmail(selectedProject.id, {
                        recipient: transactional.recipient,
                        template_id: transactional.templateId,
                        subject: transactional.subject || undefined,
                        attributes: {},
                        tracking_enabled: false,
                      }),
                    "Transactional email queued"
                  )
                }
              >
                <Send />
                Queue email
              </Button>
            </FormCard>
          </div>
        </div>
      )}
    </ModulePage>
  );
}

export function MarketingStatisticsPage() {
  const { selectedProject } = useProjectSelection();
  const [statistics, setStatistics] = useState<MarketingStatistics>();
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState("day");
  const [from, setFrom] = useState(
    new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  );
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const filters = {
        from: `${from}T00:00:00.000Z`,
        to: `${to}T23:59:59.999Z`,
        interval,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(campaignId ? { campaign_id: campaignId } : {}),
      };
      const [result, campaignRows] = await Promise.all([
        getMarketingStatistics(selectedProject.id, filters),
        getEmailCampaigns(selectedProject.id),
      ]);
      setStatistics(result);
      setCampaigns(campaignRows);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [campaignId, from, interval, selectedProject, to]);
  useEffect(() => void load(), [load]);
  return (
    <ModulePage
      title="Marketing statistics"
      description="Delivery, opens, clicks, bounces, complaints, unsubscribes and campaign progression."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Statistics from"
              type="date"
              className="w-auto"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Input
              aria-label="Statistics to"
              type="date"
              className="w-auto"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <select
              aria-label="Statistics interval"
              className={`${selectClass} w-auto`}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            >
              <option value="hour">Hour</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
            <select
              aria-label="Statistics campaign"
              className={`${selectClass} min-w-56 w-auto`}
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
            >
              <option value="">All campaigns</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw />
              Refresh
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(statistics?.totals || {}).map(([key, value]) => (
              <Card key={key}>
                <CardHeader>
                  <CardDescription className="capitalize">
                    {key.replaceAll("_", " ")}
                  </CardDescription>
                  <CardTitle>{formatMetric(key, Number(value))}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Time series</CardTitle>
              <CardDescription>
                {statistics?.series.length || 0} measured event buckets
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-96 overflow-auto">
              {statistics?.series.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2">Period</th>
                      <th className="p-2">Event</th>
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statistics.series.map((row, index) => (
                      <tr
                        key={`${String(row.bucket)}:${String(row.event_type)}:${index}`}
                        className="border-b"
                      >
                        <td className="p-2 font-mono text-xs">
                          {String(row.bucket || "—")}
                        </td>
                        <td className="p-2 capitalize">
                          {String(row.event_type || "unknown").replaceAll(
                            "_",
                            " "
                          )}
                        </td>
                        <td className="p-2 text-right font-medium">
                          {Number(row.total || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty text="No delivery events match this period." />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

export function MarketingSettingsPage() {
  const { selectedProject } = useProjectSelection();
  const [profiles, setProfiles] = useState<SmtpSettings[]>([]);
  const [webhooks, setWebhooks] = useState<ProviderWebhook[]>([]);
  const [outbox, setOutbox] = useState<DeliveryOutboxItem[]>([]);
  const [deadLetters, setDeadLetters] = useState<MarketingDeadLetter[]>([]);
  const [auditCount, setAuditCount] = useState(0);
  const [smtp, setSmtp] = useState<SmtpSettings>({
    id: crypto.randomUUID(),
    name: "Default",
    configured: false,
    port: 587,
    security: "starttls",
    priority: 100,
    enabled: true,
  });
  const [password, setPassword] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [webhookProvider, setWebhookProvider] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [smtpResult, hookRows, outboxRows, deadLetterRows, auditRows] =
        await Promise.all([
          getSmtpSettings(selectedProject.id),
          getProviderWebhooks(selectedProject.id),
          getDeliveryOutbox(selectedProject.id),
          getMarketingDeadLetters(selectedProject.id),
          getMarketingAudit(selectedProject.id),
        ]);
      const rows = smtpResult.profiles || (smtpResult.id ? [smtpResult] : []);
      setProfiles(rows);
      setWebhooks(hookRows);
      setOutbox(outboxRows);
      setDeadLetters(deadLetterRows);
      setAuditCount(auditRows.length);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      showSuccessNotification(success);
      await load();
      return true;
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
      return false;
    }
  };
  const reset = () => {
    setSmtp({
      id: crypto.randomUUID(),
      name: `SMTP ${profiles.length + 1}`,
      configured: false,
      port: 587,
      security: "starttls",
      priority: (profiles.length + 1) * 100,
      enabled: true,
    });
    setPassword("");
  };
  const save = async () => {
    if (!selectedProject) return;
    if (
      await run(
        () =>
          saveSmtpSettings(selectedProject.id, {
            ...smtp,
            password: password || undefined,
            hourly_quota: smtp.hourly_quota || null,
            daily_quota: smtp.daily_quota || null,
          }),
        "SMTP profile encrypted and saved"
      )
    )
      setPassword("");
  };
  return (
    <ModulePage
      title="Marketing settings"
      description="Multiple encrypted SMTP profiles, quotas, failover, provider webhooks and delivery retries."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
            <FormCard title="SMTP profile">
              <Input
                placeholder="Profile name"
                value={smtp.name || ""}
                onChange={(event) =>
                  setSmtp((value) => ({ ...value, name: event.target.value }))
                }
              />
              <div className="grid grid-cols-[1fr_100px] gap-2">
                <Input
                  placeholder="SMTP host"
                  value={smtp.host || ""}
                  onChange={(event) =>
                    setSmtp((value) => ({ ...value, host: event.target.value }))
                  }
                />
                <Input
                  aria-label="SMTP port"
                  type="number"
                  value={smtp.port || 587}
                  onChange={(event) =>
                    setSmtp((value) => ({
                      ...value,
                      port: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <select
                aria-label="SMTP security"
                className={selectClass}
                value={smtp.security || "starttls"}
                onChange={(event) =>
                  setSmtp((value) => ({
                    ...value,
                    security: event.target.value,
                  }))
                }
              >
                <option value="tls">TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="plain">Plain</option>
              </select>
              <Input
                placeholder="Username"
                value={smtp.username || ""}
                onChange={(event) =>
                  setSmtp((value) => ({
                    ...value,
                    username: event.target.value,
                  }))
                }
              />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={
                  smtp.configured
                    ? "Leave blank to keep encrypted password"
                    : "Password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Input
                type="email"
                placeholder="From email"
                value={smtp.from_email || ""}
                onChange={(event) =>
                  setSmtp((value) => ({
                    ...value,
                    from_email: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="DKIM selector (for example: mail)"
                value={smtp.dkim_selector || ""}
                onChange={(event) =>
                  setSmtp((value) => ({
                    ...value,
                    dkim_selector: event.target.value || null,
                  }))
                }
              />
              <Input
                placeholder="From name"
                value={smtp.from_name || ""}
                onChange={(event) =>
                  setSmtp((value) => ({
                    ...value,
                    from_name: event.target.value,
                  }))
                }
              />
              <Input
                type="email"
                placeholder="Reply-to email (optional)"
                value={smtp.reply_to || ""}
                onChange={(event) =>
                  setSmtp((value) => ({
                    ...value,
                    reply_to: event.target.value || null,
                  }))
                }
              />
              <div className="grid grid-cols-3 gap-2">
                <Input
                  aria-label="SMTP priority"
                  type="number"
                  placeholder="Priority"
                  value={smtp.priority || 100}
                  onChange={(event) =>
                    setSmtp((value) => ({
                      ...value,
                      priority: Number(event.target.value),
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="Hourly quota"
                  value={smtp.hourly_quota || ""}
                  onChange={(event) =>
                    setSmtp((value) => ({
                      ...value,
                      hourly_quota: Number(event.target.value) || null,
                    }))
                  }
                />
                <Input
                  type="number"
                  placeholder="Daily quota"
                  value={smtp.daily_quota || ""}
                  onChange={(event) =>
                    setSmtp((value) => ({
                      ...value,
                      daily_quota: Number(event.target.value) || null,
                    }))
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={smtp.enabled ?? true}
                  onCheckedChange={(enabled) =>
                    setSmtp((value) => ({ ...value, enabled }))
                  }
                />
                Enabled for failover pool
              </label>
              <div className="flex gap-2">
                <Button variant="outline" onClick={reset}>
                  <Plus />
                  New profile
                </Button>
                <Button
                  disabled={
                    !smtp.host ||
                    !smtp.from_email ||
                    (!smtp.configured && !password)
                  }
                  onClick={() => void save()}
                >
                  <Mail />
                  Save profile
                </Button>
              </div>
            </FormCard>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings />
                  SMTP pool
                </CardTitle>
                <CardDescription>
                  {profiles.length} profiles · {auditCount} audited mutations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {profiles.length === 0 ? (
                  <Empty text="No SMTP profiles configured." />
                ) : (
                  profiles.map((item) => (
                    <div key={item.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <button
                          className="text-left"
                          type="button"
                          onClick={() => {
                            setSmtp(item);
                            setPassword("");
                          }}
                        >
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.host}:{item.port} · priority {item.priority} ·{" "}
                            {item.last_test_status || "untested"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Sender DNS:{" "}
                            {item.authentication_status || "unverified"} · SPF{" "}
                            {item.spf_status || "unchecked"} · DKIM{" "}
                            {item.dkim_status || "unchecked"} · DMARC{" "}
                            {item.dmarc_status || "unchecked"}
                          </p>
                        </button>
                        <div className="flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Verify sender DNS ${item.name}`}
                            disabled={!item.id || !item.dkim_selector}
                            onClick={() =>
                              item.id &&
                              void run(
                                () =>
                                  verifySmtpDomain(
                                    selectedProject.id,
                                    item.id!
                                  ),
                                "SPF, DKIM and DMARC checked"
                              )
                            }
                          >
                            <RefreshCw />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Test ${item.name}`}
                            onClick={() =>
                              void run(
                                () =>
                                  testSmtpSettings(
                                    selectedProject.id,
                                    item.id,
                                    testRecipient || item.from_email
                                  ),
                                "SMTP test accepted"
                              )
                            }
                          >
                            <Send />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${item.name}`}
                            onClick={() =>
                              item.id &&
                              void run(
                                () =>
                                  deleteSmtpSettings(
                                    selectedProject.id,
                                    item.id!
                                  ),
                                "SMTP profile deleted"
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <Input
                  type="email"
                  placeholder="SMTP test recipient (optional)"
                  value={testRecipient}
                  onChange={(event) => setTestRecipient(event.target.value)}
                />
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            <FormCard title="Provider webhook">
              <Input
                placeholder="Provider identifier"
                value={webhookProvider}
                onChange={(event) =>
                  setWebhookProvider(
                    event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_-]/g, "_")
                  )
                }
              />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="Shared secret (minimum 16 characters)"
                value={webhookSecret}
                onChange={(event) => setWebhookSecret(event.target.value)}
              />
              <Button
                disabled={!webhookProvider || webhookSecret.length < 16}
                onClick={() =>
                  void (async () => {
                    if (
                      await run(
                        () =>
                          createProviderWebhook(selectedProject.id, {
                            provider: webhookProvider,
                            secret: webhookSecret,
                            enabled: true,
                          }),
                        "Provider webhook created"
                      )
                    ) {
                      setWebhookProvider("");
                      setWebhookSecret("");
                    }
                  })()
                }
              >
                <Plus />
                Create endpoint
              </Button>
              {webhooks.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">{item.provider}</p>
                    <code className="text-xs">
                      /api/v1/marketing/provider-webhooks/{item.id}
                    </code>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${item.provider}`}
                    onClick={() =>
                      void run(
                        () =>
                          deleteProviderWebhook(selectedProject.id, item.id),
                        "Webhook deleted"
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </FormCard>
            <Card>
              <CardHeader>
                <CardTitle>Delivery outbox</CardTitle>
                <CardDescription>
                  Pending and dead-lettered double opt-in deliveries
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {outbox.length === 0 ? (
                  <Empty text="Delivery outbox is empty." />
                ) : (
                  outbox.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div>
                        <p className="font-medium">{item.job_type}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.status} · {item.attempt_count} attempts{" "}
                          {item.last_error ? `· ${item.last_error}` : ""}
                        </p>
                      </div>
                      {["pending", "dead_letter"].includes(item.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void run(
                              () =>
                                retryDeliveryOutbox(
                                  selectedProject.id,
                                  item.id
                                ),
                              "Delivery retry queued"
                            )
                          }
                        >
                          <RotateCcw />
                          Retry
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Marketing dead letters</CardTitle>
                <CardDescription>
                  Inspect and resolve individual terminal Queue jobs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {deadLetters.length === 0 ? (
                  <Empty text="No marketing dead letters." />
                ) : (
                  deadLetters.map((item) => (
                    <div key={item.id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {item.job_type || "Unknown Queue job"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.status}
                            {item.resolution
                              ? ` · ${item.resolution}`
                              : ""} · {item.attempts} attempts
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {item.resource_id || item.queue_message_id}
                          </p>
                        </div>
                        {item.status === "quarantined" && (
                          <div className="flex shrink-0">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Replay dead letter ${item.id}`}
                              disabled={!item.replayable}
                              title={
                                item.replayable
                                  ? "Replay"
                                  : "Payload was redacted and cannot be replayed"
                              }
                              onClick={() =>
                                void run(
                                  () =>
                                    replayMarketingDeadLetter(
                                      selectedProject.id,
                                      item.id
                                    ),
                                  "Marketing job queued again"
                                )
                              }
                            >
                              <RotateCcw />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Discard dead letter ${item.id}`}
                              onClick={() =>
                                void run(
                                  () =>
                                    discardMarketingDeadLetter(
                                      selectedProject.id,
                                      item.id
                                    ),
                                  "Marketing dead letter discarded"
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function FormCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
function CollectionCard({
  title,
  items,
  onEdit,
  onDelete,
}: {
  title: string;
  items: Array<{ id: string; name: string; detail: string }>;
  onEdit?: (id: string) => void;
  onDelete: (id: string) => Promise<unknown>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{items.length} configured</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <Empty text={`No ${title.toLowerCase()} yet.`} />
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
              <div className="flex">
                {onEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${item.name}`}
                    onClick={() => onEdit(item.id)}
                  >
                    <Pencil />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${item.name}`}
                  onClick={() => void onDelete(item.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
function SaveLabel() {
  return (
    <>
      <Pencil />
      Save
    </>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>
  );
}
function formatMetric(key: string, value: number) {
  return key.endsWith("_rate")
    ? `${value.toLocaleString()}%`
    : value.toLocaleString();
}
