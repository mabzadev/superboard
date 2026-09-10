#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputFlag = process.argv.indexOf("--input");
const outputFlag = process.argv.indexOf("--output");
if (inputFlag < 0 || !process.argv[inputFlag + 1]) {
  throw new Error("Usage: generate-reference-routes.mjs --input <rails-routes.json> [--output <manifest.json>]");
}
const source = JSON.parse(await readFile(resolve(process.argv[inputFlag + 1]), "utf8"));
if (!Array.isArray(source)) throw new Error("The route export must be a JSON array");

const routes = source.map((route) => {
  const canonical = {
    name: route.name ?? null,
    verb: String(route.verb || "ANY"),
    path: String(route.path || ""),
    controller: route.controller == null ? null : String(route.controller),
    action: route.action == null ? null : String(route.action),
    internal: route.internal === true,
  };
  const mapping = mapRoute(canonical);
  return {
    fingerprint: sha256(JSON.stringify(canonical)),
    ...canonical,
    ...mapping,
  };
});

const manifest = {
  schema_version: 1,
  internal_only: true,
  reference_commit: "0ea73ad7191d6da480b728621774ca1ead53d2bb",
  route_method_count: routes.length,
  canonical_route_sha256: sha256(JSON.stringify(source)),
  routes,
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
if (outputFlag >= 0 && process.argv[outputFlag + 1]) {
  await writeFile(resolve(process.argv[outputFlag + 1]), serialized);
} else {
  process.stdout.write(serialized);
}

function mapRoute(route) {
  const value = `${route.controller || ""} ${route.path} ${route.action || ""}`.toLowerCase();
  if (route.internal || matches(value, ["rails/", "action_mailbox", "active_storage", "/rails/"])) {
    return mapped("framework-internal", "excluded", "framework-internal");
  }
  if (matches(value, ["campaign", "stripe", "billing", "subscription", "plan", "checkout"])) {
    return mapped("marketing-and-billing", "excluded", "authority-boundary");
  }
  if (matches(value, ["devise", "auth/", "profile", "saml", "account_users", "access_tokens", "users/"])) {
    return mapped("identity-access", "delegated", "identity");
  }
  if (matches(value, ["captain", "copilot", "assistant_responses", "agent_bots"])) {
    return mapped("captain", "implemented", "captain");
  }
  if (matches(value, ["portals", "articles", "categories", "help_center", "custom_domains"])) {
    return mapped("help-center", "implemented", "help-center");
  }
  if (matches(value, ["automation", "assignment_policies", "sla", "working_hours"])) {
    return mapped("automations-sla", "implemented", "automation-sla");
  }
  if (matches(value, ["contacts", "companies", "contact_inboxes", "contact_merge", "custom_attribute", "custom_filter", "labels"])) {
    return mapped("contacts-companies", "implemented", "contacts");
  }
  if (matches(value, ["agent_capacity", "assignable_agents", "inbox_members", "team_members", "/teams", "/agents", "custom_roles", "inboxes/"])) {
    return mapped("workforce", "implemented", "workforce");
  }
  if (matches(value, ["notification", "push_diagnostics"])) {
    return mapped("notifications", "delegated", "notifications");
  }
  if (matches(value, ["active_storage", "upload", "slack_uploads", "attachments"])) {
    return mapped("attachments", "implemented", "attachments");
  }
  if (matches(value, ["webhooks", "callbacks", "twilio", "whatsapp", "instagram", "telegram", "line", "tiktok", "twitter", "microsoft", "google", "email", "sms", "voice"])) {
    return mapped("channels-providers", "implemented", "channels");
  }
  if (matches(value, ["integrations", "dashboard_apps", "linear", "notion", "shopify", "dyte", "conference"])) {
    return mapped("integrations", "implemented", "integrations");
  }
  if (matches(value, ["survey", "csat", "reports", "reporting", "audit_logs", "metrics", "health", "swagger"])) {
    return mapped("operations-reporting", "implemented", "operations-reporting");
  }
  if (matches(value, ["widget", "public/api", "platform/api", "api/v1/auth", "notification_subscriptions"])) {
    return mapped("widget-client", "implemented", "client-widget");
  }
  if (matches(value, ["conversations", "messages", "canned_responses", "macros", "bulk_actions", "search"])) {
    return mapped("inbox-conversations", "implemented", "inbox-conversations");
  }
  if (matches(value, ["super_admin", "installation", "dashboard", "accounts", "android_app", "apple_app", "settings", "api#index", "root"])) {
    return mapped("grow-administration", "delegated", "grow-administration");
  }
  return mapped("grow-administration", "delegated", "explicit-platform-remainder");
}

function matches(value, fragments) {
  return fragments.some((fragment) => value.includes(fragment));
}
function mapped(capability, disposition, mappingRule) {
  return { capability, disposition, mapping_rule: mappingRule };
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
