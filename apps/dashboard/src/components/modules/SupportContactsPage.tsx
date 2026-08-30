"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import {
  createSupportCompany,
  createSupportContact,
  createSupportContactNote,
  deleteSupportContactNote,
  getSupportCompanies,
  getSupportContact,
  getSupportContactNotes,
  getSupportContacts,
  updateSupportContact,
  type SupportCompany,
  type SupportContact,
  type SupportContactDetail,
  type SupportContactNote,
} from "@/api/support/operationsService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";

type Draft = {
  external_user_id: string;
  name: string;
  email: string;
  phone: string;
  company_id: string;
  blocked: boolean;
  custom_attributes: Array<{ id: string; key: string; value: string }>;
};
const emptyDraft: Draft = {
  external_user_id: "",
  name: "",
  email: "",
  phone: "",
  company_id: "",
  blocked: false,
  custom_attributes: [],
};

export default function SupportContactsPage() {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [contacts, setContacts] = useState<SupportContact[]>([]);
  const [companies, setCompanies] = useState<SupportCompany[]>([]);
  const [notes, setNotes] = useState<SupportContactNote[]>([]);
  const [conversations, setConversations] = useState<
    SupportContactDetail["conversations"]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyDomain, setCompanyDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = useMemo(
    () => contacts.find((contact) => contact.id === selectedId),
    [contacts, selectedId]
  );

  const load = useCallback(
    async (search: string) => {
      if (!projectId) return;
      setBusy(true);
      try {
        const [result, companyResult] = await Promise.all([
          getSupportContacts(projectId, search.trim()),
          getSupportCompanies(projectId),
        ]);
        setContacts(result.data || []);
        setCompanies(companyResult.data || []);
      } catch (error) {
        showErrorNotification(
          error instanceof Error ? error.message : "Unable to load contacts"
        );
      } finally {
        setBusy(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void load("");
  }, [load]);
  useEffect(() => {
    if (!projectId || !selectedId) {
      setNotes([]);
      setConversations([]);
      return;
    }
    void Promise.all([
      getSupportContactNotes(projectId, selectedId),
      getSupportContact(projectId, selectedId),
    ])
      .then(([noteResult, contactResult]) => {
        setNotes(noteResult.data || []);
        setConversations(contactResult.data.conversations || []);
      })
      .catch((error) =>
        showErrorNotification(
          error instanceof Error
            ? error.message
            : "Unable to load contact details"
        )
      );
  }, [projectId, selectedId]);

  const select = (contact: SupportContact) => {
    setSelectedId(contact.id);
    setDraft({
      external_user_id: contact.external_user_id,
      name: contact.name || "",
      email: contact.email || "",
      phone: contact.phone || "",
      company_id: contact.company_id || "",
      blocked: contact.blocked,
      custom_attributes: Object.entries(contact.custom_attributes || {}).map(
        ([key, value]) => ({
          id: crypto.randomUUID(),
          key,
          value: value == null ? "" : String(value),
        })
      ),
    });
  };
  const startNew = () => {
    setSelectedId(null);
    setDraft(emptyDraft);
    setNotes([]);
    setConversations([]);
  };

  const save = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const customAttributes = Object.fromEntries(
        draft.custom_attributes
          .filter((attribute) => attribute.key.trim())
          .map((attribute) => [attribute.key.trim(), attribute.value])
      );
      const payload = {
        external_user_id: draft.external_user_id.trim(),
        name: draft.name.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        company_id: draft.company_id.trim() || null,
        blocked: draft.blocked,
        custom_attributes: customAttributes,
      };
      if (selectedId)
        await updateSupportContact(projectId, selectedId, payload);
      else await createSupportContact(projectId, payload);
      showSuccessNotification("Contact saved");
      await load(query);
      startNew();
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to save contact"
      );
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!projectId || !selectedId || !note.trim()) return;
    try {
      await createSupportContactNote(projectId, selectedId, note.trim());
      setNote("");
      setNotes(
        (await getSupportContactNotes(projectId, selectedId)).data || []
      );
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to add note"
      );
    }
  };

  const removeNote = async (noteId: string) => {
    if (!projectId || !selectedId) return;
    try {
      await deleteSupportContactNote(projectId, selectedId, noteId);
      setNotes((current) => current.filter((item) => item.id !== noteId));
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to delete note"
      );
    }
  };

  const addCompany = async () => {
    if (!projectId || !companyName.trim()) return;
    setBusy(true);
    try {
      await createSupportCompany(projectId, {
        name: companyName.trim(),
        domain: companyDomain.trim() || null,
        description: null,
        custom_attributes: {},
      });
      setCompanyName("");
      setCompanyDomain("");
      showSuccessNotification("Company created");
      await load(query);
    } catch (error) {
      showErrorNotification(
        error instanceof Error ? error.message : "Unable to create company"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full">
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Contacts</h1>
            <p className="text-sm text-muted-foreground">
              Customer profiles, companies, custom attributes, conversation
              history, and private notes.
            </p>
          </div>
          <Button variant="outline" onClick={startNew}>
            <Plus className="mr-2 h-4 w-4" />
            New contact
          </Button>
        </div>
        <div className="flex gap-2">
          <div className="relative max-w-xl flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search name, email, phone, or customer ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(query);
              }}
            />
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void load(query)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Search
          </Button>
        </div>
        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <Card className="max-h-[760px] overflow-auto">
            {contacts.map((contact) => (
              <button
                key={contact.id}
                type="button"
                className={`w-full border-b p-4 text-left hover:bg-muted ${selectedId === contact.id ? "bg-muted" : ""}`}
                onClick={() => select(contact)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {contact.name || contact.external_user_id}
                  </span>
                  {contact.blocked && (
                    <Badge variant="destructive">Blocked</Badge>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {contact.email || contact.phone || contact.external_user_id}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {contact.conversation_count || 0} conversations
                  {contact.company_name ? ` · ${contact.company_name}` : ""}
                </p>
              </button>
            ))}
            {!contacts.length && (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No contacts match this search.
              </div>
            )}
          </Card>
          <div className="space-y-5">
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">
                  {selected ? "Edit contact" : "New contact"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  The customer ID comes from the existing application identity.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Customer ID"
                  value={draft.external_user_id}
                  onChange={(value) =>
                    setDraft({ ...draft, external_user_id: value })
                  }
                />
                <Field
                  label="Name"
                  value={draft.name}
                  onChange={(value) => setDraft({ ...draft, name: value })}
                />
                <Field
                  label="Email"
                  type="email"
                  value={draft.email}
                  onChange={(value) => setDraft({ ...draft, email: value })}
                />
                <Field
                  label="Phone"
                  value={draft.phone}
                  onChange={(value) => setDraft({ ...draft, phone: value })}
                />
                <div className="space-y-2">
                  <Label htmlFor="contact-company">Company</Label>
                  <select
                    id="contact-company"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={draft.company_id}
                    onChange={(event) =>
                      setDraft({ ...draft, company_id: event.target.value })
                    }
                  >
                    <option value="">No company</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3">
                  <Label htmlFor="contact-blocked">Blocked</Label>
                  <Switch
                    id="contact-blocked"
                    checked={draft.blocked}
                    onCheckedChange={(blocked) =>
                      setDraft({ ...draft, blocked })
                    }
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label>Custom attributes</Label>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        custom_attributes: [
                          ...draft.custom_attributes,
                          { id: crypto.randomUUID(), key: "", value: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add attribute
                  </Button>
                </div>
                {draft.custom_attributes.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No custom attributes on this contact.
                  </p>
                ) : (
                  draft.custom_attributes.map((attribute, index) => (
                    <div
                      className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                      key={attribute.id}
                    >
                      <Input
                        aria-label={`Attribute ${index + 1} name`}
                        placeholder="Attribute name"
                        value={attribute.key}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            custom_attributes: draft.custom_attributes.map(
                              (item) =>
                                item.id === attribute.id
                                  ? { ...item, key: event.target.value }
                                  : item
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label={`Attribute ${index + 1} value`}
                        placeholder="Value"
                        value={attribute.value}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            custom_attributes: draft.custom_attributes.map(
                              (item) =>
                                item.id === attribute.id
                                  ? { ...item, value: event.target.value }
                                  : item
                            ),
                          })
                        }
                      />
                      <Button
                        aria-label={`Remove attribute ${index + 1}`}
                        size="icon"
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            custom_attributes: draft.custom_attributes.filter(
                              (item) => item.id !== attribute.id
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={busy || !draft.external_user_id.trim()}
                  onClick={() => void save()}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save contact
                </Button>
              </div>
            </Card>
            {selectedId && (
              <Card className="space-y-4 p-5">
                <div>
                  <h2 className="text-lg font-semibold">
                    Private contact notes
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Notes are visible only to dashboard operators.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={note}
                    maxLength={8000}
                    placeholder="Add context for the support team"
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <Button
                    disabled={!note.trim()}
                    onClick={() => void addNote()}
                  >
                    Add note
                  </Button>
                </div>
                <div className="space-y-2">
                  {notes.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 rounded-md border p-3"
                    >
                      <div>
                        <p className="whitespace-pre-wrap text-sm">
                          {item.content}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.created_by} ·{" "}
                          {new Date(item.created_at).toLocaleString("en")}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete note"
                        onClick={() => void removeNote(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {selectedId && (
              <Card className="space-y-4 p-5">
                <div>
                  <h2 className="text-lg font-semibold">
                    Conversation history
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Recent Support conversations for this customer identity.
                  </p>
                </div>
                <div className="space-y-2">
                  {conversations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No conversations yet.
                    </p>
                  ) : (
                    conversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        className="flex items-center justify-between rounded-md border p-3"
                      >
                        <div>
                          <p className="font-medium">
                            {conversation.subject || "Support conversation"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {conversation.priority} priority ·{" "}
                            {new Date(conversation.updated_at).toLocaleString(
                              "en"
                            )}
                          </p>
                        </div>
                        <Badge variant="outline">{conversation.status}</Badge>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Building2 className="h-5 w-5" />
              Companies
            </h2>
            <p className="text-sm text-muted-foreground">
              Create reusable company records and associate contacts through the
              selector above.
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <Input
              placeholder="Company name"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
            <Input
              placeholder="Domain (optional)"
              value={companyDomain}
              onChange={(event) => setCompanyDomain(event.target.value)}
            />
            <Button
              disabled={busy || !companyName.trim()}
              onClick={() => void addCompany()}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create company
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {companies.map((company) => (
              <div key={company.id} className="rounded-md border p-3">
                <p className="font-medium">{company.name}</p>
                <p className="text-xs text-muted-foreground">
                  {company.domain || "No domain"} · {company.contact_count || 0}{" "}
                  contacts
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  const id = `contact-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
