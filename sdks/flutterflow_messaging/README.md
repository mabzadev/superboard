# OpenGrow FlutterFlow Support

This library is independent from Purchases. It creates no token and maintains no account. `opengrowSupportInitializeAuthenticated` exchanges the existing application access token only through the configured authentication gateway, then uses the short-lived ES256 token for the canonical OpenGrow Support Worker. Configure `supportUrl` as `https://api.<app>/api/v1/support-client`; the application must never call Chatwoot directly.

<!-- opengrow-sdk-documentation:flutterflow-support:start -->

> **Lifecycle: archived.** This package is frozen for existing clients.
> Its historical release remains available, but no new version may be
> published.

## Historical installation

Add the published FlutterFlow Support package `opengrow_flutterflow_messaging`
at the immutable release `sdk-flutterflow-messaging-v1.3.0`:

```yaml
opengrow_flutterflow_messaging:
  git:
    url: https://github.com/mbzadev/superboard.git
    ref: sdk-flutterflow-messaging-v1.3.0
    path: sdks/flutterflow_messaging
```

No repository read token is required. Runtime credentials must never be
placed in the Git dependency or exported application source.

Then resolve the immutable dependency:

```bash
flutter pub get
```

<!-- opengrow-sdk-documentation:flutterflow-support:end -->

Available FlutterFlow actions:

- `opengrowSupportInitializeAuthenticated`
- `opengrowSupportOpenConversation`
- `opengrowSupportGetConfigurationJson`
- `opengrowSupportListConversationsJson`
- `opengrowSupportUpdateConversationJson`
- `opengrowSupportMessagesJson`
- `opengrowSupportSend`
- `opengrowSupportSendAdvanced`
- `opengrowSupportSubmitCsatJson`
- `opengrowSupportUploadAttachmentJson`
- `opengrowSupportSendAttachment`
- `opengrowSupportDownloadAttachment`
- `opengrowSupportMarkRead`
- `opengrowSupportSetTyping`
- `opengrowSupportConnectRealtime`
- `opengrowSupportDisconnectRealtime`
- `opengrowSupportGetLastRealtimeEventJson`
- `opengrowSupportDispose`

Subscribe to `opengrowSupportEventJsonStream` once during application
bootstrap. It emits server events and `connection.changed` lifecycle events.
Unexpected disconnects use bounded exponential reconnect. Switching
conversations or calling disconnect invalidates the previous socket so it
cannot reconnect in the background.

Generate `clientMessageId` once in the application and reuse it for every retry. The server then guarantees idempotent message creation.

Conversation list results include `unread_count`. It is computed from messages
received after the authenticated participant's latest read receipt.

`opengrowSupportGetConfigurationJson` returns the enabled mobile/web Inbox
presentation, pre-chat fields, email collection policy, continuity, CSAT,
availability, locale, attachment policy, and feature flags configured in the
dashboard. These values are not embedded in the FlutterFlow project.

`opengrowSupportOpenConversation` accepts an optional Inbox ID and custom
attributes. `opengrowSupportUpdateConversationJson` lets the authenticated
customer resolve or reopen a conversation and update custom attributes.
`opengrowSupportSendAdvanced` adds reply references, interactive content
types, and bounded JSON metadata. Private notes remain an agent-only dashboard
capability and can never be delivered to a customer socket or API response.

`projectId` is required during initialization and must come from the project configuration. The library does not embed an application-specific project identifier. Identity tokens are refreshed through the configured authentication gateway before expiry and once after an HTTP 401 response. The library never creates or signs an identity token.

The historical `opengrowMessaging*` symbols remain as deprecated-compatible
aliases for a controlled application migration. New FlutterFlow code must use
only the `opengrowSupport*` names. The legacy `opengrow-messaging` Worker and
`messages.<app>` endpoint are not part of a new target.
