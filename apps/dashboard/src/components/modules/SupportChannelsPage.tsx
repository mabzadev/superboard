"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cable, KeyRound, Link2, Plus, Trash2 } from "lucide-react";
import {
  createSupportProvider,
  deleteSupportProvider,
  listSupportChannels,
  listSupportProviders,
  saveSupportProviderCredentials,
  startSupportProviderOAuth,
  type SupportChannel,
  type SupportProviderEndpoint,
} from "@/api/support/channelsService";
import {
  listSupportInboxes,
  type SupportInbox,
} from "@/api/support/workforceService";
import { config } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";
import {
  AccessNotice,
  SupportEmpty,
  SupportError,
  SupportLoadMore,
  SupportLoading,
  SupportSearchToolbar,
  SupportStatus,
  useSupportCollection,
} from "@/components/support/SupportUi";

const providerLabels: Record<string, string> = {
  widget: "Web widget",
  api: "Support API",
  email_google: "Google email",
  email_microsoft: "Microsoft email",
  smtp: "SMTP email",
  whatsapp_cloud: "WhatsApp Cloud",
  facebook_messenger: "Facebook Messenger",
  instagram: "Instagram",
  twilio_sms: "Twilio SMS",
  twilio_voice: "Twilio Voice",
  whatsapp_calls: "WhatsApp Calls",
  telegram: "Telegram",
  line: "LINE",
  tiktok: "TikTok",
  twitter: "X",
};

const credentialFields: Record<string, string[]> = {
  widget: ["widget_key", "signing_secret", "allowed_domains"],
  email_google: ["client_id", "client_secret"],
  email_microsoft: ["client_id", "client_secret"],
  smtp: ["host", "port", "username", "password", "from_email"],
  whatsapp_cloud: [
    "access_token",
    "verify_token",
    "app_secret",
    "phone_number_id",
  ],
  facebook_messenger: [
    "page_access_token",
    "verify_token",
    "app_secret",
    "page_id",
  ],
  instagram: [
    "access_token",
    "verify_token",
    "app_secret",
    "instagram_id",
  ],
  twilio_sms: ["account_sid", "auth_token", "from_number"],
  twilio_voice: [
    "account_sid",
    "auth_token",
    "from_number",
    "status_callback_url",
  ],
  whatsapp_calls: ["access_token", "app_secret", "phone_number_id"],
  telegram: ["bot_token", "webhook_secret"],
  line: ["channel_access_token", "channel_secret"],
  tiktok: ["client_key", "client_secret"],
  twitter: ["client_id", "client_secret"],
};

const oauthProviders = new Set([
  "email_google",
  "email_microsoft",
  "facebook_messenger",
  "instagram",
  "tiktok",
  "twitter",
]);

