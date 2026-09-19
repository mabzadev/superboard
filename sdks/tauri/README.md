# SuperBoard Tauri

SuperBoard client for Tauri 2 desktop applications. It reuses the Web client and
sends requests through Tauri's HTTP plugin. It uses the same Web application
configuration and project credentials as the browser version.

<!-- superboard-sdk-documentation:tauri:start -->

> **Lifecycle: active.** New versions may be published only through the
> protected immutable-release workflow.

## Installation

Source version 0.1.0 is not published. Use the monorepo workspace during development; there is no npm release to install yet.

<!-- superboard-sdk-documentation:tauri:end -->

## Application setup

Install the HTTP plugin in your Tauri application with `pnpm tauri add http`.
Initialize `tauri_plugin_http::init()` in the Rust application. Allow only your
SuperBoard API origin in the application's HTTP capabilities:

```json
{
	"permissions": [
		{
			"identifier": "http:default",
			"allow": [{ "url": "https://api.example.com/**" }]
		}
	]
}
```

```typescript
import SuperBoard from "@superboard/tauri";

const client = new SuperBoard({
	apiUrl: "https://api.example.com",
	projectKey: "YOUR_PROJECT_KEY",
	appId: "app.example.com",
});

await client.signIn(email, password);
const profile = await client.getProfile();
```

The session stays in memory; the SDK does not persist tokens in plain-text
browser storage. Native HTTP redirects are disabled. An optional `fetch`
implementation supports integration tests without a native process.

Use `@superboard/web` for the browser version of the application. For the native
HTTP setup, see the [Tauri documentation](https://v2.tauri.app/plugin/http-client/).
