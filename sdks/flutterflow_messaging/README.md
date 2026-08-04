# OpenGrow FlutterFlow Messaging

This library is independent from Purchases. It creates no token and maintains no account. `opengrowMessagingInitializeAuthenticated` exchanges the existing application access token only through the configured authentication gateway, then uses the short-lived ES256 token for Messaging.

Available FlutterFlow actions:

- `opengrowMessagingInitializeAuthenticated`
- `opengrowMessagingOpenConversation`
- `opengrowMessagingListConversationsJson`
- `opengrowMessagingMessagesJson`
- `opengrowMessagingSend`
- `opengrowMessagingUploadAttachmentJson`
- `opengrowMessagingSendAttachment`
- `opengrowMessagingMarkRead`
- `opengrowMessagingSetTyping`

Generate `clientMessageId` once in the application and reuse it for every retry. The server then guarantees idempotent message creation.

`projectId` is required during initialization and must come from the project configuration. The library does not embed an application-specific project identifier. Identity tokens are refreshed through the configured authentication gateway before expiry and once after an HTTP 401 response. The library never creates or signs an identity token.
