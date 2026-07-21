// Human-readable formatters for MCP tool responses.
// Each formatter takes the raw API JSON and returns a concise text summary.

import type { Obj } from "./utils.js";

function val(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return String(v);
}

/**
 * Check that `data[key]` exists and is an object.
 * Returns the value if present, or undefined + appends a warning line.
 * This catches API shape changes that would otherwise silently produce em-dashes.
 */
function expectKey(data: Obj, key: string, lines: string[]): Obj | undefined {
  const v = data[key];
  if (v !== null && v !== undefined && typeof v === "object") return v as Obj;
  if (v === undefined || v === null) {
    lines.push(`⚠ Unexpected API response: missing "${key}" key.`);
    return undefined;
  }
  lines.push(`⚠ Unexpected API response: "${key}" is ${typeof v}, expected object.`);
  return undefined;
}

function expectArray(data: Obj, key: string, lines: string[]): Obj[] | undefined {
  const v = data[key];
  if (Array.isArray(v)) return v as Obj[];
  if (v === undefined || v === null) return undefined; // genuinely empty — not a shape error
  lines.push(`⚠ Unexpected API response: "${key}" is ${typeof v}, expected array.`);
  return undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function date(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function cents(v: unknown): string {
  if (v === null || v === undefined) return "$0.00";
  const n = Number(v);
  if (Number.isNaN(n)) return "$0.00";
  return `$${(n / 100).toFixed(2)}`;
}

function pct(v: unknown): string {
  if (v === null || v === undefined) return "0%";
  const n = Number(v);
  if (Number.isNaN(n)) return "0%";
  return `${(n * 100).toFixed(1)}%`;
}

function yesNo(v: unknown): string {
  return v ? "Yes" : "No";
}

const SDK_HIDDEN_FIELDS = new Set(["push_configuration", "server_api_key"]);

// ── get_status ──

export function formatStatus(data: Obj): string {
  const lines: string[] = [];
  lines.push(`# Account Overview`);
  lines.push(``);

  const user = expectKey(data, "user", lines) ?? {};
  lines.push(`User: ${val(user.name)} (${val(user.email)})`);
  lines.push(``);

  const instances = expectArray(data, "instances", lines);
  if (!instances || instances.length === 0) {
    lines.push("No projects found. Use create_project to get started.");
    return lines.join("\n");
  }

  lines.push(`| Project | Instance ID | Prod Project ID | Test Project ID | Prod Domain |`);
  lines.push(`|---------|-------------|-----------------|-----------------|-------------|`);

  for (const inst of instances) {
    const prod = inst.production as Obj | null;
    const test = inst.test as Obj | null;
    const name = prod ? val(prod.name) : val(inst.name);
    lines.push(`| ${name} | ${val(inst.id)} | ${val(prod?.id)} | ${val(test?.id)} | ${val(prod?.domain)} |`);

    const usage = inst.usage as Obj | undefined;
    if (usage && usage.quota_exceeded && !usage.has_subscription) {
      lines.push(``);
      lines.push(`WARNING: Usage exceeded (${val(usage.current_mau)}/${val(usage.mau_limit)} MAU). Your deep links are not working.`);
      lines.push(`Subscribe to a paid plan to restore service.`);
    }
  }

  return lines.join("\n");
}

// ── get_usage ──

export function formatUsage(data: Obj): string {
  const lines: string[] = [];
  lines.push(`# Usage`);
  lines.push(``);

  const usage = expectKey(data, "usage", lines);
  if (!usage) {
    lines.push("No usage data returned.");
    return lines.join("\n");
  }

  lines.push(`Current MAU: ${val(usage.current_mau)} / ${val(usage.mau_limit)}`);
  lines.push(`Quota exceeded: ${yesNo(usage.quota_exceeded)}`);
  lines.push(`Has subscription: ${yesNo(usage.has_subscription)}`);

  if (usage.quota_exceeded && !usage.has_subscription) {
    lines.push(``);
    lines.push(`WARNING: Usage exceeded. Your deep links are not working.`);
    lines.push(`Subscribe to a paid plan to restore service.`);
  }

  return lines.join("\n");
}

// ── create_project ──

export function formatCreateProject(data: Obj): string {
  const lines: string[] = [];
  lines.push(`# Project Created`);

  const inst = expectKey(data, "instance", lines) ?? {};
  const prod = inst.production as Obj | null;
  const test = inst.test as Obj | null;
  lines.push(``);
  lines.push(`Instance ID: ${val(inst.hash_id)}`);
  lines.push(`URI scheme: ${val(inst.uri_scheme)}`);
  lines.push(``);
  if (prod) lines.push(`Production project: ${val(prod.name)} (ID: ${val(prod.hash_id)})`);
  if (test) lines.push(`Test project: ${val(test.name)} (ID: ${val(test.hash_id)})`);

  return lines.join("\n");
}

// ── Link helpers ──

function formatLinkDetail(link: Obj): string {
  const lines: string[] = [];
  if (link.access_path) lines.push(`URL: ${val(link.access_path)}`);
  lines.push(`Name: ${val(link.name)} | Path: /${val(link.path)} | ID: ${val(link.id)}`);
  if (link.title) lines.push(`Title: ${val(link.title)}`);
  if (link.subtitle) lines.push(`Subtitle: ${val(link.subtitle)}`);
  if (link.tags && (link.tags as unknown[]).length > 0) {
    lines.push(`Tags: ${(link.tags as string[]).join(", ")}`);
  }
  if (link.data && Object.keys(link.data as Obj).length > 0) {
    lines.push(`Data: ${JSON.stringify(link.data)}`);
  }

  const redirects: string[] = [];
  if (link.ios_custom_redirect) redirects.push(`iOS → ${val((link.ios_custom_redirect as Obj).url)}`);
  if (link.android_custom_redirect) redirects.push(`Android → ${val((link.android_custom_redirect as Obj).url)}`);
  if (link.desktop_custom_redirect) redirects.push(`Desktop → ${val((link.desktop_custom_redirect as Obj).url)}`);
  if (redirects.length > 0) {
    lines.push(`Custom redirects: ${redirects.join(", ")}`);
  }

  return lines.join("\n");
}

// ── create_link / get_link / update_link ──

export function formatLink(data: Obj, action: string): string {
  const lines: string[] = [];
  lines.push(`# Link ${action}`);

  const link = expectKey(data, "link", lines) ?? {};
  lines.push(``);
  lines.push(formatLinkDetail(link));
  if (link.path) {
    lines.push(``);
    lines.push(`**Next steps:** Use get_link_analytics with path "${val(link.path)}" to view metrics, or search_links to list all links.`);
  }
  return lines.join("\n");
}

// ── search_links ──

export function formatSearchLinks(data: Obj): string {
  const lines: string[] = [];
  const links = expectArray(data, "links", lines);
  const meta = expectKey(data, "meta", lines) ?? {};

  lines.push(`# Links (${val(meta.total_entries)} total, page ${val(meta.page)}/${val(meta.total_pages)})`);
  lines.push(``);

  if (!links || links.length === 0) {
    lines.push("No links found.");
    return lines.join("\n");
  }

  lines.push(`| # | Name | Path | Views | Opens | Installs | Active |`);
  lines.push(`|---|------|------|-------|-------|----------|--------|`);

  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    lines.push(
      `| ${i + 1} | ${val(l.name)} | ${val(l.path)} | ${val(l.total_views)} | ${val(l.total_opens)} | ${val(l.total_installs)} | ${yesNo(l.active)} |`,
    );
  }

  return lines.join("\n");
}

// ── analytics_overview ──

function formatMetricBlock(m: Obj, label: string): string {
  const lines: string[] = [];
  lines.push(`**${label}:**`);
  lines.push(`  Views: ${val(m.views)} | Opens: ${val(m.opens)} | Installs: ${val(m.installs)}`);
  lines.push(`  App opens: ${val(m.app_opens)} | New users: ${val(m.new_users)} | Returning: ${val(m.returning_users)} (${pct(m.returning_rate)})`);
  lines.push(`  Reinstalls: ${val(m.reinstalls)} | Referred: ${val(m.referred_users)}`);
  if (Number(m.revenue) > 0 || Number(m.units_sold) > 0) {
    lines.push(`  Revenue: ${cents(m.revenue)} | Units sold: ${val(m.units_sold)} | Cancellations: ${val(m.cancellations)}`);
    lines.push(`  ARPU: ${cents(m.arpu)} | ARPPU: ${cents(m.arppu)}`);
  }
  return lines.join("\n");
}

export function formatAnalyticsOverview(data: Obj): string {
  const lines: string[] = [];
  lines.push(`# Analytics Overview`);
  lines.push(``);

  const metrics = expectKey(data, "metrics", lines);
  if (!metrics) {
    lines.push("No analytics data available.");
    return lines.join("\n");
  }

  const current = metrics.current as Obj | undefined;
  const previous = metrics.previous as Obj | undefined;

  if (current) {
    lines.push(formatMetricBlock(current, "Current period"));
    lines.push(``);
  }
  if (previous) {
    lines.push(formatMetricBlock(previous, "Previous period"));
  }

  if (!current && !previous) {
    lines.push("No data for this period.");
  }

  return lines.join("\n");
}

// ── link_analytics ──

export function formatLinkAnalytics(data: Obj): string {
  const path = data.link_path as string;

  const lines: string[] = [];
  lines.push(`# Analytics for /${path}`);
  lines.push(``);

  const metrics = expectKey(data, "metrics", lines);
  if (!metrics || Object.keys(metrics).length === 0) {
    lines.push("No data for this period.");
    return lines.join("\n");
  }

  const entries = Object.values(metrics);

  for (const m of entries as Obj[]) {
    lines.push(`Views: ${val(m.view)} | Opens: ${val(m.open)} | Installs: ${val(m.install)}`);
    lines.push(`Reinstalls: ${val(m.reinstall)} | Reactivations: ${val(m.reactivation)} | App opens: ${val(m.app_open)}`);
    lines.push(`Referred users: ${val(m.user_referred)} | Avg engagement: ${val(m.avg_engagement_time)}s`);
  }

  return lines.join("\n");
}

// ── top_links ──

export function formatTopLinks(data: Obj): string {
  const lines: string[] = [];
  const links = expectArray(data, "links", lines);

  lines.push(`# Top Links`);
  lines.push(``);

  if (!links || links.length === 0) {
    lines.push("No data for this period.");
    return lines.join("\n");
  }

  lines.push(`| # | Name | Path | Views | Opens | Installs |`);
  lines.push(`|---|------|------|-------|-------|----------|`);

  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    lines.push(
      `| ${i + 1} | ${val(l.name)} | ${val(l.path)} | ${val(l.views)} | ${val(l.opens)} | ${val(l.installs)} |`,
    );
  }

  return lines.join("\n");
}

