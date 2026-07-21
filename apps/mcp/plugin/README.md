# Grovs Plugin for Claude Code

Manage deep links, analytics, and app configuration for your mobile apps — directly from Claude Code.

## What is Grovs?

[Grovs](https://grovs.io) is a deep linking platform for mobile apps. It provides Universal Links (iOS), App Links (Android), deferred deep linking, analytics, and social preview configuration.

## Installation

```bash
claude plugin install grovs
```

This installs the Grovs MCP server and a set of skills that teach Claude how to use it.

## Authentication

On first use, Claude Code will open a browser window to authenticate with your Grovs account via OAuth. No API keys needed.

## Available Skills

### grovs-setup-project
Set up a new Grovs project for your mobile app. Creates an instance, configures SDK settings for iOS/Android, and sets up redirect behavior.

**Try:** "Set up Grovs for my iOS app with bundle ID com.mycompany.myapp"

### grovs-create-link
Create deep links with social previews, tags, custom data, and redirect overrides.

**Try:** "Create a deep link for our summer sale that opens the promotions screen"

### grovs-analytics
View link performance — overview metrics, top links, and per-link analytics.

**Try:** "How are my deep links performing this month?"

### grovs-manage-links
Search, view, update, and archive your existing links.

**Try:** "Show me all links tagged 'marketing'" or "Update the title on my /summer-sale link"

### grovs-campaigns
Group links into campaigns and track them as a whole — views, opens, installs, and revenue.

**Try:** "Create a Summer Sale campaign and add these links to it"

### grovs-configure-platform
Configure iOS/Android SDK settings, Universal Links, App Links, and redirect behavior.

**Try:** "Set up Android App Links for package com.mycompany.myapp"

## MCP Tools

The plugin connects to the Grovs MCP server which provides these tools:

| Tool | Description |
|------|-------------|
| `get_status` | View instances, projects, domains, and current config |
| `get_usage` | Check usage metrics and subscription status for an instance |
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

- [Grovs Documentation](https://docs.grovs.io)
- [Grovs Dashboard](https://app.grovs.io)
- [MCP Server Source](https://github.com/grovs-io/mcp)
