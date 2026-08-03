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

## FlutterFlow

`sdks/flutterflow_messaging` is separate from Purchases. Its initialization talks only to the existing authentication gateway, then exposes conversations, messages, attachments, and WebSocket updates without increasing the financial SDK surface.
