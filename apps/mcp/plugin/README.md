# OpenGrow Plugin for Claude Code

Manage deep links, analytics, and app configuration for your mobile apps — directly from Claude Code.

## What is OpenGrow?

[OpenGrow](https://github.com/mbzadev/opengrow-platform) is a self-hosted
application operations control plane. Its MCP tools cover projects, Universal
Links (iOS), App Links (Android), deferred deep linking, analytics, campaigns
and SDK configuration for the selected deployment target.

## Installation

```bash
claude plugin install opengrow
```

This installs the OpenGrow MCP server and a set of skills that teach Claude how to use it.

## Authentication

Set `OPENGROW_MCP_URL` to the `/mcp` endpoint published by the selected
application target. On first use, Claude Code opens the target's OAuth flow. No
API key is stored in the plugin.

## Available Skills

### opengrow-setup-project
Set up a new OpenGrow project for your mobile app. Creates an instance, configures SDK settings for iOS/Android, and sets up redirect behavior.

**Try:** "Set up OpenGrow for my iOS app with bundle ID com.mycompany.myapp"

### opengrow-create-link
Create deep links with social previews, tags, custom data, and redirect overrides.

**Try:** "Create a deep link for our summer sale that opens the promotions screen"

### opengrow-analytics
View link performance — overview metrics, top links, and per-link analytics.

**Try:** "How are my deep links performing this month?"

### opengrow-manage-links
Search, view, update, and archive your existing links.

**Try:** "Show me all links tagged 'marketing'" or "Update the title on my /summer-sale link"

### opengrow-campaigns
Group links into campaigns and track them as a whole — views, opens, installs, and revenue.

**Try:** "Create a Summer Sale campaign and add these links to it"

### opengrow-configure-platform
Configure iOS/Android SDK settings, Universal Links, App Links, and redirect behavior.

**Try:** "Set up Android App Links for package com.mycompany.myapp"

## MCP Tools

The plugin connects to the OpenGrow MCP server which provides these tools:

| Tool | Description |
|------|-------------|
| `get_status` | View instances, projects, domains, and current config |
| `get_usage` | Read the 30-day active-user metric for an instance |
| `create_project` | Create a new instance with production and test projects |
| `create_link` | Create a deep link with metadata and custom data |
| `get_link` | Get details of a specific link |
| `update_link` | Update a link's metadata, tags, or redirects |
| `archive_link` | Deactivate a link permanently |
| `search_links` | Search and list links with filters |
| `get_analytics_overview` | Project-level analytics (views, installs, opens, revenue) |
| `get_link_analytics` | Analytics for a specific link |
| `get_top_links` | Top performing links by views/clicks |
| `create_campaign` | Create a campaign to group related links |
| `list_campaigns` | List campaigns with aggregated metrics |
| `archive_campaign` | Archive a campaign and deactivate its links |
| `configure_redirects` | Set redirect behavior for a project |
| `configure_sdk` | Configure iOS/Android SDK settings |

## Links

- [OpenGrow platform documentation](https://github.com/mbzadev/opengrow-platform/tree/main/docs)
- Dashboard: use the `domains.dashboard` origin from the selected target manifest
- [MCP Server Source](https://github.com/mbzadev/opengrow-platform/tree/main/apps/mcp)
