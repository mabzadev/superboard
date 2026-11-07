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

Use the SDK origin for application authentication, data, purchases, communication,
acquisition and analytics. Paths are grouped under `/v1`; see the
[public endpoint contract](../../docs/PUBLIC_ENDPOINTS.md) for migration and custom API origins.

## Application authentication

```typescript
import { SuperBoardClient } from "@superboard/web/client";

const client = new SuperBoardClient({
	apiUrl: "https://sdk.example.com",
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

Pass `{ captchaToken }` as the last argument of `signIn()` or `register()` when
the project requires a CAPTCHA; it is sent as `captcha_token`.

## Database, storage, realtime, functions and vectors

These clients call `/v1/data`. Signed-in requests carry the application token
of the user, so table, bucket and collection rules apply to that user; other
requests are anonymous. Methods return the API payload: lists are
`{ items, nextCursor?, count? }` and errors are `SuperBoardError` instances
with the API `code`, `status`, `details` and `retryable`.

```typescript
const client = new SuperBoardClient({ apiUrl, projectKey, appId, projectId: 12 });

// Tables: filters are encoded PostgREST style (title=ilike.*milk*).
const open = client
	.from("todos")
	.select("id,title,done")
	.eq("done", false)
	.ilike("title", "*milk*")
	.order("created_at", { ascending: false })
	.limit(20);
const page = await open.count();
const next = page.nextCursor ? await open.cursor(page.nextCursor) : null;
for await (const { items } of open.pages()) console.log(items.length);
const todo = await client.from("todos").insert({ title: "Buy milk" });
await client.from("todos").updateById(todo.id, { done: true });
await client.from("todos").eq("done", true).delete();

// Storage
const avatars = client.storage.from("avatars");
await avatars.upload("me.png", file, { upsert: true });
const { url } = await avatars.createSignedUrl("me.png", 3600, { transform: { width: 128 } });
const publicUrl = avatars.getPublicUrl("me.png"); // public buckets; needs projectId
await client.storage.from("videos").uploadLarge("intro.mp4", bigFile, {
	onProgress: ({ uploadedBytes, totalBytes }) => console.log(uploadedBytes / totalBytes),
});

// Realtime: one WebSocket per client, re-joined after a disconnection.
const room = client
	.channel("room:1", { presence: { key: userId } })
	.on("broadcast", "cursor", ({ payload }) => moveCursor(payload))
	.on("presence", "sync", (state) => renderMembers(state))
	.on("change", { table: "todos", event: "INSERT" }, ({ record }) => addTodo(record));
await room.subscribe();
await room.track({ status: "online" });
await room.send("cursor", { x: 10, y: 20 });

// Functions, vectors and embeddings
const result = await client.functions.invoke("hello", { body: { name: "Ada" } });
const matches = await client.vectors.from("docs").query({ text: "refund policy", topK: 5 });
const { data } = await client.ai.embeddings(["hello"]);
```

`uploadLarge()` sends parts of at least 5 MiB (8 MiB by default). When it fails,
the error carries `uploadId`; call it again with `resumeUploadId` and the same
file to send only the missing parts. A query builder runs when it is awaited.
Change listeners join the `db:<table>` channel of a table whose realtime is
enabled. Signing in or out reconnects the realtime socket with the new identity.

## Server key administration (`@superboard/web/server`)

`SuperBoardAdmin` uses a server key (`sb_secret_…`) created in the Front. It
bypasses the per-user rules, so it is server-only like `SuperBoardServer`.

```typescript
import { SuperBoardAdmin } from "@superboard/web/server";

const admin = new SuperBoardAdmin({
	apiUrl: "https://sdk.example.com",
	secretKey: process.env.SUPERBOARD_SECRET_KEY!,
	projectId: 12,
});

await admin.from("articles").insert({ headline: "Hello" });
await admin.storage.from("exports").upload("2026/report.csv", csv);
await admin.realtime.broadcast("news", "published", { id: 1 });

const schema = await admin.manage.schema.pull();
const plan = await admin.manage.schema.push(schema, { dryRun: true });
const types = await admin.manage.types();
await admin.manage.functions.deploy("hello", { source, access: "public" });
await admin.manage.functions.schedule("hello", "*/15 * * * *");
```

`manage` also covers tables and columns, buckets, function runs and rollbacks,
vector collections and project settings. Deletions pass the name as
confirmation. The `superboard` CLI in `sdks/cli` exposes the same operations
from a terminal.

## Server-side transactional email (`@superboard/web/server`)

> **Server only.** These helpers need a secret server API key (`sb_email_…`)
> created in Communication › Settings › Senders & domains. Keep it in a server
> environment variable; never bundle it in a browser or mobile application.
> The helper refuses to run in a browser.

```typescript
import { SuperBoardServer, verifyWebhookSignature } from "@superboard/web/server";

const email = new SuperBoardServer({
	apiUrl: "https://sdk.example.com",
	secretKey: process.env.SUPERBOARD_EMAIL_KEY!,
});

const { id, status } = await email.sendEmail(
	{
		from: "Billing <billing@example.com>", // an enabled, verified sender identity
		to: ["customer@example.net"],
		subject: "Your receipt",
		html: "<p>Thank you!</p>",
		text: "Thank you!",
		tags: ["receipt"],
		metadata: { order_id: "A-1" },
		attachments: [{ filename: "receipt.pdf", content: pdfBytes, contentType: "application/pdf" }],
		// or: templateId: "receipt", variables: { first_name: "Ada" }, locale: "fr"
		// scheduledAt: new Date(Date.now() + 3_600_000), // up to 7 days ahead
	},
	{ idempotencyKey: "order-A-1" },
);
await email.getEmail(id); // status, recipients and timeline
await email.cancelEmail(id); // scheduled messages only
```

The helper calls `POST /v1/email/send`, `GET /v1/email/messages/:id` and
`POST /v1/email/messages/:id/cancel` with `Authorization: Bearer <key>`. Keys are
scoped to `email:send`, stored hashed, and rate limited per project. Attachments
are limited to 10 MB per message; recipients that hard-bounced or complained are
skipped and returned in `suppressed`.

Event webhooks (sent, delivered, bounced, complained, opened, clicked, failed)
are signed with HMAC-SHA256 over `"<X-SuperBoard-Timestamp>.<raw body>"`:

```typescript
const valid = await verifyWebhookSignature({
	payload: rawBody,
	signature: request.headers.get("X-SuperBoard-Signature"),
	timestamp: request.headers.get("X-SuperBoard-Timestamp"),
	secret: process.env.SUPERBOARD_WEBHOOK_SECRET!,
});
```

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
