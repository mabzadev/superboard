<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://s3.eu-north-1.amazonaws.com/opengrow.io/full-white.svg">
    <img src="https://s3.eu-north-1.amazonaws.com/opengrow.io/full-black.svg" width="120" alt="OpenGrow">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/mbzadev/opengrow/releases"><img src="https://img.shields.io/github/v/release/mbzadev/opengrow?style=flat-square&color=4F46E5" alt="Latest release"/></a>
  <a href="#"><img src="https://img.shields.io/badge/MCP-1.0-4F46E5?style=flat-square" alt="MCP 1.0"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Claude%20Code-supported-4F46E5?style=flat-square" alt="Claude Code"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Cursor-supported-4F46E5?style=flat-square" alt="Cursor"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mbzadev/opengrow?style=flat-square&color=4F46E5" alt="MIT License"/></a>
  <a href="https://github.com/mbzadev/opengrow/stargazers"><img src="https://img.shields.io/github/stars/mbzadev/opengrow?style=flat-square&color=4F46E5" alt="GitHub stars"/></a>
</p>

<p align="center">
  MCP server for managing deep links, analytics, and app configuration on <a href="https://github.com/mbzadev/opengrow">OpenGrow</a>.
  <br />
  Works with Claude Code, Cursor, Windsurf, and any MCP-compatible client.
</p>

<p align="center">
  <a href="https://github.com/mbzadev/opengrow">Website</a> &middot;
  <a href="https://docs.opengrow.io">Documentation</a> &middot;
  <a href="https://github.com/mbzadev/opengrow/issues">Issues</a>
</p>

---

## What is OpenGrow?

[OpenGrow](https://github.com/mbzadev/opengrow) is an open-source, privacy-first growth platform for mobile apps — a self-hostable alternative to Branch.io and AppsFlyer. It provides:

- **Deep Linking** — one link that routes users to the right content across iOS, Android, and web. Deferred deep links survive the install flow so users land on the right screen on first open.
- **Attribution** — deterministic, first-party install and event attribution. No fingerprinting, no data sharing with ad networks.
- **Revenue Analytics** — in-app purchases, subscriptions, and custom revenue events matched back to the campaign that drove the install.
- **Campaigns** — group links, track performance, and compare results across channels.

EU-hosted, open-source SDKs, 20M+ daily active users in production. See the [Worker source](https://github.com/mbzadev/opengrow/tree/main/workers/api) for self-hosting.

## What is this MCP server?

This is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI assistants manage your OpenGrow platform through natural language. Create deep links, check analytics, configure redirects, run campaigns — without leaving your editor.

## Quick Start

### Claude Code

```
/plugin marketplace add mbzadev/mcp
/plugin install opengrow@opengrow
```

Installs the MCP server and skills that teach Claude how to use OpenGrow. On first use, a browser window opens for OAuth — no API keys needed.

### Cursor

Open **Settings > MCP** and add a new server:

```json
{
  "mcpServers": {
    "opengrow": {
      "url": "https://mcp.opengrow.io/mcp"
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "opengrow": {
      "serverUrl": "https://mcp.opengrow.io/mcp"
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "opengrow": {
      "type": "http",
      "url": "https://mcp.opengrow.io/mcp"
    }
  }
}
```

### ChatGPT Desktop

Open **Settings > MCP Servers > Add Server** and enter:

```
https://mcp.opengrow.io/mcp
```

### Self-Hosted

If you're running your own OpenGrow backend, run the MCP server locally and point your client to it:

```bash
git clone https://github.com/mbzadev/opengrow.git
cd opengrow/apps/mcp
npm install && npm run build
npm start
```

Or with Docker:

```bash
docker build -t opengrow-mcp .
docker run -p 8080:8080 opengrow-mcp
```

Then use `http://localhost:8080/mcp` as the server URL in any of the client configs above.

> All clients will trigger an OAuth flow on first use — a browser window opens to authenticate with your OpenGrow account.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `OPENGROW_API_URL` | `https://mcp.opengrow.io` | OpenGrow backend URL (override for self-hosted) |
| `PUBLIC_URL` | `http://localhost:8080` | Public URL of this MCP server (used for OAuth callbacks) |

Copy `.env.example` to `.env` for local development.

## Tools

| Tool | Description |
|------|-------------|
| `get_status` | Account info, instances, projects, and domains |
| `get_usage` | Usage metrics and subscription status for an instance |
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

```
MCP Client (Claude Code, Cursor, etc.)
    │
    │  MCP protocol over HTTP
    ▼
Express app (src/app.ts)
    │
    ├── OAuth flow (/authorize, /callback, /register)
    │
    └── MCP endpoint (/mcp)
            │
            ├── Tool registration (src/server.ts)
            │       Zod schema validation + runWithAuth error boundary
            │
            ├── Handlers (src/tools/handlers.ts)
            │       Business logic, plain functions, throw on error
            │
            ├── Formatters (src/tools/formatters.ts)
            │       Convert API JSON to human-readable text
            │
            └── API client (src/api-client.ts)
                    HTTP calls to OpenGrow backend
```

## Development

```bash
npm run dev          # start with auto-reload
npm run build        # compile TypeScript
npm test             # run tests (186 tests)
npm run test:watch   # run tests in watch mode
npm run lint         # ESLint
npm run format       # Prettier
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project structure and PR guidelines.

## SDKs

| Platform | Repository |
|----------|-----------|
| iOS | [`sdks/ios`](https://github.com/mbzadev/opengrow/tree/main/sdks/ios) |
| Android | [`sdks/android`](https://github.com/mbzadev/opengrow/tree/main/sdks/android) |
| React Native | [`sdks/react-native`](https://github.com/mbzadev/opengrow/tree/main/sdks/react-native) |
| Flutter | [`sdks/flutter`](https://github.com/mbzadev/opengrow/tree/main/sdks/flutter) |

## License

[MIT](LICENSE)
