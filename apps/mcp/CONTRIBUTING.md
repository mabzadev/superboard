# Contributing to Grovs MCP Server

## Setup

```bash
git clone https://github.com/grovs-io/mcp.git
cd mcp
npm install
```

## Development

```bash
npm run dev          # start with auto-reload
npm run build        # compile TypeScript
npm test             # run tests once
npm run test:watch   # run tests in watch mode
npm run lint         # check for lint errors
npm run format       # format code with Prettier
```

## Project structure

```
src/
  index.ts              # Entry point — starts the HTTP server
  app.ts                # Express app factory (routes, OAuth, /mcp endpoint)
  server.ts             # MCP server factory — tool registration, runWithAuth, shared types
  api-client.ts         # HTTP client for the Grovs backend API
  tools/
    handlers.ts         # Tool handlers — thin wrappers: call API, format result
    formatters.ts       # Human-readable formatters with runtime shape validation (expectKey/expectArray)
    utils.ts            # Shared utilities (Obj type, slugify)
  __tests__/
    fixtures.ts         # Typed test fixtures for API responses
    formatters.test.ts  # Formatter unit tests
    tools.test.ts       # Handler + runWithAuth tests
    api-client.test.ts  # API client tests
    app.test.ts         # Express app / HTTP tests
    server.test.ts      # MCP server tests
plugin/
  README.md             # Claude Code plugin documentation
  skills/               # Skills that teach Claude non-obvious Grovs workflows
```

## Architecture

- **`server.ts`** registers all 16 tools with Zod input schemas and delegates to handlers via `runWithAuth`
- **`runWithAuth`** is the single error boundary: extracts the auth token, calls the handler, catches all errors
- **Handlers** (`tools/handlers.ts`) are plain async functions that call the API client, pass the result through a formatter, and return a `ToolResult`. They throw on error (caught by `runWithAuth`)
- **Formatters** (`tools/formatters.ts`) convert raw API JSON into concise text. They use `expectKey`/`expectArray` to warn when the API shape changes instead of silently producing broken output
- **`api-client.ts`** handles HTTP communication with the Grovs backend. All functions return `Promise<unknown>` — shape validation happens in the formatter layer

## Pull requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `npm test`, `npm run lint`, and `npm run build` all pass
4. Open a PR with a clear description of what changed and why

## Reporting issues

Use [GitHub Issues](https://github.com/grovs-io/mcp/issues). Include steps to reproduce, expected behavior, and actual behavior.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
