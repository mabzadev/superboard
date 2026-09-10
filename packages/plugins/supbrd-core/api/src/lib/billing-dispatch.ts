import type { BillingEnv } from "../types";
import { processBillingExport } from "./billing-exports";
import {
  deliverBillingWebhook,
  processAppleBillingNotification,
  processGoogleBillingNotification,
  processGooglePendingRefundReview,
  reconcileBillingState,
  reconcileStoreSubscription,
} from "./billing-jobs";
import { executeRefundProviderAction } from "./refund-actions";
import { processLegacyInventoryPage } from "./legacy-subscription-inventory";
import { reconcileGoogleVoidedPurchases } from "./google-voided-purchases";

export type BillingQueueJob =
  | { type: "billing.reconcile" }
  | { type: "billing.webhook.deliver"; deliveryId: string }
  | {
      type: "billing.apple.notification";
      eventId: string;
      projectId: string;
      signedPayload: string;
      environment: "sandbox" | "production";
    }
  | {
      type: "billing.google.notification";
      eventId: string;
      projectId: string;
      purchaseToken: string;
      productId: string;
      productType: "subscription" | "non_consumable" | "consumable";
      eventType: string;
      eventOccurredAt: string;
      environment: "sandbox" | "production";
    }
  | {
      type: "billing.google.refund.review";
      eventId: string;
      projectId: string;
      eventOccurredAt: string;
      environment: "sandbox" | "production";
    }
  | { type: "billing.google.voided.reconcile"; projectId: string }
  | { type: "billing.subscription.reconcile"; subscriptionId: string }
  | { type: "billing.refund.action.execute"; actionId: string }
  | { type: "billing.legacy.inventory.page"; runId: string; cursor?: string }
  | { type: "billing.export"; exportId: string };

export function isBillingQueueJob(value: unknown): value is BillingQueueJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  switch (job.type) {
    case "billing.reconcile":
      return true;
    case "billing.webhook.deliver":
      return nonEmptyString(job.deliveryId);
    case "billing.apple.notification":
      return (
        hasStrings(job, "eventId", "projectId", "signedPayload") &&
        environment(job.environment)
      );
    case "billing.google.notification":
      return (
        hasStrings(
          job,
          "eventId",
          "projectId",
          "purchaseToken",
          "productId",
          "eventType",
          "eventOccurredAt",
        ) &&
        productType(job.productType) &&
        environment(job.environment)
      );
    case "billing.google.refund.review":
      return hasStrings(job, "eventId", "projectId", "eventOccurredAt") && environment(job.environment);
    case "billing.google.voided.reconcile":
      return nonEmptyString(job.projectId);
    case "billing.subscription.reconcile":
      return nonEmptyString(job.subscriptionId);
    case "billing.refund.action.execute":
      return nonEmptyString(job.actionId);
    case "billing.legacy.inventory.page":
      return (
        nonEmptyString(job.runId) &&
        (job.cursor === undefined || nonEmptyString(job.cursor))
      );
    case "billing.export":
      return nonEmptyString(job.exportId);
    default:
      return false;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasStrings(value: Record<string, unknown>, ...keys: string[]) {
  return keys.every((key) => nonEmptyString(value[key]));
}

function environment(value: unknown): value is "sandbox" | "production" {
  return value === "sandbox" || value === "production";
}

function productType(
  value: unknown,
): value is "subscription" | "non_consumable" | "consumable" {
  return (
    value === "subscription" ||
    value === "non_consumable" ||
    value === "consumable"
  );
}

export async function dispatchBillingJob(
  env: BillingEnv,
  job: BillingQueueJob,
) {
  switch (job.type) {
    case "billing.reconcile":
      return reconcileBillingState(env);
    case "billing.webhook.deliver":
      return deliverBillingWebhook(env, String(job.deliveryId));
    case "billing.apple.notification":
      return processAppleBillingNotification(env, job);
    case "billing.google.notification":
      return processGoogleBillingNotification(env, job);
    case "billing.google.refund.review":
      return processGooglePendingRefundReview(env, job);
    case "billing.google.voided.reconcile":
      return reconcileGoogleVoidedPurchases(env, String(job.projectId));
    case "billing.subscription.reconcile":
      return reconcileStoreSubscription(env, String(job.subscriptionId));
    case "billing.refund.action.execute":
      return executeRefundProviderAction(env, String(job.actionId));
    case "billing.legacy.inventory.page":
      return processLegacyInventoryPage(
        env,
        String(job.runId),
        job.cursor ? String(job.cursor) : undefined,
      );
    case "billing.export":
      return processBillingExport(env, String(job.exportId));
    default:
      throw new Error(
        `Unsupported billing queue job: ${(job as { type?: string }).type || "unknown"}`,
      );
  }
}
