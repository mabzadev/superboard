<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://s3.eu-north-1.amazonaws.com/grovs.io/full-white.svg">
    <img src="https://s3.eu-north-1.amazonaws.com/grovs.io/full-black.svg" width="120" alt="Grovs">
  </picture>
</p>

<p align="center">
  MCP server for managing deep links, analytics, and app configuration on <a href="https://grovs.io">Grovs</a>.
  <br />
  Works with Claude Code, Cursor, Windsurf, and any MCP-compatible client.
</p>

<p align="center">
  <a href="https://grovs.io">Website</a> &middot;
  <a href="https://docs.grovs.io">Documentation</a> &middot;
  <a href="https://github.com/grovs-io/mcp/issues">Issues</a>
</p>

---

## What is Grovs?

[Grovs](https://grovs.io) is an open-source, privacy-first growth platform for mobile apps — a self-hostable alternative to Branch.io and AppsFlyer. It provides:

- **Deep Linking** — one link that routes users to the right content across iOS, Android, and web. Deferred deep links survive the install flow so users land on the right screen on first open.
- **Attribution** — deterministic, first-party install and event attribution. No fingerprinting, no data sharing with ad networks.
- **Revenue Analytics** — in-app purchases, subscriptions, and custom revenue events matched back to the campaign that drove the install.
- **Campaigns** — group links, track performance, and compare results across channels.

EU-hosted, open-source SDKs, 20M+ daily active users in production. See the [backend repo](https://github.com/grovs-io/backend) for self-hosting.

## What is this MCP server?

This is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI assistants manage your Grovs platform through natural language. Create deep links, check analytics, configure redirects, run campaigns — without leaving your editor.

## Quick Start

### Claude Code

```
/plugin marketplace add grovs-io/mcp
/plugin install grovs@grovs
```

Installs the MCP server and skills that teach Claude how to use Grovs. On first use, a browser window opens for OAuth — no API keys needed.

### Cursor

Open **Settings > MCP** and add a new server:

```json
{
  "mcpServers": {
    "grovs": {
      "url": "https://mcp.grovs.io/mcp"
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "grovs": {
      "serverUrl": "https://mcp.grovs.io/mcp"
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "grovs": {
      "type": "http",
      "url": "https://mcp.grovs.io/mcp"
    }
  }
}
```

### ChatGPT Desktop

Open **Settings > MCP Servers > Add Server** and enter:

```
https://mcp.grovs.io/mcp
```

### Self-Hosted

If you're running your own Grovs backend, run the MCP server locally and point your client to it:

```bash
git clone https://github.com/grovs-io/mcp.git
cd mcp
npm install && npm run build
npm start
```

Or with Docker:

```bash
docker build -t grovs-mcp .
docker run -p 8080:8080 grovs-mcp
```

Then use `http://localhost:8080/mcp` as the server URL in any of the client configs above.

> All clients will trigger an OAuth flow on first use — a browser window opens to authenticate with your Grovs account.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `GROVS_API_URL` | `https://mcp.grovs.io` | Grovs backend URL (override for self-hosted) |
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
                    HTTP calls to Grovs backend
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
| iOS | [grovs-io/grovs-ios](https://github.com/grovs-io/grovs-ios) |
| Android | [grovs-io/grovs-android](https://github.com/grovs-io/grovs-android) |
| React Native | [grovs-io/grovs-react-native](https://github.com/grovs-io/grovs-react-native) |
| Flutter | [grovs-io/grovs-flutter](https://github.com/grovs-io/grovs-flutter) |

## License

[MIT](LICENSE)
