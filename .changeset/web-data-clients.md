---
"@superboard/web": minor
---

Adds clients for the SuperBoard application database, storage, realtime, functions and vectors to `SuperBoardClient`. Signed-in calls carry the application token of the user, so table, bucket and collection rules apply to that user; other calls are anonymous.

- `client.from(table)` builds filtered, ordered and paginated queries (`eq`, `in`, `ilike`, `order`, `limit`, `cursor`, `count`, `pages()`) and writes rows with `insert`, `update`, `updateById`, `delete` and `deleteById`.
- `client.storage.from(bucket)` uploads, downloads, lists, removes and signs objects, builds public URLs (pass the new `projectId` option) and sends large files in resumable parts with `uploadLarge()`.
- `client.channel(name)` subscribes to broadcasts, presence and table changes over one WebSocket per client, and joins its channels again after a disconnection or a change of user.
- `client.functions.invoke()`, `client.vectors.from(collection)` and `client.ai.embeddings()` call functions, similarity search and embeddings.

Adds `SuperBoardAdmin` to `@superboard/web/server`. It authenticates with a server key (`sb_secret_…`), exposes the same clients without per-user rules, and manages tables, schema, generated types, buckets, functions, schedules and vector collections through `admin.manage`. `SuperBoardServer` is unchanged.

Adds an optional `{ captchaToken }` argument to `signIn()` and `register()`, sent as `captcha_token` for projects that require a CAPTCHA. Calls without it send the same body as before.

`SuperBoardError` now also exposes the API `details` and `retryable` fields.
