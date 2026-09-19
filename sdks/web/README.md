# SuperBoard Web

Client JavaScript/TypeScript pour les applications web. Les fonctions Identity
et Flows sont conservées dans ce dossier ; Support, les liens et les événements
restent disponibles dans le SDK.

<!-- superboard-sdk-documentation:web:start -->

> **Lifecycle: active.** New versions may be published only through the
> protected immutable-release workflow.

## Installation

Source version 0.1.0 is not published. Use the monorepo workspace during development; there is no npm release to install yet.

<!-- superboard-sdk-documentation:web:end -->

## Application authentication

```typescript
import { SuperBoardClient } from "@superboard/web/client";

const client = new SuperBoardClient({
	apiUrl: "https://api.example.com",
	projectKey: "YOUR_PROJECT_KEY",
	appId: "app.example.com",
});

await client.signIn(email, password);
const profile = await client.getProfile();
```

Sessions are held in memory. Call `refreshSession()` to rotate an expired access
token and `logout()` to revoke the session. `getApplicationAccessToken()` obtains
the short-lived application token required by protected application services.
`request()` supports JSON endpoints and accepts `applicationToken: true` when
that endpoint requires the application token.

Each client owns its own session. Requests use only the configured origin,
never send browser cookies, and reject redirects. HTTP is accepted only for
loopback development origins.

## Links and Support

The default export retains the link and attribution API. The `/support` export
provides the Support client, realtime connection and browser widget.

## Validation

From the repository root, run `pnpm web:check`. The Web SDK is also used by
`sdks/tauri`; application-specific Tauri capabilities remain in the application.

## Identity and Flows modules

The same package exposes `@superboard/web/identity`, `@superboard/web/flows`,
`@superboard/web/flows/react`, `@superboard/web/flows/components` and
`@superboard/web/flows/react-components`. React integrations require React in
the application. Component styles are available from
`@superboard/web/flows/react-components/index.css`.

These modules are built and packaged with the Web SDK; the internal workspace
package names are not separate application dependencies.

React is an optional peer because only the React subpaths import it. The package
suite loads the vanilla entrypoints with React unavailable, then checks that the
React entrypoint requires it. Knip scans the generated bundles and declarations;
its referenced-optional-peer warning is excluded for this package because it
cannot distinguish these independent entrypoints.