// ── configure_redirects ──

export function formatRedirects(data: Obj): string {
  const lines: string[] = [];
  lines.push(`# Redirect Configuration Updated`);
  lines.push(``);

  const rc = expectKey(data, "redirect_config", lines);
  if (!rc) {
    lines.push("No redirect configuration returned.");
    return lines.join("\n");
  }

  lines.push(`Default fallback: ${val(rc.default_fallback)}`);
  lines.push(`Show preview (iOS): ${yesNo(rc.show_preview_ios)} | Show preview (Android): ${yesNo(rc.show_preview_android)}`);
  lines.push(``);

  for (const platform of ["ios", "android", "desktop"]) {
    const platformConfig = rc[platform] as Obj | undefined;
    if (!platformConfig) continue;
    for (const [variation, r] of Object.entries(platformConfig)) {
      const redirect = r as Obj;
      lines.push(`${platform.toUpperCase()}/${variation}:`);
      lines.push(`  Enabled: ${yesNo(redirect.enabled)}`);
      if (redirect.fallback_url) lines.push(`  Fallback: ${val(redirect.fallback_url)}`);
      if (redirect.appstore) lines.push(`  App Store: ${val(redirect.appstore)}`);
    }
  }

  return lines.join("\n");
}

// ── Campaigns ──

