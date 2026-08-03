# OpenGrow FlutterFlow Messaging

This library is independent from Purchases. It creates no token and maintains no account. `opengrowMessagingInitializeAuthenticated` exchanges the existing application access token only through the configured authentication gateway, then uses the short-lived ES256 token for Messaging.

Available FlutterFlow actions:

- `opengrowMessagingInitializeAuthenticated`
- `opengrowMessagingOpenConversation`
- `opengrowMessagingListConversationsJson`
- `opengrowMessagingMessagesJson`
- `opengrowMessagingSend`

Generate `clientMessageId` once in the application and reuse it for every retry. The server then guarantees idempotent message creation.
