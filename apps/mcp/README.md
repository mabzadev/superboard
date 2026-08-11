<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo.svg">
    <img src=".github/logo.svg" width="120" alt="SuperBoard">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/mbzadev/superboard-platform/releases"><img src="https://img.shields.io/github/v/release/mbzadev/superboard-platform?style=flat-square&color=4F46E5" alt="Latest release"/></a>
  <a href="#"><img src="https://img.shields.io/badge/MCP-1.0-4F46E5?style=flat-square" alt="MCP 1.0"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Claude%20Code-supported-4F46E5?style=flat-square" alt="Claude Code"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Cursor-supported-4F46E5?style=flat-square" alt="Cursor"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mbzadev/superboard-platform?style=flat-square&color=4F46E5" alt="MIT License"/></a>
  <a href="https://github.com/mbzadev/superboard-platform/stargazers"><img src="https://img.shields.io/github/stars/mbzadev/superboard-platform?style=flat-square&color=4F46E5" alt="GitHub stars"/></a>
</p>

<p align="center">
  MCP server for managing deep links, analytics, and app configuration on <a href="https://github.com/mbzadev/superboard-platform">SuperBoard</a>.
  <br />
  Works with Claude Code, Cursor, Windsurf, and any MCP-compatible client.
</p>

<p align="center">
  <a href="https://github.com/mbzadev/superboard-platform">Website</a> &middot;
  <a href="https://github.com/mbzadev/superboard-platform/tree/main/docs">Documentation</a> &middot;
  <a href="https://github.com/mbzadev/superboard-platform/issues">Issues</a>
</p>

---

## What is SuperBoard?

[SuperBoard](https://github.com/mbzadev/superboard-platform) is a self-hosted,
privacy-first application operations control plane. It provides:

- **Deep Linking** — one link that routes users to the right content across iOS, Android, and web. Deferred deep links survive the install flow so users land on the right screen on first open.
- **Attribution** — deterministic, first-party install and event attribution. No fingerprinting, no data sharing with ad networks.
- **Revenue Analytics** — in-app purchases, subscriptions, and custom revenue events matched back to the campaign that drove the install.
- **Campaigns** — group links, track performance, and compare results across channels.

The deployment account, region, public origins and enabled capabilities are
owned by the selected application target. See the
[Worker source](https://github.com/mbzadev/superboard-platform/tree/main/workers/api)
and target manifests for self-hosting.

## What is this MCP server?

This is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI assistants manage your SuperBoard platform through natural language. Create deep links, check analytics, configure redirects, run campaigns — without leaving your editor.

## Quick Start

### Claude Code

```
/plugin marketplace add ./superboard-platform/apps/mcp
/plugin install superboard@superboard
```

Installs the MCP server and skills that teach Claude how to use SuperBoard. On first use, a browser window opens for OAuth — no API keys needed.

### Cursor

Open **Settings > MCP** and add a new server:

```json
{
  "mcpServers": {
    "superboard": {
      "url": "<TARGET_MCP_URL>"
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "superboard": {
      "serverUrl": "<TARGET_MCP_URL>"
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "superboard": {
      "type": "http",
      "url": "<TARGET_MCP_URL>"
    }
  }
}
```

### ChatGPT Desktop

Open **Settings > MCP Servers > Add Server** and enter:

```
<TARGET_MCP_URL>
```

### Self-Hosted

If you're running your own SuperBoard backend, run the MCP server locally and point your client to it:

```bash
git clone https://github.com/mbzadev/superboard-platform.git
cd superboard-platform
npm ci
npm --prefix apps/mcp run build
npm --prefix apps/mcp start
```

Or with Docker:

```bash
docker build -f apps/mcp/Dockerfile -t superboard-mcp apps/mcp
docker run --rm -p 8080:8080 \
  -e SUPERBOARD_API_URL \
  -e PUBLIC_URL \
  superboard-mcp
```

Then use `http://localhost:8080/mcp` as the server URL in any of the client configs above.

> All clients will trigger an OAuth flow on first use — a browser window opens to authenticate with your SuperBoard account.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `SUPERBOARD_API_URL` | required | API origin from the selected SuperBoard target |
| `PUBLIC_URL` | required for HTTP | Public origin of this MCP server, used in OAuth metadata |

Copy `.env.example` to `.env` for local development.

## Tools

| Tool | Description |
|------|-------------|
| `get_status` | Account info, instances, projects, and domains |
| `get_platform_status` | Read-only target, API, Worker, store, job and public-endpoint status for owners/admins |
| `get_usage` | 30-day active-user metric for an instance |
| `create_project` | Create a new instance with production and test projects |
| `create_link` | Create a deep link with metadata, tags, and custom data |
| `get_link` | Get full details of a link by path |
| `update_link` | Update a link's metadata, tags, or redirects |
| `archive_link` | Deactivate a link (irreversible) |
| `search_links` | Search and list links with pagination and filters |
| `get_analytics_overview` | Project-level metrics: views, installs, opens, revenue |
| `get_link_analytics` | Per-link daily metrics |
| `get_top_links` | Top performing links ranked by views |
| `create_campaign` | Create a campaign to group related links |
| `list_campaigns` | List campaigns with aggregated metrics |
| `archive_campaign` | Archive a campaign and deactivate its links |
| `configure_redirects` | Set per-platform redirect behavior (App Store, Play Store, web) |
| `configure_sdk` | Configure iOS/Android SDK settings (bundle ID, team ID, etc.) |

## Architecture

```text
MCP client
    │  stateless Streamable HTTP + OAuth bearer token
    ▼
Cloudflare Worker (`workers/mcp`)
    ├── validates Host, Origin and bearer token
    ├── exposes only `/mcp`, `/health` and OAuth resource metadata
    └── calls the API through a private `API_SERVICE` binding
            │
            ├── tool catalogue (`apps/mcp/src/server.ts`)
            ├── handlers and formatters (`apps/mcp/src/tools`)
            └── injectable API client (`apps/mcp/src/api-client.ts`)
```

The target-deployed Worker is the production runtime. The Express/stdio entry
points in `apps/mcp` are local compatibility adapters and reuse the same tool
catalogue. No application hostname, API key, account ID or plan rule is embedded
in the reusable source.

## Development

```bash
npm run dev          # start with auto-reload
npm run build        # compile TypeScript
npm test             # run the complete MCP application test suite
npm run test:watch   # run tests in watch mode
npm run lint         # ESLint
npm run format       # Prettier
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project structure and PR guidelines.

## SDKs

| Platform | Repository |
|----------|-----------|
| iOS | [`sdks/ios`](https://github.com/mbzadev/superboard-platform/tree/main/sdks/ios) |
| Android | [`sdks/android`](https://github.com/mbzadev/superboard-platform/tree/main/sdks/android) |
| React Native | [`sdks/react-native`](https://github.com/mbzadev/superboard-platform/tree/main/sdks/react-native) |
| Flutter | [`sdks/flutter`](https://github.com/mbzadev/superboard-platform/tree/main/sdks/flutter) |

## License

[MIT](LICENSE)
