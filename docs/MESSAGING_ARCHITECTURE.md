# OpenGrow Messaging

## Identity authority

`api-auth-gateway` is the only application authentication authority. Messaging creates no account, session, or identity token. The client exchanges its existing application access token through `POST /auth/opengrow-token`. Messaging then verifies the short-lived ES256 JWT against the gateway JWKS, issuer, and `opengrow` audience.

## Isolation

- Worker: `opengrow-messaging`
- D1: `opengrow-messaging-db`
- R2: `opengrow-messaging`
- Durable Object: one `ConversationRoom` instance per conversation
- Dashboard access: private service binding with a rotating internal capability

Billing does not depend on any Messaging component.

## Guarantees

- `client_conversation_id` and `client_message_id` make retries idempotent.
- Reusing a message ID with a different payload returns `idempotency_conflict`.
- The Durable Object assigns a persistent sequence and broadcasts through hibernating WebSockets.
- An R2 attachment can be associated only with its original conversation.
- Status, priority, labels, assignment, and actions are recorded in an immutable audit log.
- Public failures expose stable `code`, `message`, `retryable`, and `request_id` fields.

## Runtime certification

`npm run messaging:test:runtime` executes the Messaging D1 migrations and `ConversationRoom` inside Cloudflare's Workers runtime. The suite certifies per-conversation isolation, concurrent message ordering, attachment ownership, WebSocket hibernation, and reconnection. `npm run messaging:check` also runs the Node unit tests, both TypeScript checks, and a Wrangler deployment dry run.

## FlutterFlow

`sdks/flutterflow_messaging` is separate from Purchases. Its initialization talks only to the existing authentication gateway, then exposes conversations, messages, attachments, read receipts, typing state, and WebSocket updates without increasing the financial SDK surface. The configured project ID is required and identity tokens are refreshed through the same gateway before expiry or after an authentication rejection.

The unified Inbox exposes agent assignment, labels, priority, status, read receipts, typing state, and attachment transfer through the Messaging service binding. Durable Object sequence state is reconciled with D1 history so a database restoration cannot restart a conversation at sequence one.