export default function SupportChannelsPage() {
  const { selectedProject, selectedInstance } = useProjectSelection();
  const projectRef = selectedProject?.id;
  const canManageCredentials = new Set(["owner", "admin"]).has(
    selectedInstance?.role || "member"
  );
  const providers = useSupportCollection(projectRef, listSupportProviders);
  const inboxes = useSupportCollection<SupportInbox>(
    projectRef,
    listSupportInboxes
  );
  const [channels, setChannels] = useState<SupportChannel[]>([]);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [provider, setProvider] = useState("widget");
  const [displayName, setDisplayName] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [selectedEndpoint, setSelectedEndpoint] =
    useState<SupportProviderEndpoint | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const loadChannels = useCallback(async () => {
    if (!projectRef) return;
    try {
      setChannels((await listSupportChannels(projectRef)).data);
      setChannelError(null);
    } catch (cause) {
      setChannelError(moduleErrorMessage(cause));
    }
  }, [projectRef]);
  useEffect(() => void loadChannels(), [loadChannels]);

  const fields = useMemo(
    () =>
      selectedEndpoint
        ? (credentialFields[selectedEndpoint.provider] ?? [])
        : [],
    [selectedEndpoint]
  );

  const addProvider = async () => {
    if (!projectRef || !displayName.trim() || !inboxId) return;
    setSaving(true);
    try {
      await createSupportProvider(projectRef, {
        provider,
        display_name: displayName.trim(),
        inbox_id: inboxId,
        status: "configuration_required",
        settings: {},
      });
      setDisplayName("");
      setInboxId("");
      await Promise.all([providers.reload(), loadChannels()]);
      showSuccessNotification("Support channel created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async (endpoint: SupportProviderEndpoint) => {
    if (!projectRef || !window.confirm(`Delete ${endpoint.display_name}?`))
      return;
    try {
      await deleteSupportProvider(projectRef, endpoint.id);
      if (selectedEndpoint?.id === endpoint.id) setSelectedEndpoint(null);
      await Promise.all([providers.reload(), loadChannels()]);
      showSuccessNotification("Support channel deleted");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const saveCredentials = async () => {
    if (
      !projectRef ||
      !selectedEndpoint ||
      fields.some((field) => !credentials[field]?.trim())
    )
      return;
    setSaving(true);
    try {
      await saveSupportProviderCredentials(
        projectRef,
        selectedEndpoint.id,
        credentials
      );
      setCredentials({});
      setSelectedEndpoint(null);
      await providers.reload();
      showSuccessNotification("Credentials saved securely");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const authorizeProvider = async () => {
    if (!projectRef || !selectedEndpoint || !oauthProviders.has(selectedEndpoint.provider)) return;
    setSaving(true);
    try {
      const apiOrigin = config.apiUrl.replace(/\/+$/u, "");
      const callback = `${apiOrigin}${config.apiPath}/support/providers/${encodeURIComponent(selectedEndpoint.provider)}/oauth/callback`;
      const returnUrl = new URL("/support/channels", window.location.origin);
      returnUrl.searchParams.set("connection", selectedEndpoint.id);
      const result = await startSupportProviderOAuth(projectRef, selectedEndpoint.id, {
        callback_uri: callback,
        return_uri: returnUrl.toString(),
      });
      window.location.assign(result.data.authorization_url);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
      setSaving(false);
    }
  };

  return (
    <ModulePage
      title="Channels"
      description="Connect every customer channel to a native Support inbox."
      error={channelError}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Tabs defaultValue="channels">
          <TabsList>
            <TabsTrigger value="channels">Channels</TabsTrigger>
            <TabsTrigger value="providers">Connections</TabsTrigger>
          </TabsList>
          <TabsContent className="space-y-4" value="channels">
            {channels.length === 0 ? (
              <SupportEmpty
                title="No connected inboxes"
                description="Create an inbox from Workforce, then attach a connection here."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {channels.map((channel) => (
                  <Card key={channel.id}>
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                      <div className="flex items-center gap-3">
                        <Cable className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{channel.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {providerLabels[
                              channel.provider || channel.channel_type
                            ] || channel.channel_type}
                          </p>
                        </div>
                      </div>
                      <SupportStatus
                        value={channel.provider_status || channel.status}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent className="space-y-4" value="providers">
            <SupportSearchToolbar
              query={providers.query}
              setQuery={providers.setQuery}
              onSearch={providers.search}
              onRefresh={providers.reload}
              loading={providers.loading}
            />
            <SupportError message={providers.error} />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Add a connection</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto]">
                <div className="space-y-2">
                  <Label>Channel</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={provider}
                    onChange={(event) => {
                      setProvider(event.target.value);
                      setInboxId("");
                    }}
                  >
                    {Object.entries(providerLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Display name</Label>
                  <Input
                    placeholder="Customer care"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Inbox</Label>
                  <select
                    aria-label="Inbox"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={inboxId}
                    onChange={(event) => setInboxId(event.target.value)}
                  >
                    <option value="">Select an inbox</option>
                    {inboxes.items
                      .filter(
                        (inbox) =>
                          inbox.status === "active" &&
                          inbox.channel_type === provider
                      )
                      .map((inbox) => (
                        <option key={inbox.id} value={inbox.id}>
                          {inbox.name}
                        </option>
                      ))}
                  </select>
                  {!inboxes.loading &&
                  !inboxes.items.some(
                    (inbox) =>
                      inbox.status === "active" &&
                      inbox.channel_type === provider
                  ) ? (
                    <p className="text-xs text-muted-foreground">
                      Create an active {providerLabels[provider] || provider}{" "}
                      inbox in Workforce first.
                    </p>
                  ) : null}
                </div>
                <div className="flex items-end">
                  <Button
                    disabled={saving || !displayName.trim() || !inboxId}
                    onClick={() => void addProvider()}
                  >
                    <Plus /> Add
                  </Button>
                </div>
              </CardContent>
            </Card>
            {providers.loading ? (
              <SupportLoading />
            ) : providers.items.length === 0 ? (
              <SupportEmpty
                title="No channel connections"
                description="Add the channel your customers use to contact your team."
              />
            ) : (
              <div className="space-y-3">
                {providers.items.map((endpoint) => (
                  <Card key={endpoint.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">{endpoint.display_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {providerLabels[endpoint.provider] ||
                            endpoint.provider}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <SupportStatus value={endpoint.status} />
                        {(credentialFields[endpoint.provider]?.length ?? 0) >
                          0 && canManageCredentials ? (
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelectedEndpoint(endpoint);
                              setCredentials({});
                            }}
                          >
                            <KeyRound /> Configure
                          </Button>
                        ) : null}
                        <Button
                          aria-label={`Delete ${endpoint.display_name}`}
                          size="icon"
                          variant="ghost"
                          onClick={() => void removeProvider(endpoint)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            <SupportLoadMore
              visible={providers.hasMore}
              loading={providers.loadingMore}
              onClick={providers.loadMore}
            />
            {!canManageCredentials ? (
              <AccessNotice>
                Only project owners and administrators can replace channel
                credentials. Existing secrets remain masked.
              </AccessNotice>
            ) : null}
            {selectedEndpoint ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Secure configuration for {selectedEndpoint.display_name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Values are encrypted per project and cannot be read back
                    after saving.
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {fields.map((field) => (
                      <div className="space-y-2" key={field}>
                        <Label>{field.replaceAll("_", " ")}</Label>
                        <Input
                          autoComplete="new-password"
                          type="password"
                          value={credentials[field] || ""}
                          onChange={(event) =>
                            setCredentials((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedEndpoint(null);
                        setCredentials({});
                      }}
                    >
                      Cancel
                    </Button>
                    {oauthProviders.has(selectedEndpoint.provider) &&
                    selectedEndpoint.status !== "configuration_required" ? (
                      <Button
                        variant="outline"
                        disabled={saving}
                        onClick={() => void authorizeProvider()}
                      >
                        <Link2 /> Authorize
                      </Button>
                    ) : null}
                    <Button
                      disabled={
                        saving ||
                        fields.some((field) => !credentials[field]?.trim())
                      }
                      onClick={() => void saveCredentials()}
                    >
                      Save securely
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>
        </Tabs>
      )}
    </ModulePage>
  );
}
