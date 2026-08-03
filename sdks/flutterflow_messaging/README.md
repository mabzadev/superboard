# OpenGrow FlutterFlow Messaging

Bibliothèque distincte de Purchases. Elle n’émet aucun jeton et ne maintient aucun compte :
`opengrowMessagingInitializeAuthenticated` échange le jeton VocoStar existant exclusivement auprès de
`https://api.vocostar.com/auth/opengrow-token`, puis utilise le jeton ES256 court pour Messaging.

Actions FlutterFlow exposées :

- `opengrowMessagingInitializeAuthenticated`
- `opengrowMessagingOpenConversation`
- `opengrowMessagingListConversationsJson`
- `opengrowMessagingMessagesJson`
- `opengrowMessagingSend`

L’identifiant `clientMessageId` doit être généré une seule fois côté application et réutilisé lors des retries.
Le serveur garantit alors l’idempotence.
