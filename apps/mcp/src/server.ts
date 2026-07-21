import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";

import {
  handleGetStatus,
  handleGetUsage,
  handleCreateProject,
  handleCreateLink,
  handleGetLink,
  handleUpdateLink,
  handleArchiveLink,
  handleSearchLinks,
  handleGetAnalyticsOverview,
  handleGetLinkAnalytics,
  handleGetTopLinks,
  handleConfigureRedirects,
  handleConfigureSdk,
  handleCreateCampaign,
  handleListCampaigns,
  handleArchiveCampaign,
} from "./tools/handlers.js";
import { slugify, extractPath } from "./tools/utils.js";

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export function extractToken(extra: ToolExtra): string {
  const token = extra.authInfo?.token;
  if (!token) {
    throw new Error("Not authenticated. Please connect with a valid Bearer token.");
  }
  return token;
}

export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) return JSON.stringify(err);
  return String(err);
}

export type ToolResult = {
  isError?: true;
  content: Array<{ type: "text"; text: string }>;
};

/** Extracts token from extra, calls handler, catches all errors. */
export async function runWithAuth(
  extra: ToolExtra,
  handler: (token: string) => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    const token = extractToken(extra);
    return await handler(token);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: formatError(err) }],
    };
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "grovs-mcp",
    version: "1.0.0",
  });

  // --- Status ---

  server.registerTool(
    "get_status",
    {
      title: "Get Account & Projects",
      description:
        "Returns the authenticated user's account info and all their Grovs projects with domains. Call this first to discover available project IDs before using other tools.",
    },
    (extra) => runWithAuth(extra, (token) => handleGetStatus(token)),
  );

  // --- Usage ---

  server.registerTool(
    "get_usage",
    {
      title: "Get Instance Usage",
      description:
        "Check usage metrics and subscription status for an instance. Returns current MAU count, MAU limit, and whether the quota is exceeded. Call get_status first to find instance IDs.",
      inputSchema: {
        instance_id: z.string().describe("Instance ID from get_status"),
      },
    },
    ({ instance_id }, extra) =>
      runWithAuth(extra, (token) => handleGetUsage(token, instance_id)),
  );

  // --- Projects ---

  server.registerTool(
    "create_project",
    {
      title: "Create Project",
      description:
        "Create a new Grovs project. This provisions a production and test environment with their own domains for deep links.",
      inputSchema: {
        name: z.string().describe("Project name (e.g. 'My App')"),
      },
    },
    ({ name }, extra) => runWithAuth(extra, (token) => handleCreateProject(token, name)),
  );

  // --- Links ---

  server.registerTool(
    "create_link",
    {
      title: "Create Deep Link",
      description:
        "Create a deep link in a project. Only 'name' is required — the URL path is auto-generated from the name. Optionally set title/subtitle for link previews, tags for organization, and a data payload that gets passed to the app on open.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        name: z.string().describe("Link name (also used to generate the URL slug)"),
        path: z.string().optional().describe("Custom URL path slug (e.g. 'summer-sale') — auto-generated from name if omitted"),
        title: z.string().optional().describe("Preview title shown when link is shared"),
        subtitle: z.string().optional().describe("Preview subtitle shown when link is shared"),
        image_url: z.url().optional().describe("Preview image URL shown when link is shared"),
        tags: z.array(z.string()).optional().describe("Tags for organizing links"),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("JSON payload passed to the app when the link is opened"),
        custom_redirects: z
          .record(
            z.string(),
            z.union([
              z.string(),
              z.object({
                url: z.string(),
                open_app_if_installed: z.boolean().optional(),
              }),
            ]),
          )
          .optional()
          .describe(
            "OPTIONAL per-platform overrides. Omit for the default behavior (open app if installed, else App Store from configure_sdk). " +
            "Three forms per platform:\n" +
            "  • Omit entirely → app + App Store fallback (default)\n" +
            "  • Flat string `{ios: 'https://...'}` → app + custom URL fallback (open app if installed, else this URL)\n" +
            "  • Object `{ios: {url: 'https://...', open_app_if_installed: false}}` → custom URL ONLY (skip the app-open attempt)",
          ),
        campaign_id: z.number().optional().describe("Campaign ID to add this link to (from list_campaigns or create_campaign)"),
      },
    },
    ({ project_id, name, path, title, subtitle, image_url, tags, data, custom_redirects, campaign_id }, extra) =>
      runWithAuth(extra, (token) =>
        handleCreateLink(token, project_id, {
          name,
          path: path ?? slugify(name),
          title,
          subtitle,
          image_url,
          tags,
          data,
          custom_redirects,
          campaign_id,
        }),
      ),
  );

  server.registerTool(
    "get_link",
    {
      title: "Get Link Details",
      description: "Look up a deep link by its path slug or full URL. Returns full link details including preview metadata, tags, data payload, and custom redirects.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        path: z.string().describe("Link path slug (e.g. 'summer-sale') or full URL (e.g. 'https://myapp.grovs.io/summer-sale')"),
      },
    },
    ({ project_id, path }, extra) =>
      runWithAuth(extra, (token) => handleGetLink(token, project_id, extractPath(path))),
  );

  server.registerTool(
    "update_link",
    {
      title: "Update Deep Link",
      description: "Update an existing deep link. Only include the fields you want to change.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        link_id: z.number().describe("Numeric link ID from search_links or get_link"),
        name: z.string().optional().describe("New link name"),
        path: z.string().optional().describe("New URL path slug"),
        title: z.string().optional().describe("Preview title"),
        subtitle: z.string().optional().describe("Preview subtitle"),
        image_url: z.url().optional().describe("Preview image URL"),
        tags: z.array(z.string()).optional().describe("Tags"),
        data: z.record(z.string(), z.unknown()).optional().describe("JSON payload for the app"),
        custom_redirects: z
          .record(
            z.string(),
            z.union([
              z.string(),
              z.object({
                url: z.string(),
                open_app_if_installed: z.boolean().optional(),
              }),
            ]),
          )
          .optional()
          .describe(
            "OPTIONAL per-platform overrides. Three forms per platform:\n" +
            "  • Omit entirely → app + App Store fallback (default)\n" +
            "  • Flat string `{ios: 'https://...'}` → app + custom URL fallback (open app if installed, else this URL)\n" +
            "  • Object `{ios: {url: 'https://...', open_app_if_installed: false}}` → custom URL ONLY (skip the app-open attempt)",
          ),
        campaign_id: z.number().optional().describe("Campaign ID to assign this link to"),
      },
    },
    (
      { project_id, link_id, name, path, title, subtitle, image_url, tags, data, custom_redirects, campaign_id },
      extra,
    ) =>
      runWithAuth(extra, (token) =>
        handleUpdateLink(token, project_id, link_id, {
          name,
          path,
          title,
          subtitle,
          image_url,
          tags,
          data,
          custom_redirects,
          campaign_id,
        }),
      ),
  );

  server.registerTool(
    "archive_link",
    {
      title: "Archive Deep Link",
      description:
        "Archive (deactivate) a deep link. The link will stop redirecting users. This action cannot be undone. Always confirm with the user before calling.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        link_id: z.number().describe("Numeric link ID from search_links or get_link"),
      },
    },
    ({ project_id, link_id }, extra) =>
      runWithAuth(extra, (token) => handleArchiveLink(token, project_id, link_id)),
  );

  server.registerTool(
    "search_links",
    {
      title: "Search & List Links",
      description:
        "Search or list all deep links in a project. Returns links with their view/open/install metrics. Supports pagination, search by name, and sorting.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        page: z.number().optional().describe("Page number (default: 1)"),
        limit: z.number().optional().describe("Results per page (default: 20)"),
        search: z.string().optional().describe("Search by link name, title, path, or tags"),
        sort_by: z.string().optional().describe("Sort by: name, created_at, views, opens, installs"),
        sort_order: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
      },
    },
    ({ project_id, page, limit, search, sort_by, sort_order }, extra) =>
      runWithAuth(extra, (token) =>
        handleSearchLinks(token, project_id, { page, limit, search, sort_by, sort_order }),
      ),
  );

  // --- Analytics ---

  server.registerTool(
    "get_analytics_overview",
    {
      title: "Project Analytics",
      description:
        "Get aggregated analytics for a project: views, opens, installs, new/returning users, revenue. Compares current period vs previous period. Defaults to last 30 days.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        start_date: z.string().optional().describe("Start date (YYYY-MM-DD), defaults to 30 days ago"),
        end_date: z.string().optional().describe("End date (YYYY-MM-DD), defaults to today"),
        platform: z.string().optional().describe("Filter by platform: ios, android, desktop, web"),
      },
    },
    ({ project_id, start_date, end_date, platform }, extra) =>
      runWithAuth(extra, (token) =>
        handleGetAnalyticsOverview(token, project_id, { start_date, end_date, platform }),
      ),
  );

  server.registerTool(
    "get_link_analytics",
    {
      title: "Link Analytics",
      description:
        "Get analytics for a specific link by its path slug or full URL: views, opens, installs, engagement time, referrals. Defaults to last 30 days.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        path: z.string().describe("Link path slug (e.g. 'summer-sale') or full URL (e.g. 'https://myapp.grovs.io/summer-sale')"),
        start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
      },
    },
    ({ project_id, path, start_date, end_date }, extra) =>
      runWithAuth(extra, (token) =>
        handleGetLinkAnalytics(token, project_id, { path: extractPath(path), start_date, end_date }),
      ),
  );

  server.registerTool(
    "get_top_links",
    {
      title: "Top Performing Links",
      description:
        "Get the top performing links ranked by views. Returns each link with its view, open, and install counts. Defaults to top 10 over last 30 days.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
        platform: z.string().optional().describe("Filter by platform: ios, android, desktop, web"),
        limit: z.number().optional().describe("Number of links to return (default: 10)"),
      },
    },
    ({ project_id, start_date, end_date, platform, limit }, extra) =>
      runWithAuth(extra, (token) =>
        handleGetTopLinks(token, project_id, { start_date, end_date, platform, limit }),
      ),
  );

  // --- Configuration ---

  server.registerTool(
    "configure_redirects",
    {
      title: "Configure Redirects",
      description:
        "Set where users are sent when they open a deep link — per platform (iOS App Store, Google Play, desktop website) and a global fallback URL.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        ios_redirect: z.url().optional().describe("iOS redirect URL (e.g. App Store link)"),
        android_redirect: z.url().optional().describe("Android redirect URL (e.g. Play Store link)"),
        desktop_redirect: z.url().optional().describe("Desktop fallback URL"),
        web_redirect: z.url().optional().describe("Web fallback URL"),
        fallback_url: z.url().optional().describe("Global fallback URL for all platforms"),
      },
    },
    (
      { project_id, ios_redirect, android_redirect, desktop_redirect, web_redirect, fallback_url },
      extra,
    ) =>
      runWithAuth(extra, (token) =>
        handleConfigureRedirects(token, project_id, {
          ios_redirect, android_redirect, desktop_redirect, web_redirect, fallback_url,
        }),
      ),
  );

  server.registerTool(
    "configure_sdk",
    {
      title: "Configure Platform SDK",
      description:
        "Configure platform-specific SDK settings for an instance — iOS bundle ID, Android package name, desktop app URLs. Required for deep links to open the correct app.",
      inputSchema: {
        instance_id: z.string().describe("Instance ID from get_status"),
        ios_bundle_id: z.string().optional().describe("iOS bundle identifier (e.g. com.myapp.ios)"),
        ios_team_id: z.string().optional().describe("Apple Developer Team ID"),
        ios_app_store_id: z.string().optional().describe("iOS App Store ID"),
        android_package_name: z.string().optional().describe("Android package name (e.g. com.myapp.android)"),
        android_sha256_fingerprints: z
          .array(z.string())
          .optional()
          .describe("Android SHA256 certificate fingerprints for App Links"),
        desktop_url: z.url().optional().describe("Desktop app download URL"),
      },
    },
    (
      { instance_id, ios_bundle_id, ios_team_id, ios_app_store_id, android_package_name, android_sha256_fingerprints, desktop_url },
      extra,
    ) =>
      runWithAuth(extra, (token) =>
        handleConfigureSdk(token, instance_id, {
          ios_bundle_id, ios_team_id, ios_app_store_id, android_package_name, android_sha256_fingerprints, desktop_url,
        }),
      ),
  );

  // --- Campaigns ---

  server.registerTool(
    "create_campaign",
    {
      title: "Create Campaign",
      description:
        "Create a campaign to group related deep links. After creating, use create_link with campaign_id to add links to this campaign.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        name: z.string().describe("Campaign name"),
      },
    },
    ({ project_id, name }, extra) =>
      runWithAuth(extra, (token) => handleCreateCampaign(token, project_id, name)),
  );

  // Backed by the /campaigns/search endpoint (api.searchCampaigns) under the hood.
  server.registerTool(
    "list_campaigns",
    {
      title: "List Campaigns",
      description:
        "List campaigns with aggregated metrics (views, opens, installs, revenue). Supports pagination, search by name, date range filtering, and sorting.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        page: z.number().optional().describe("Page number (default: 1)"),
        per_page: z.number().optional().describe("Results per page (default: 20)"),
        term: z.string().optional().describe("Search by campaign name"),
        sort_by: z
          .string()
          .optional()
          .describe("Sort by: name, created_at, views, opens, installs, revenue"),
        ascendent: z.boolean().optional().describe("Sort ascending (default: false = descending)"),
        start_date: z.string().optional().describe("Metrics start date (YYYY-MM-DD, default: 30 days ago)"),
        end_date: z.string().optional().describe("Metrics end date (YYYY-MM-DD, default: today)"),
        platform: z.string().optional().describe("Filter metrics by platform: ios, android, desktop, web"),
        archived: z.boolean().optional().describe("Filter by archived status"),
      },
    },
    (
      { project_id, page, per_page, term, sort_by, ascendent, start_date, end_date, platform, archived },
      extra,
    ) =>
      runWithAuth(extra, (token) =>
        handleListCampaigns(token, project_id, {
          page, per_page, term, sort_by, ascendent, start_date, end_date, platform, archived,
        }),
      ),
  );

  server.registerTool(
    "archive_campaign",
    {
      title: "Archive Campaign",
      description:
        "Archive a campaign and deactivate all its links. This action cannot be undone. Always confirm with the user before calling.",
      inputSchema: {
        project_id: z.string().describe("Prod or Test Project ID from get_status (use the Prod/Test Project ID columns, NOT the instance ID)"),
        campaign_id: z.number().describe("Campaign ID from list_campaigns"),
      },
    },
    ({ project_id, campaign_id }, extra) =>
      runWithAuth(extra, (token) => handleArchiveCampaign(token, project_id, campaign_id)),
  );

  return server;
}
