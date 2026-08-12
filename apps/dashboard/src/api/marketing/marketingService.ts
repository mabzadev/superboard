import { DELETE, GET, PATCH, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

const path = (projectRef: string, resource: string) =>
  `${config.apiPath}/marketing/projects/${projectRef}${resource}`;
const data = <T>(response: { data: T | { data: T } }): T =>
  response.data && typeof response.data === "object" && "data" in response.data
    ? (response.data as { data: T }).data
    : (response.data as T);

export type EmailSubscriber = {
  id: string;
  email: string;
  name?: string | null;
  status: string;
  consent_status?: string;
  consent_source?: string;
  attributes?: Record<string, unknown>;
  list_ids?: string[];
  created_at?: string;
};
export type SubscriberList = {
  id: string;
  name: string;
  description?: string | null;
  visibility: string;
  optin_mode: string;
  subscriber_count?: number;
};
export type SubscriberSegment = {
  id: string;
  name: string;
  rules: Record<string, unknown>;
  subscriber_count?: number;
  refreshed_at?: string | null;
};
export type EmailTemplate = {
  id: string;
  name: string;
  template_type: string;
  subject?: string | null;
  content_html?: string | null;
  content_markdown?: string | null;
  content_text?: string | null;
};
export type MarketingMedia = {
  id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at?: string;
};
export type EmailCampaign = {
  id: string;
  name: string;
  subject: string;
  status: string;
  content_html?: string | null;
  content_text?: string | null;
  template_id?: string | null;
  list_ids?: string[];
  segment_ids?: string[];
  smtp_profile_id?: string | null;
  tracking_enabled?: boolean;
  recipient_count?: number;
  delivered_count?: number;
  sent_count?: number;
  scheduled_at?: string | null;
  updated_at?: string;
};
export type MarketingStatistics = {
  totals: Record<string, number>;
  series: Array<Record<string, unknown>>;
};
export type SmtpSettings = {
  id?: string;
  name?: string;
  configured: boolean;
  host?: string;
  port?: number;
  security?: string;
  username?: string | null;
  from_email?: string;
  from_name?: string | null;
  reply_to?: string | null;
  priority?: number;
  enabled?: boolean;
  hourly_quota?: number | null;
  daily_quota?: number | null;
  dkim_selector?: string | null;
  authentication_status?: "unverified" | "verified" | "failed";
  spf_status?: "verified" | "missing" | null;
  dkim_status?: "verified" | "missing" | "unconfigured" | null;
  dmarc_status?: "verified" | "missing" | null;
  authentication_checked_at?: string | null;
  last_tested_at?: string | null;
  last_test_status?: string | null;
  profiles?: SmtpSettings[];
};
export type ProviderWebhook = {
  id: string;
  provider: string;
  enabled: boolean;
  configured?: boolean;
  created_at?: string;
};
export type DeliveryOutboxItem = {
  id: string;
  job_type: string;
  resource_id: string;
  status: string;
  attempt_count: number;
  last_error?: string | null;
  created_at: string;
};
export type MarketingDeadLetter = {
  id: string;
  source_queue: string;
  queue_message_id: string;
  job_type: string | null;
  resource_id: string | null;
  replayable: boolean;
  attempts: number;
  status: "quarantined" | "discarded";
  resolution: "replayed" | "discarded" | null;
  received_at: string;
  resolved_at: string | null;
};
export type SubscriberExport = {
  subscriber: EmailSubscriber;
  memberships: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
};
export type JourneyCondition = {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "starts_with"
    | "exists"
    | "in"
    | "greater_than"
    | "greater_or_equal"
    | "less_than"
    | "less_or_equal";
  value?: unknown;
};
export type JourneyTrigger = {
  event_name: string;
  conditions: JourneyCondition[];
};
export type JourneyNode = {
  id: string;
  type: "email" | "channel" | "delay" | "branch" | "update_attribute" | "exit";
  template_id?: string;
  smtp_profile_id?: string;
  connector_id?: string;
  delay_seconds?: number;
  condition?: JourneyCondition;
  attributes?: Record<string, unknown>;
};
export type JourneyDefinition = {
  start_node_id: string;
  nodes: JourneyNode[];
  edges: Array<{
    from: string;
    to: string;
    outcome: "default" | "true" | "false";
  }>;
};
export type MarketingJourney = {
  id: string;
  name: string;
  description?: string | null;
  status: "draft" | "active" | "paused" | "archived";
  trigger_event_name: string;
  trigger: JourneyTrigger;
  definition: JourneyDefinition;
  current_version: number;
  reentry_policy: "once" | "after_completion" | "every_event";
  entry_segment_id?: string | null;
  enrollments_total?: number;
  enrollments_active?: number;
  enrollments_completed?: number;
  created_at: string;
  updated_at: string;
};
export type JourneyEnrollment = {
  id: string;
  journey_id: string;
  journey_version: number;
  subscriber_id: string;
  email?: string;
  name?: string | null;
  current_node_id: string;
  status: string;
  context: Record<string, unknown>;
  enrolled_at: string;
  completed_at?: string | null;
};
export type JourneyStatistics = {
  enrollments: number;
  active: number;
  completed: number;
  failed: number;
  steps_completed: number;
  messages_sent: number;
};
export type MarketingChannelConnector = {
  id: string;
  name: string;
  channel: "webhook" | "sms" | "push" | "whatsapp" | "slack";
  endpoint_url: string;
  headers: Record<string, string>;
  enabled: boolean;
  secret_configured: boolean;
  created_at: string;
  updated_at: string;
};

export async function getEmailSubscribers(projectRef: string, query = "") {
  return data<EmailSubscriber[]>(
    await GET(
      `${path(projectRef, "/email/subscribers")}${query ? `?q=${encodeURIComponent(query)}` : ""}`
    )
  );
}
export async function getEmailSubscriber(projectRef: string, id: string) {
  return data<EmailSubscriber>(
    await GET(path(projectRef, `/email/subscribers/${id}`))
  );
}
export async function getEmailSubscriberExport(projectRef: string, id: string) {
  return data<SubscriberExport>(
    await GET(path(projectRef, `/email/subscribers/${id}/export`))
  );
}
export async function createEmailSubscriber(
  projectRef: string,
  payload: Record<string, unknown>
) {
  return data<EmailSubscriber>(
    await POST(path(projectRef, "/email/subscribers"), payload)
  );
}
export async function updateEmailSubscriber(
  projectRef: string,
  id: string,
  payload: Record<string, unknown>
) {
  return data<EmailSubscriber>(
    await PATCH(path(projectRef, `/email/subscribers/${id}`), payload)
  );
}
export async function suppressEmailSubscriber(
  projectRef: string,
  id: string,
  action: "blocklist" | "unsubscribe"
) {
  return data<EmailSubscriber>(
    await POST(path(projectRef, `/email/subscribers/${id}/${action}`), {})
  );
}
export async function deleteEmailSubscriber(projectRef: string, id: string) {
  return data(await DELETE(path(projectRef, `/email/subscribers/${id}`)));
}
export async function importEmailSubscribers(
  projectRef: string,
  subscribers: Array<Record<string, unknown>>
) {
  return data<{
    received: number;
    processed: number;
    created: number;
    updated: number;
  }>(
    await POST(path(projectRef, "/email/subscribers-import"), { subscribers })
  );
}
export async function exportEmailSubscribers(projectRef: string) {
  return (
    await GET(`${path(projectRef, "/email/subscribers-export")}?format=csv`, {
      responseType: "blob",
    })
  ).data as Blob;
}

export async function getSubscriberLists(projectRef: string) {
  return data<SubscriberList[]>(await GET(path(projectRef, "/lists")));
}
export async function createSubscriberList(
  projectRef: string,
  payload: Record<string, unknown>
) {
  return data<SubscriberList>(await POST(path(projectRef, "/lists"), payload));
}
export async function updateSubscriberList(
  projectRef: string,
  id: string,
  payload: Record<string, unknown>
) {
  return data<SubscriberList>(
    await PATCH(path(projectRef, `/lists/${id}`), payload)
  );
}
export async function deleteSubscriberList(projectRef: string, id: string) {
  return data(await DELETE(path(projectRef, `/lists/${id}`)));
}
export async function addSubscriberToList(
  projectRef: string,
  listId: string,
  subscriberId: string
) {
  return data(
    await PUT(
      path(projectRef, `/lists/${listId}/subscribers/${subscriberId}`),
      {}
    )
  );
}
export async function removeSubscriberFromList(
  projectRef: string,
  listId: string,
  subscriberId: string
) {
  return data(
    await DELETE(
      path(projectRef, `/lists/${listId}/subscribers/${subscriberId}`)
    )
  );
}
export async function getSubscriberSegments(projectRef: string) {
  return data<SubscriberSegment[]>(await GET(path(projectRef, "/segments")));
}
export async function createSubscriberSegment(
  projectRef: string,
  payload: Record<string, unknown>
) {
  return data<SubscriberSegment>(
    await POST(path(projectRef, "/segments"), payload)
  );
}
export async function updateSubscriberSegment(
  projectRef: string,
  id: string,
  payload: Record<string, unknown>
) {
  return data<SubscriberSegment>(
    await PATCH(path(projectRef, `/segments/${id}`), payload)
  );
}
export async function refreshSubscriberSegment(projectRef: string, id: string) {
  return data<{ subscriber_count: number }>(
    await POST(path(projectRef, `/segments/${id}/refresh`), {})
  );
}
export async function deleteSubscriberSegment(projectRef: string, id: string) {
  return data(await DELETE(path(projectRef, `/segments/${id}`)));
}

export async function getEmailTemplates(projectRef: string) {
  return data<EmailTemplate[]>(await GET(path(projectRef, "/templates")));
}
export async function createEmailTemplate(
  projectRef: string,
  payload: Record<string, unknown>
) {
  return data<EmailTemplate>(
    await POST(path(projectRef, "/templates"), payload)
  );
}
export async function updateEmailTemplate(
  projectRef: string,
  id: string,
  payload: Record<string, unknown>
) {
  return data<EmailTemplate>(
    await PATCH(path(projectRef, `/templates/${id}`), payload)
  );
}
export async function deleteEmailTemplate(projectRef: string, id: string) {
  return data(await DELETE(path(projectRef, `/templates/${id}`)));
}
export async function getMarketingMedia(projectRef: string) {
  return data<MarketingMedia[]>(await GET(path(projectRef, "/media")));
}
export async function uploadMarketingMedia(projectRef: string, file: File) {
  return data<MarketingMedia>(
    await POST(path(projectRef, "/media"), file, {
      retry: false,
      headers: { "Content-Type": file.type, "X-Filename": file.name },
    })
  );
}
export async function downloadMarketingMedia(projectRef: string, id: string) {
  return (await GET(path(projectRef, `/media/${id}`), { responseType: "blob" }))
    .data as Blob;
}
export async function deleteMarketingMedia(projectRef: string, id: string) {
  return data(await DELETE(path(projectRef, `/media/${id}`)));
}

export async function getEmailCampaigns(projectRef: string) {
  return data<EmailCampaign[]>(await GET(path(projectRef, "/campaigns")));
}
export async function getEmailCampaign(projectRef: string, id: string) {
  return data<EmailCampaign>(await GET(path(projectRef, `/campaigns/${id}`)));
}
export async function createEmailCampaign(
  projectRef: string,
  payload: Record<string, unknown>
) {
  return data<EmailCampaign>(
    await POST(path(projectRef, "/campaigns"), payload)
  );
}
export async function updateEmailCampaign(
  projectRef: string,
  id: string,
  payload: Record<string, unknown>
) {
  return data<EmailCampaign>(
    await PATCH(path(projectRef, `/campaigns/${id}`), payload)
  );
}
export async function transitionEmailCampaign(
  projectRef: string,
  id: string,
  transition: "start" | "pause" | "resume" | "cancel" | "archive",
  payload: Record<string, unknown> = {}
) {
  return data<EmailCampaign>(
    await POST(path(projectRef, `/campaigns/${id}/${transition}`), payload)
  );
}
export async function scheduleEmailCampaign(
  projectRef: string,
  id: string,
  scheduledAt: string
) {
  return data<EmailCampaign>(
    await POST(path(projectRef, `/campaigns/${id}/schedule`), {
      scheduled_at: scheduledAt,
    })
  );
}
export async function testEmailCampaign(
  projectRef: string,
  id: string,
  recipient: string
) {
  return data<{ ok: boolean; message_id: string }>(
    await POST(path(projectRef, `/campaigns/${id}/test`), { recipient })
  );
}
export async function sendTransactionalEmail(
  projectRef: string,
  payload: Record<string, unknown>
) {
  return data<{ campaign_id: string; delivery_id: string; status: string }>(
    await POST(path(projectRef, "/transactional"), payload)
  );
}

export async function getMarketingStatistics(
  projectRef: string,
  filters: Record<string, string> = {}
) {
  const query = new URLSearchParams(filters);
  return data<MarketingStatistics>(
    await GET(
      `${path(projectRef, "/statistics")}${query.size ? `?${query}` : ""}`
    )
  );
}
export async function getSmtpSettings(projectRef: string) {
  return data<SmtpSettings>(await GET(path(projectRef, "/settings/smtp")));
}
export async function saveSmtpSettings(
  projectRef: string,
  payload: Record<string, unknown>
) {
  return data<SmtpSettings>(
    await PUT(path(projectRef, "/settings/smtp"), payload)
  );
}
export async function deleteSmtpSettings(projectRef: string, id: string) {
  return data(await DELETE(path(projectRef, `/settings/smtp/${id}`)));
}
export async function testSmtpSettings(
  projectRef: string,
  profileId?: string,
  recipient?: string
) {
  return data<{ ok: boolean; message?: string }>(
    await POST(path(projectRef, "/settings/smtp/test"), {
      profile_id: profileId,
      recipient,
    })
  );
}
export async function verifySmtpDomain(projectRef: string, profileId: string) {
  return data<{
    domain: string;
    dkimSelector: string | null;
    spf: "verified" | "missing";
    dkim: "verified" | "missing" | "unconfigured";
    dmarc: "verified" | "missing";
    ready: boolean;
    checkedAt: string;
  }>(
    await POST(
      path(projectRef, `/settings/smtp/${profileId}/verify-domain`),
      {}
    )
  );
}
export async function getProviderWebhooks(projectRef: string) {
  return data<ProviderWebhook[]>(
    await GET(path(projectRef, "/settings/provider-webhooks"))
  );
}
export async function createProviderWebhook(
  projectRef: string,
  payload: Record<string, unknown>
) {
  return data<ProviderWebhook>(
    await POST(path(projectRef, "/settings/provider-webhooks"), payload)
  );
}
export async function deleteProviderWebhook(projectRef: string, id: string) {
  return data(
    await DELETE(path(projectRef, `/settings/provider-webhooks/${id}`))
  );
}
export async function getDeliveryOutbox(projectRef: string) {
  return data<DeliveryOutboxItem[]>(
    await GET(path(projectRef, "/settings/delivery-outbox"))
  );
}
export async function retryDeliveryOutbox(projectRef: string, id: string) {
  return data<{ queued: boolean }>(
    await POST(path(projectRef, `/settings/delivery-outbox/${id}/retry`), {})
  );
}
export async function getMarketingDeadLetters(projectRef: string) {
  return data<MarketingDeadLetter[]>(
    await GET(path(projectRef, "/settings/dead-letters"))
  );
}
export async function replayMarketingDeadLetter(
  projectRef: string,
  id: string
) {
  return data<{ id: string; status: "replayed"; job_type: string }>(
    await POST(path(projectRef, `/settings/dead-letters/${id}/replay`), {})
  );
}
export async function discardMarketingDeadLetter(
  projectRef: string,
  id: string
) {
  return data<{ id: string; status: "discarded" }>(
    await POST(path(projectRef, `/settings/dead-letters/${id}/discard`), {})
  );
}
export async function getMarketingAudit(projectRef: string) {
  return data<Array<Record<string, unknown>>>(
    await GET(path(projectRef, "/audit"))
  );
}

export async function getMarketingJourneys(projectRef: string) {
  return data<MarketingJourney[]>(await GET(path(projectRef, "/journeys")));
}

export async function getMarketingJourney(projectRef: string, id: string) {
  return data<MarketingJourney & { versions: Array<Record<string, unknown>> }>(
    await GET(path(projectRef, `/journeys/${id}`))
  );
}

export type MarketingJourneyInput = Pick<
  MarketingJourney,
  "name" | "trigger" | "definition" | "reentry_policy"
> & {
  description?: string | null;
  entry_segment_id?: string | null;
};

export async function createMarketingJourney(
  projectRef: string,
  payload: MarketingJourneyInput
) {
  return data<MarketingJourney>(
    await POST(path(projectRef, "/journeys"), payload)
  );
}

export async function updateMarketingJourney(
  projectRef: string,
  id: string,
  payload: MarketingJourneyInput
) {
  return data<MarketingJourney>(
    await PATCH(path(projectRef, `/journeys/${id}`), payload)
  );
}

export async function transitionMarketingJourney(
  projectRef: string,
  id: string,
  transition: "activate" | "pause" | "resume" | "archive"
) {
  return data<MarketingJourney>(
    await POST(path(projectRef, `/journeys/${id}/${transition}`), {})
  );
}

export async function getJourneyEnrollments(projectRef: string, id: string) {
  return data<JourneyEnrollment[]>(
    await GET(path(projectRef, `/journeys/${id}/enrollments`))
  );
}

export async function enrollJourneySubscribers(
  projectRef: string,
  id: string,
  subscriberIds: string[],
  context: Record<string, unknown> = {}
) {
  return data<{ requested: number; enrolled: number }>(
    await POST(path(projectRef, `/journeys/${id}/enrollments`), {
      subscriber_ids: subscriberIds,
      context,
    })
  );
}

export async function getJourneyStatistics(projectRef: string, id: string) {
  return data<JourneyStatistics>(
    await GET(path(projectRef, `/journeys/${id}/statistics`))
  );
}

export async function getMarketingChannelConnectors(projectRef: string) {
  return data<MarketingChannelConnector[]>(
    await GET(path(projectRef, "/channel-connectors"))
  );
}

export type MarketingChannelConnectorInput = Pick<
  MarketingChannelConnector,
  "name" | "channel" | "endpoint_url" | "enabled"
> & {
  headers: Record<string, string>;
  secret?: string;
};

export async function createMarketingChannelConnector(
  projectRef: string,
  payload: MarketingChannelConnectorInput
) {
  return data<MarketingChannelConnector>(
    await POST(path(projectRef, "/channel-connectors"), payload)
  );
}

export async function updateMarketingChannelConnector(
  projectRef: string,
  id: string,
  payload: Partial<MarketingChannelConnectorInput>
) {
  return data<MarketingChannelConnector>(
    await PATCH(path(projectRef, `/channel-connectors/${id}`), payload)
  );
}

export async function deleteMarketingChannelConnector(
  projectRef: string,
  id: string
) {
  return data<{ deleted: boolean }>(
    await DELETE(path(projectRef, `/channel-connectors/${id}`))
  );
}