export function formatCampaign(data: Obj, action: string): string {
  const lines: string[] = [];
  lines.push(`# Campaign ${action}`);

  const campaign = expectKey(data, "campaign", lines) ?? {};
  lines.push(``);
  lines.push(`Name: ${val(campaign.name)} | ID: ${val(campaign.id)}`);
  lines.push(`Archived: ${yesNo(campaign.archived)} | Created: ${date(campaign.created_at)}`);
  lines.push(``);
  if (action === "Archived") {
    lines.push(`**Next steps:** Use list_campaigns to view remaining campaigns.`);
  } else {
    lines.push(`**Next steps:** Use create_link with campaign_id ${val(campaign.id)} to add links to this campaign, or list_campaigns to view all campaigns.`);
  }
  return lines.join("\n");
}

export function formatListCampaigns(data: Obj): string {
  const lines: string[] = [];
  const campaigns = expectArray(data, "campaigns", lines);
  const meta = expectKey(data, "meta", lines) ?? {};

  lines.push(`# Campaigns (${val(meta.total_entries)} total, page ${val(meta.page)}/${val(meta.total_pages)})`);
  lines.push(``);

  if (!campaigns || campaigns.length === 0) {
    lines.push("No campaigns found. Use create_campaign to get started.");
    return lines.join("\n");
  }

  lines.push(`| # | Name | ID | Views | Opens | Installs | Revenue | Archived |`);
  lines.push(`|---|------|----|-------|-------|----------|---------|----------|`);

  for (let i = 0; i < campaigns.length; i++) {
    const c = campaigns[i];
    lines.push(
      `| ${i + 1} | ${val(c.name)} | ${val(c.id)} | ${val(c.total_views)} | ${val(c.total_opens)} | ${val(c.total_installs)} | ${cents(c.total_revenue)} | ${yesNo(c.archived)} |`,
    );
  }

  return lines.join("\n");
}

// ── configure_sdk ──

export function formatSdkConfig(data: Obj): string {
  const lines: string[] = [];
  lines.push(`# SDK Configuration Updated`);
  lines.push(``);

  const configs = expectKey(data, "configurations", lines);
  if (!configs) {
    lines.push("No configuration data returned.");
    return lines.join("\n");
  }

  for (const [platform, c] of Object.entries(configs)) {
    const config = c as Obj;
    lines.push(`**${platform.toUpperCase()}:** ${yesNo(config.enabled)}`);
    const inner = config.configuration as Obj;
    if (inner) {
      const details = Object.entries(inner)
        .filter(([k]) => !SDK_HIDDEN_FIELDS.has(k))
        .map(([k, v]) => `  ${k}: ${val(v)}`)
        .join("\n");
      if (details) lines.push(details);
    }
    lines.push(``);
  }

  return lines.join("\n");
}
