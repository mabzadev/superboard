# OpenGrow FlutterFlow Messaging

This library is independent from Purchases. It creates no token and maintains no account. `opengrowMessagingInitializeAuthenticated` exchanges the existing application access token only through the configured authentication gateway, then uses the short-lived ES256 token for Messaging.

Add the private dependency with an immutable release reference:

```yaml
opengrow_flutterflow_messaging:
  git:
    url: git@github.com:mbzadev/opengrow.git
    ref: sdk-flutterflow-messaging-v1.1.0
    path: sdks/flutterflow_messaging
```

Available FlutterFlow actions:

- `opengrowMessagingInitializeAuthenticated`
- `opengrowMessagingOpenConversation`
- `opengrowMessagingListConversationsJson`
- `opengrowMessagingMessagesJson`
- `opengrowMessagingSend`
- `opengrowMessagingUploadAttachmentJson`
- `opengrowMessagingSendAttachment`
- `opengrowMessagingDownloadAttachment`
- `opengrowMessagingMarkRead`
- `opengrowMessagingSetTyping`
- `opengrowMessagingConnectRealtime`
- `opengrowMessagingDisconnectRealtime`
- `opengrowMessagingGetLastRealtimeEventJson`
- `opengrowMessagingDispose`

Subscribe to `opengrowMessagingEventJsonStream` once during application
bootstrap. It emits server events and `connection.changed` lifecycle events.
Unexpected disconnects use bounded exponential reconnect. Switching
conversations or calling disconnect invalidates the previous socket so it
cannot reconnect in the background.

Generate `clientMessageId` once in the application and reuse it for every retry. The server then guarantees idempotent message creation.

`projectId` is required during initialization and must come from the project configuration. The library does not embed an application-specific project identifier. Identity tokens are refreshed through the configured authentication gateway before expiry and once after an HTTP 401 response. The library never creates or signs an identity token.
