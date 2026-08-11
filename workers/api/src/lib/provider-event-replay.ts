import { isBillingQueueJob, type BillingQueueJob } from "./billing-dispatch";

function replayError(message: string) {
  return Object.assign(new Error(message), {
    code: "provider_event_replay_unavailable",
    status: 409,
    retryable: false,
  });
}

function required(value: unknown, maxLength = 1_048_576) {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

export function providerEventReplayJob(params: {
  eventId: string;
  projectId: string;
  store: string;
  environment: string;
  jobPayload: unknown;
}): BillingQueueJob {
  let stored: unknown = params.jobPayload;
  if (typeof stored === "string") {
    try {
      stored = JSON.parse(stored);
    } catch {
      throw replayError("Provider event replay data is unavailable");
    }
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw replayError("Provider event replay data is invalid");
  }
  const candidate = stored as Record<string, unknown>;
  const expectedTypes = params.store === 'google'
    ? new Set(['billing.google.notification', 'billing.google.refund.review'])
    : new Set([`billing.${params.store}.notification`]);
  if (!expectedTypes.has(String(candidate.type)))
    throw replayError("Provider event replay data does not match its provider");
  if (candidate.type === "billing.apple.notification") {
    if (
      candidate.projectId !== params.projectId ||
      candidate.environment !== params.environment ||
      !required(candidate.signedPayload)
    ) {
      throw replayError("Apple provider event replay data is invalid");
    }
  } else if (candidate.type === "billing.google.notification") {
    const environment =
      candidate.environment === undefined
        ? params.environment
        : candidate.environment;
    if (
      candidate.projectId !== params.projectId ||
      !required(candidate.purchaseToken, 4096) ||
      !required(candidate.productId, 512) ||
      !required(candidate.eventType, 255) ||
      !required(candidate.eventOccurredAt, 100) ||
      environment !== params.environment ||
      !["subscription", "non_consumable", "consumable"].includes(
        String(candidate.productType),
      )
    ) {
      throw replayError("Google provider event replay data is invalid");
    }
    Object.assign(candidate, { environment });
  } else if (candidate.type === "billing.google.refund.review") {
    if (
      candidate.projectId !== params.projectId ||
      candidate.environment !== params.environment ||
      !required(candidate.eventOccurredAt, 100)
    ) {
      throw replayError("Google refund review replay data is invalid");
    }
  } else {
    throw replayError("Provider event replay type is unsupported");
  }
  const replay = { ...candidate, eventId: params.eventId };
  if (!isBillingQueueJob(replay))
    throw replayError("Provider event replay data is invalid");
  return replay;
}
